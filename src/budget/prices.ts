import { z } from "zod";
import { DomainError } from "@/core/model/errors";
import { createId } from "@/core/model/ids";
import { normalizeUnit } from "./services";

/**
 * Base de preços do orçamento.
 *
 * Nenhum preço real é embutido no sistema. Os itens de EXEMPLO servem apenas
 * para demonstrar o fluxo e são sempre marcados como tal (source.kind = "exemplo").
 */

export const PRICE_SOURCE_KINDS = ["exemplo", "usuario", "fornecedor", "sinapi", "outra"] as const;
export const PriceSourceKindSchema = z.enum(PRICE_SOURCE_KINDS);
export type PriceSourceKind = z.infer<typeof PriceSourceKindSchema>;

export const PRICE_SOURCE_KIND_LABEL: Record<PriceSourceKind, string> = {
  exemplo: "Exemplo (não usar)",
  usuario: "Informado pelo usuário",
  fornecedor: "Cotação de fornecedor",
  sinapi: "SINAPI",
  outra: "Outra fonte",
};

export const EXAMPLE_SOURCE_NAME = "DADOS DE EXEMPLO — não utilizar em orçamento real";

/** Data ISO yyyy-mm-dd (validada no calendário). */
export const IsoDateSchema = z.iso.date();

export const PriceSourceSchema = z.object({
  kind: PriceSourceKindSchema,
  name: z.string().trim().min(1).max(200),
  reference: z.string().max(200).optional(),
  date: IsoDateSchema,
  region: z.string().max(120),
});
export type PriceSource = z.infer<typeof PriceSourceSchema>;

const money = z.number().finite().nonnegative().nullable();

export const PriceItemSchema = z.object({
  id: z.string().min(1),
  /** Código do serviço do catálogo; null = importado, ainda não vinculado. */
  serviceCode: z.string().min(1).nullable(),
  description: z.string().trim().min(1).max(500),
  /** Unidade do preço (texto livre para aceitar importações; comparada normalizada com a do serviço). */
  unit: z.string().trim().min(1).max(20),
  /** Preço unitário de material (R$/unidade). null = não informado. */
  material: money,
  labor: money,
  equipment: money,
  currency: z.literal("BRL"),
  source: PriceSourceSchema,
  supplierId: z.string().min(1).nullable(),
  notes: z.string().max(2000),
});
export type PriceItem = z.infer<typeof PriceItemSchema>;

export const SupplierSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(200),
  contact: z.string().max(200),
  phone: z.string().max(60),
  email: z.string().max(200),
  region: z.string().max(120),
});
export type Supplier = z.infer<typeof SupplierSchema>;

export const RegionalFactorSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  factor: z.number().finite().positive(),
});
export type RegionalFactor = z.infer<typeof RegionalFactorSchema>;

export const PriceDatabaseSchema = z.object({
  version: z.literal(1),
  items: z.array(PriceItemSchema),
  suppliers: z.array(SupplierSchema),
  regions: z.array(RegionalFactorSchema),
});
export type PriceDatabase = z.infer<typeof PriceDatabaseSchema>;

export function createEmptyPriceDatabase(): PriceDatabase {
  return { version: 1, items: [], suppliers: [], regions: [] };
}

/** Preço tem ao menos um componente informado. */
export const hasAnyPrice = (p: Pick<PriceItem, "material" | "labor" | "equipment">): boolean =>
  p.material !== null || p.labor !== null || p.equipment !== null;

/** Soma dos componentes informados (null se nenhum). */
export function unitPriceOf(p: Pick<PriceItem, "material" | "labor" | "equipment">): number | null {
  if (!hasAnyPrice(p)) return null;
  return (p.material ?? 0) + (p.labor ?? 0) + (p.equipment ?? 0);
}

/**
 * Preços ILUSTRATIVOS, propositalmente redondos, para demonstrar o fluxo.
 * NÃO são preços de mercado. Sempre marcados como "exemplo".
 * Pintura: PINT-PAREDE leva só mão de obra; o insumo tinta fica em PINT-TINTA (evita contar a tinta duas vezes).
 */
