import { z } from "zod";
import { DomainError } from "@/core/model/errors";
import { BUDGET_CATEGORIES, BUDGET_CATEGORY_LABEL, BudgetCategorySchema, emptyCategoryTotals, type BudgetCategory } from "./categories";
import { IsoDateSchema, PriceSourceSchema, findPrice, type PriceDatabase } from "./prices";
import { ServiceUnitSchema, normalizeUnit } from "./services";
import type { QuantityLine, TakeoffResult } from "./quantities";
import { round3 } from "./quantities";

/** Preço com data anterior a este número de dias é "desatualizado". */
export const STALE_PRICE_DAYS = 365;

export const PRICE_STATUSES = ["ok", "exemplo", "desatualizado", "sem-preco"] as const;
export const PriceStatusSchema = z.enum(PRICE_STATUSES);
export type PriceStatus = z.infer<typeof PriceStatusSchema>;

export const PRICE_STATUS_LABEL: Record<PriceStatus, string> = {
  ok: "OK",
  exemplo: "Preço de exemplo",
  desatualizado: "Preço desatualizado",
  "sem-preco": "Sem preço",
};

/** Linha manual (serviços e custos não modelados: projeto, taxas, frete...). */
export const ManualLineSchema = z.object({
  description: z.string().trim().min(1).max(300),
  unit: z.string().trim().min(1).max(20),
  quantity: z.number().finite().nonnegative(),
  unitPrice: z.number().finite().nonnegative(),
  category: BudgetCategorySchema,
  note: z.string().max(1000),
});
export type ManualLine = z.infer<typeof ManualLineSchema>;

const moneyOrNull = z.number().finite().nullable();

export const BudgetLineSchema = z.object({
  origin: z.enum(["modelo", "manual"]),
  code: z.string(),
  description: z.string(),
  unit: z.string(),
  quantity: z.number().finite(),
  category: BudgetCategorySchema,
  elementIds: z.array(z.string()),
  basis: z.string(),
  levelId: z.string().nullable(),
  optional: z.boolean(),
  priceItemId: z.string().nullable(),
  priceSource: PriceSourceSchema.nullable(),
  priceStatus: PriceStatusSchema,
  /** Preços unitários JÁ multiplicados pelo fator regional. */
  unitMaterial: moneyOrNull,
  unitLabor: moneyOrNull,
  unitEquipment: moneyOrNull,
  unitPrice: moneyOrNull,
  totalMaterial: z.number().finite(),
  totalLabor: z.number().finite(),
  totalEquipment: z.number().finite(),
  total: z.number().finite(),
  note: z.string(),
});
export type BudgetLine = z.infer<typeof BudgetLineSchema>;

const totalsShape = Object.fromEntries(BUDGET_CATEGORIES.map((c) => [c, z.number().finite()])) as Record<BudgetCategory, z.ZodNumber>;

export const BudgetSchema = z.object({
  lines: z.array(BudgetLineSchema),
  totalsByCategory: z.object(totalsShape),
  subtotal: z.number().finite(),
  bdiPercent: z.number().finite(),
  bdi: z.number().finite(),
  total: z.number().finite(),
  missingPrices: z.number().int().nonnegative(),
  examplePrices: z.number().int().nonnegative(),
  stalePrices: z.number().int().nonnegative(),
  regionId: z.string().nullable(),
  regionalFactor: z.number().positive(),
  warnings: z.array(z.string()),
  generatedAt: z.iso.datetime(),
  /** Data de referência usada para avaliar preços desatualizados. */
  referenceDate: IsoDateSchema,
});
export type Budget = z.infer<typeof BudgetSchema>;

export interface BuildBudgetOptions {
  regionId?: string;
  /** BDI em % sobre o subtotal (0 a 100). Padrão 0. */
  bdiPercent?: number;
  extraLines?: readonly ManualLine[];
  /** Inclui linhas opcionais (equipamentos, mobiliário solto). Padrão false. */
  includeOptional?: boolean;
  /** Data de referência yyyy-mm-dd (padrão: hoje). */
  today?: string;
  /** Carimbo de geração (padrão: agora). */
  now?: Date;
}