export function EXAMPLE_PRICE_ITEMS(today: string): PriceItem[] {
  const date = IsoDateSchema.parse(today);
  const source: PriceSource = { kind: "exemplo", name: EXAMPLE_SOURCE_NAME, date, region: "Exemplo" };
  const rows: Array<[code: string, description: string, unit: string, material: number | null, labor: number | null, equipment: number | null]> = [
    ["ALV-BLOCO-CERAMICO", "Alvenaria em bloco cerâmico (exemplo)", "m²", 50, 40, null],
    ["ALV-BLOCO-CONCRETO", "Alvenaria em bloco de concreto (exemplo)", "m²", 60, 40, null],
    ["ALV-CONCRETO", "Parede de concreto (exemplo)", "m²", 150, 80, 20],
    ["ALV-DRYWALL", "Drywall (exemplo)", "m²", 70, 30, null],
    ["REVEST-REBOCO", "Chapisco + reboco (exemplo)", "m²", 10, 20, null],
    ["PINT-PAREDE", "Mão de obra de pintura (exemplo)", "m²", null, 10, null],
    ["PINT-TINTA", "Tinta acrílica (exemplo)", "L", 20, null, null],
    ["FORRO-GESSO", "Forro de gesso (exemplo)", "m²", 40, 30, null],
    ["LAJE-CONCRETO", "Laje de concreto (exemplo)", "m³", 1000, 500, 100],
    ["EST-CONCRETO", "Pilares e vigas de concreto (exemplo)", "m³", 1500, 800, 200],
    ["COB-ROOF-TILE-CERAMIC", "Cobertura em telha cerâmica (exemplo)", "m²", 100, 50, null],
    ["COB-CUMEEIRA", "Cumeeira (exemplo)", "m", 30, 20, null],
    ["PISO-PORCELAIN-TILE", "Porcelanato (exemplo)", "m²", 100, 50, null],
    ["PISO-CERAMIC-FLOOR", "Piso cerâmico (exemplo)", "m²", 50, 40, null],
    ["PISO-WOOD-OAK", "Piso de madeira (exemplo)", "m²", 200, 60, null],
    ["BANCADA-PEDRA", "Bancada em pedra (exemplo)", "m²", 800, 200, null],
    ["PISCINA", "Piscina por m² de espelho d'água (exemplo)", "m²", 2000, 1000, 500],
    ["PAISAGISMO-GRAMA", "Grama (exemplo)", "m²", 10, 10, null],
    ["PAISAGISMO-ARVORE", "Árvore (exemplo)", "un", 300, 100, null],
    ["MOV-CABINET-BASE", "Armário inferior planejado (exemplo)", "un", 1000, 200, null],
  ];
  return rows.map(([code, description, unit, material, labor, equipment]) => ({
    id: `exemplo-${code}`,
    serviceCode: code,
    description,
    unit,
    material,
    labor,
    equipment,
    currency: "BRL",
    source,
    supplierId: null,
    notes: "Valor ilustrativo. Substitua por preço real (SINAPI, cotação ou base própria).",
  }));
}

function validate<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const r = schema.safeParse(value);
  if (!r.success) {
    const issue = r.error.issues[0];
    throw new DomainError(`${what} inválido: ${issue ? `${issue.path.join(".")} ${issue.message}`.trim() : ""}`);
  }
  return r.data;
}

/** Insere ou substitui (pelo id) um preço. Retorna uma NOVA base. */
export function upsertPrice(db: PriceDatabase, item: PriceItem): PriceDatabase {
  const valid = validate(PriceItemSchema, item, "Preço");
  if (valid.supplierId !== null && !db.suppliers.some((s) => s.id === valid.supplierId)) {
    throw new DomainError("Fornecedor do preço não encontrado.");
  }
  const exists = db.items.some((i) => i.id === valid.id);
  return { ...db, items: exists ? db.items.map((i) => (i.id === valid.id ? valid : i)) : [...db.items, valid] };
}

export function removePrice(db: PriceDatabase, id: string): PriceDatabase {
  if (!db.items.some((i) => i.id === id)) throw new DomainError("Preço não encontrado.");
  return { ...db, items: db.items.filter((i) => i.id !== id) };
}