export const roundMoney = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

const daysBetween = (fromIso: string, toIso: string): number => (Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000;

export function isStale(priceDate: string, today: string): boolean {
  return daysBetween(priceDate, today) > STALE_PRICE_DAYS;
}

/**
 * Monta o orçamento: quantidades do levantamento × preços da base.
 * - Material vai para a categoria do serviço; mão de obra para "mao-de-obra";
 *   equipamento para "equipamentos". Linhas manuais vão para a sua categoria.
 * - O fator regional multiplica os preços unitários da base (não as linhas manuais).
 * - Linha sem preço NUNCA vira zero silencioso: fica com status "sem-preco",
 *   é contada em `missingPrices` e listada nos avisos; o total a exclui.
 */
export function buildBudget(takeoffResult: TakeoffResult, db: PriceDatabase, options: BuildBudgetOptions = {}): Budget {
  const now = options.now ?? new Date();
  const today = options.today ?? now.toISOString().slice(0, 10);
  if (!IsoDateSchema.safeParse(today).success) throw new DomainError("Data de referência inválida (use aaaa-mm-dd).");
  const bdiPercent = options.bdiPercent ?? 0;
  if (!Number.isFinite(bdiPercent) || bdiPercent < 0 || bdiPercent > 100) throw new DomainError("O BDI deve estar entre 0% e 100%.");

  let regionalFactor = 1;
  const regionId = options.regionId ?? null;
  if (regionId !== null) {
    const region = db.regions.find((r) => r.id === regionId);
    if (!region) throw new DomainError("Região (fator regional) não encontrada na base de preços.");
    regionalFactor = region.factor;
  }

  const warnings = [...takeoffResult.warnings];
  const lines: BudgetLine[] = [];
  const skippedOptional = takeoffResult.lines.filter((l) => l.optional && !options.includeOptional);
  if (skippedOptional.length > 0) {
    warnings.push(`${skippedOptional.length} item(ns) opcional(is) não incluído(s) no orçamento (equipamentos/mobiliário solto).`);
  }

  for (const q of takeoffResult.lines) {
    if (q.optional && !options.includeOptional) continue;
    lines.push(priceLine(q, db, regionalFactor, today, warnings));
  }

  for (const [i, raw] of (options.extraLines ?? []).entries()) {
    const parsed = ManualLineSchema.safeParse(raw);
    if (!parsed.success) throw new DomainError(`Linha manual ${i + 1} inválida: ${parsed.error.issues[0]?.message ?? ""}`);
    const m = parsed.data;
    const total = roundMoney(m.quantity * m.unitPrice);
    lines.push({
      origin: "manual",
      code: `MANUAL-${i + 1}`,
      description: m.description,
      unit: m.unit,
      quantity: round3(m.quantity),
      category: m.category,
      elementIds: [],
      basis: "informado manualmente",
      levelId: null,
      optional: false,
      priceItemId: null,
      priceSource: null,
      priceStatus: "ok",
      unitMaterial: null,
      unitLabor: null,
      unitEquipment: null,
      unitPrice: m.unitPrice,
      totalMaterial: 0,
      totalLabor: 0,
      totalEquipment: 0,
      total,
      note: m.note,
    });
  }

  const totalsByCategory = emptyCategoryTotals();
  for (const l of lines) {
    if (l.origin === "manual") {
      totalsByCategory[l.category] += l.total;
      continue;
    }
    totalsByCategory[l.category] += l.totalMaterial;
    totalsByCategory["mao-de-obra"] += l.totalLabor;
    totalsByCategory.equipamentos += l.totalEquipment;
  }
  for (const c of BUDGET_CATEGORIES) totalsByCategory[c] = roundMoney(totalsByCategory[c]);
  const subtotal = roundMoney(lines.reduce((s, l) => s + l.total, 0));
  const bdi = roundMoney((subtotal * bdiPercent) / 100);

  const modelLines = lines.filter((l) => l.origin === "modelo");
  const missingPrices = modelLines.filter((l) => l.priceStatus === "sem-preco").length;
  const examplePrices = modelLines.filter((l) => l.priceSource?.kind === "exemplo").length;
  const stalePrices = modelLines.filter((l) => l.priceSource !== null && isStale(l.priceSource.date, today)).length;
  if (missingPrices > 0) warnings.push(`${missingPrices} item(ns) sem preço: o total NÃO inclui esses itens.`);
  if (examplePrices > 0) warnings.push(`${examplePrices} item(ns) com preço de EXEMPLO: não utilizar este orçamento como real.`);
  if (stalePrices > 0) warnings.push(`${stalePrices} item(ns) com preço anterior a ${STALE_PRICE_DAYS} dias da data de referência.`);

  return {
    lines,
    totalsByCategory,
    subtotal,
    bdiPercent,
    bdi,
    total: roundMoney(subtotal + bdi),
    missingPrices,
    examplePrices,
    stalePrices,
    regionId,
    regionalFactor,
    warnings,
    generatedAt: now.toISOString(),
    referenceDate: today,
  };
}

function priceLine(q: QuantityLine, db: PriceDatabase, factor: number, today: string, warnings: string[]): BudgetLine {
  const base = {
    origin: "modelo" as const,
    code: q.code,
    description: q.description,
    unit: q.unit,
    quantity: q.quantity,
    category: q.category,
    elementIds: [...q.elementIds],
    basis: q.basis,
    levelId: q.levelId ?? null,
    optional: q.optional ?? false,
  };
  const missing = (note: string): BudgetLine => ({
    ...base,
    priceItemId: null,
    priceSource: null,
    priceStatus: "sem-preco",
    unitMaterial: null,
    unitLabor: null,
    unitEquipment: null,
    unitPrice: null,
    totalMaterial: 0,
    totalLabor: 0,
    totalEquipment: 0,
    total: 0,
    note,
  });

  const price = findPrice(db, q.code);
  if (!price) {
    warnings.push(`Sem preço: ${q.code} - ${q.description}.`);
    return missing("Sem preço na base: item fora do total.");
  }
  const priceUnit = normalizeUnit(price.unit) ?? price.unit;
  if (!ServiceUnitSchema.safeParse(priceUnit).success || priceUnit !== q.unit) {
    warnings.push(`Unidade incompatível em ${q.code}: preço em "${price.unit}", quantidade em "${q.unit}". Item fora do total.`);
    return missing(`Preço vinculado (${price.id}) em unidade incompatível ("${price.unit}").`);
  }
  const unit = (v: number | null) => (v === null ? null : roundMoney(v * factor));
  const unitMaterial = unit(price.material);
  const unitLabor = unit(price.labor);
  const unitEquipment = unit(price.equipment);
  const totalMaterial = roundMoney((unitMaterial ?? 0) * q.quantity);
  const totalLabor = roundMoney((unitLabor ?? 0) * q.quantity);
  const totalEquipment = roundMoney((unitEquipment ?? 0) * q.quantity);
  const status: PriceStatus = price.source.kind === "exemplo" ? "exemplo" : isStale(price.source.date, today) ? "desatualizado" : "ok";
  return {
    ...base,
    priceItemId: price.id,
    priceSource: price.source,
    priceStatus: status,
    unitMaterial,
    unitLabor,
    unitEquipment,
    unitPrice: roundMoney((unitMaterial ?? 0) + (unitLabor ?? 0) + (unitEquipment ?? 0)),
    totalMaterial,
    totalLabor,
    totalEquipment,
    total: roundMoney(totalMaterial + totalLabor + totalEquipment),
    note: price.notes,
  };
}

/** Totais por categoria com rótulo, na ordem padrão, omitindo categorias zeradas. */
export function categoryBreakdown(budget: Pick<Budget, "totalsByCategory">): Array<{ category: BudgetCategory; label: string; total: number }> {
  return BUDGET_CATEGORIES.filter((c) => budget.totalsByCategory[c] !== 0).map((c) => ({ category: c, label: BUDGET_CATEGORY_LABEL[c], total: budget.totalsByCategory[c] }));
}