/** Vincula (ou desvincula, com null) um preço importado a um código de serviço. */
export function mapPriceToService(db: PriceDatabase, priceId: string, serviceCode: string | null): PriceDatabase {
  const item = db.items.find((i) => i.id === priceId);
  if (!item) throw new DomainError("Preço não encontrado.");
  return upsertPrice(db, { ...item, serviceCode: serviceCode === null ? null : serviceCode.trim() || null });
}

export function addSupplier(db: PriceDatabase, input: Omit<Supplier, "id"> & { id?: string }): { db: PriceDatabase; supplier: Supplier } {
  const supplier = validate(SupplierSchema, { ...input, id: input.id ?? createId() }, "Fornecedor");
  if (db.suppliers.some((s) => s.id === supplier.id)) throw new DomainError("Fornecedor duplicado.");
  return { db: { ...db, suppliers: [...db.suppliers, supplier] }, supplier };
}

export function addRegion(db: PriceDatabase, input: Omit<RegionalFactor, "id"> & { id?: string }): { db: PriceDatabase; region: RegionalFactor } {
  const region = validate(RegionalFactorSchema, { ...input, id: input.id ?? createId() }, "Fator regional");
  if (db.regions.some((r) => r.id === region.id)) throw new DomainError("Fator regional duplicado.");
  return { db: { ...db, regions: [...db.regions, region] }, region };
}

/**
 * Melhor preço para um código de serviço: fontes reais (usuário, fornecedor,
 * SINAPI, outra) têm prioridade sobre EXEMPLO; depois, a data mais recente.
 * Itens sem nenhum componente de preço são ignorados. null = sem preço.
 */
export function findPrice(db: PriceDatabase, code: string): PriceItem | null {
  const candidates = db.items.filter((i) => i.serviceCode === code && hasAnyPrice(i));
  if (candidates.length === 0) return null;
  const rank = (i: PriceItem) => (i.source.kind === "exemplo" ? 1 : 0);
  return [...candidates].sort((a, b) => rank(a) - rank(b) || b.source.date.localeCompare(a.source.date) || a.id.localeCompare(b.id))[0] ?? null;
}

// ---------------------------------------------------------------------------
// Importação SINAPI (CSV)
// ---------------------------------------------------------------------------

export interface CsvImportError {
  /** Linha do arquivo (1 = primeira). */
  line: number;
  message: string;
}

export interface SinapiImportResult {
  items: PriceItem[];
  errors: CsvImportError[];
}

const normalizeHeader = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

/** Divide uma linha separada por ";" respeitando aspas duplas. */
function splitCsvLine(line: string, sep = ";"): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/**
 * Número em formato brasileiro ou internacional: "1.234,56", "1234,56",
 * "1234.56", "R$ 1.234". Retorna null se inválido.
 */
export function parseBrazilianNumber(raw: string): number | null {
  let s = raw.replace(/R\$/gi, "").replace(/\s/g, "");
  if (s === "") return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

interface Columns {
  code: number;
  description: number;
  unit: number;
  price: number;
}

function detectHeader(cells: string[]): Columns | null {
  const h = cells.map(normalizeHeader);
  const find = (pred: (c: string) => boolean) => h.findIndex(pred);
  const code = find((c) => c.startsWith("codigo") || c === "cod" || c === "cod.");
  const description = find((c) => c.startsWith("descricao"));
  const unit = find((c) => c.startsWith("unidade") || c === "un" || c === "und" || c === "unid");
  const price = find((c) => c.startsWith("preco") || c.startsWith("custo") || c.startsWith("valor"));
  const found = [code, description, unit, price].filter((i) => i >= 0).length;
  if (found < 2) return null;
  if (found < 4) return { code: -1, description: -1, unit: -1, price: -1 };
  return { code, description, unit, price };
}

/**
 * Importa uma planilha SINAPI exportada em CSV separado por ";".
 * Colunas: código; descrição; unidade; preço (cabeçalho opcional, sem
 * diferenciar maiúsculas/acentos). O preço SINAPI é o custo unitário total da
 * composição (sem separação material/mão de obra): é gravado em `material` e
 * explicado em `notes`. Os itens chegam sem vínculo (serviceCode = null).
 */
export function importSinapiCsv(text: string, opts: { uf: string; date: string }): SinapiImportResult {
  const uf = opts.uf.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(uf)) throw new DomainError("Informe a UF com 2 letras (ex.: SP).");
  const date = validate(IsoDateSchema, opts.date, "Data de referência");
  const items: PriceItem[] = [];
  const errors: CsvImportError[] = [];
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  let cols: Columns = { code: 0, description: 1, unit: 2, price: 3 };
  let headerSeen = false;
  const seen = new Set<string>();

  lines.forEach((rawLine, idx) => {
    const lineNo = idx + 1;
    if (rawLine.trim() === "") return;
    const cells = splitCsvLine(rawLine);
    if (!headerSeen) {
      headerSeen = true;
      const header = detectHeader(cells);
      if (header) {
        if (header.code < 0) {
          errors.push({ line: lineNo, message: "Cabeçalho sem as colunas obrigatórias: código, descrição, unidade e preço." });
          cols = { code: -1, description: -1, unit: -1, price: -1 };
        } else cols = header;
        return;
      }
    }
    if (cols.code < 0) return;
    const code = cells[cols.code]?.trim() ?? "";
    const description = cells[cols.description]?.trim() ?? "";
    const unitRaw = cells[cols.unit]?.trim() ?? "";
    const priceRaw = cells[cols.price]?.trim() ?? "";
    if (!code) return void errors.push({ line: lineNo, message: "Código ausente." });
    if (!description) return void errors.push({ line: lineNo, message: `Descrição ausente (código ${code}).` });
    if (!unitRaw) return void errors.push({ line: lineNo, message: `Unidade ausente (código ${code}).` });
    const price = parseBrazilianNumber(priceRaw);
    if (price === null) return void errors.push({ line: lineNo, message: `Preço inválido "${priceRaw}" (código ${code}).` });
    if (price < 0) return void errors.push({ line: lineNo, message: `Preço negativo (código ${code}).` });
    if (seen.has(code)) return void errors.push({ line: lineNo, message: `Código ${code} repetido no arquivo; mantida a primeira ocorrência.` });
    seen.add(code);
    items.push({
      id: `sinapi-${uf}-${date}-${code}`,
      serviceCode: null,
      description: description.slice(0, 500),
      unit: normalizeUnit(unitRaw) ?? unitRaw.slice(0, 20),
      material: Math.round(price * 100) / 100,
      labor: null,
      equipment: null,
      currency: "BRL",
      source: { kind: "sinapi", name: "SINAPI", reference: code, date, region: uf },
      supplierId: null,
      notes: "Custo unitário total SINAPI (sem separação material/mão de obra/equipamento).",
    });
  });
  return { items, errors };
}

/** Acrescenta itens importados à base (itens com o mesmo id são substituídos). */
export function mergePriceItems(db: PriceDatabase, items: readonly PriceItem[]): PriceDatabase {
  return items.reduce(upsertPrice, db);
}

// ---------------------------------------------------------------------------
// Integrações futuras
// ---------------------------------------------------------------------------

/**
 * Provedor de preços externo (contrato para integrações futuras).
 *
 * Planejado: SINAPI (Caixa) por UF/mês de referência, SICRO (DNIT), tabelas
 * estaduais (ex.: CDHU, SEINFRA/CE) e catálogos de fornecedores. Nenhuma
 * chamada de rede é feita hoje: a importação é manual (CSV) via
 * `importSinapiCsv`. Implementações deverão devolver itens com
 * `source.kind` correto, data e região de referência, e serviceCode = null
 * (o vínculo com o catálogo é sempre uma decisão do usuário).
 */
export interface PriceSourceProvider {
  id: string;
  label: string;
  /** Descrição da cobertura (região, periodicidade, licença de uso). */
  description?: string;
  fetch?(query: { uf: string; referenceMonth: string; codes?: readonly string[] }, signal?: AbortSignal): Promise<SinapiImportResult>;
}

export const PLANNED_PRICE_PROVIDERS: readonly PriceSourceProvider[] = [
  { id: "sinapi-csv", label: "SINAPI (importação manual de CSV)", description: "Planilha de composições exportada pelo usuário, por UF e mês de referência." },
  { id: "sinapi-api", label: "SINAPI (integração automática - planejada)", description: "Sem integração ativa; nenhuma chamada de rede é realizada." },
];
