import { describe, expect, it } from "vitest";
import { DomainError } from "@/core/model/errors";
import { buildBudget, categoryBreakdown, type ManualLine } from "./budget";
import { EXAMPLE_PRICE_ITEMS, addRegion, createEmptyPriceDatabase, mergePriceItems, type PriceItem } from "./prices";
import type { TakeoffResult } from "./quantities";
import { takeoff } from "./quantities";
import { buildReferenceProject } from "./test-fixtures";

const TODAY = "2026-10-31";
const price = (id: string, code: string, unit: string, kind: PriceItem["source"]["kind"], date: string, m: number | null, l: number | null, e: number | null): PriceItem => ({
  id, serviceCode: code, description: id, unit, material: m, labor: l, equipment: e, currency: "BRL",
  source: { kind, name: kind, date, region: "SP" }, supplierId: null, notes: "",
});

const TAKEOFF: TakeoffResult = {
  warnings: ["aviso do levantamento"],
  lines: [
    { code: "ALV-BLOCO-CERAMICO", description: "Alvenaria", unit: "m²", quantity: 10, category: "materiais", elementIds: ["w1"], basis: "b", levelId: "terreo" },
    { code: "PINT-PAREDE", description: "Pintura", unit: "m²", quantity: 20, category: "acabamentos", elementIds: ["w1"], basis: "b", levelId: "terreo" },
    { code: "LAJE-CONCRETO", description: "Laje", unit: "m³", quantity: 2, category: "materiais", elementIds: ["f1"], basis: "b", levelId: "terreo" },
    { code: "EQUIP-FRIDGE", description: "Geladeira", unit: "un", quantity: 1, category: "equipamentos", elementIds: ["o1"], basis: "b", levelId: "terreo", optional: true },
    { code: "PISO-X", description: "Piso X", unit: "m²", quantity: 5, category: "acabamentos", elementIds: ["r1"], basis: "b", levelId: "terreo" },
  ],
};

function db() {
  let d = mergePriceItems(createEmptyPriceDatabase(), [
    ...EXAMPLE_PRICE_ITEMS(TODAY), // inclui ALV-BLOCO-CERAMICO (exemplo) e PINT-PAREDE (exemplo, mão de obra 10)
    price("u-alv", "ALV-BLOCO-CERAMICO", "M2", "usuario", "2026-06-01", 50, 30, null),
    price("u-laje", "LAJE-CONCRETO", "m³", "fornecedor", "2025-01-01", 1000, 500, 100),
  ]);
  d = addRegion(d, { id: "reg", name: "Capital", factor: 1.1 }).db;
  return d;
}

const MANUAL: ManualLine[] = [
  { description: "Projeto arquitetônico", unit: "vb", quantity: 1, unitPrice: 5000, category: "servicos", note: "" },
  { description: "Frete", unit: "un", quantity: 2, unitPrice: 150, category: "custos-adicionais", note: "2 viagens" },
];

describe("buildBudget", () => {
  const b = buildBudget(TAKEOFF, db(), { regionId: "reg", bdiPercent: 20, extraLines: MANUAL, today: TODAY, now: new Date("2026-10-31T10:00:00Z") });

  it("aplica fator regional e distribui material/mão de obra/equipamento por categoria", () => {
    const alv = b.lines.find((l) => l.code === "ALV-BLOCO-CERAMICO")!;
    expect(alv).toMatchObject({ priceItemId: "u-alv", unitMaterial: 55, unitLabor: 33, unitEquipment: null, unitPrice: 88, totalMaterial: 550, totalLabor: 330, total: 880, priceStatus: "ok" });
    const pint = b.lines.find((l) => l.code === "PINT-PAREDE")!;
    expect(pint).toMatchObject({ priceStatus: "exemplo", unitLabor: 11, total: 220 });
    const laje = b.lines.find((l) => l.code === "LAJE-CONCRETO")!;
    expect(laje).toMatchObject({ priceStatus: "desatualizado", totalMaterial: 2200, totalLabor: 1100, totalEquipment: 220, total: 3520 });
    expect(b.totalsByCategory).toEqual({
      materiais: 2750,
      "mao-de-obra": 1650,
      equipamentos: 220,
      servicos: 5000,
      acabamentos: 0,
      esquadrias: 0,
      "moveis-planejados": 0,
      "custos-adicionais": 300,
    });
  });

  it("linha sem preço é listada, contada e fora do total (nunca zero silencioso)", () => {
    const piso = b.lines.find((l) => l.code === "PISO-X")!;
    expect(piso).toMatchObject({ priceStatus: "sem-preco", unitPrice: null, total: 0 });
    expect(b.missingPrices).toBe(1);
    expect(b.warnings.some((w) => w.includes("PISO-X"))).toBe(true);
    expect(b.warnings.some((w) => w.includes("sem preço") && w.includes("NÃO inclui"))).toBe(true);
  });

  it("conta exemplos e preços desatualizados; soma subtotal, BDI e total", () => {
    expect(b.examplePrices).toBe(1);
    expect(b.stalePrices).toBe(1);
    expect(b.subtotal).toBe(9920);
    expect(b.bdi).toBe(1984);
    expect(b.total).toBe(11904);
    const sumCategories = Object.values(b.totalsByCategory).reduce((s, v) => s + v, 0);
    expect(sumCategories).toBeCloseTo(b.subtotal, 6);
    expect(b.warnings[0]).toBe("aviso do levantamento");
    expect(b.generatedAt).toBe("2026-10-31T10:00:00.000Z");
    expect(categoryBreakdown(b).map((c) => c.label)).toEqual(["Materiais", "Mão de obra", "Equipamentos", "Serviços", "Custos adicionais"]);
  });

  it("itens opcionais ficam fora por padrão e entram com includeOptional", () => {
    expect(b.lines.some((l) => l.code === "EQUIP-FRIDGE")).toBe(false);
    expect(b.warnings.some((w) => w.includes("opcional"))).toBe(true);
    const withOpt = buildBudget(TAKEOFF, db(), { includeOptional: true, today: TODAY });
    expect(withOpt.lines.find((l) => l.code === "EQUIP-FRIDGE")).toMatchObject({ optional: true, priceStatus: "sem-preco" });
    expect(withOpt.missingPrices).toBe(2);
  });

  it("unidade incompatível é tratada como sem preço", () => {
    const d = mergePriceItems(createEmptyPriceDatabase(), [price("kg", "PISO-X", "KG", "sinapi", TODAY, 10, null, null)]);
    const r = buildBudget(TAKEOFF, d, { today: TODAY });
    expect(r.lines.find((l) => l.code === "PISO-X")?.priceStatus).toBe("sem-preco");
    expect(r.warnings.some((w) => w.includes("Unidade incompatível"))).toBe(true);
  });

  it("valida região, BDI e linhas manuais", () => {
    expect(() => buildBudget(TAKEOFF, db(), { regionId: "nao-existe", today: TODAY })).toThrow(DomainError);
    expect(() => buildBudget(TAKEOFF, db(), { bdiPercent: 101, today: TODAY })).toThrow(DomainError);
    expect(() => buildBudget(TAKEOFF, db(), { extraLines: [{ ...MANUAL[0]!, quantity: -1 }], today: TODAY })).toThrow(DomainError);
  });

  it("orçamento do projeto de referência com preços de exemplo", () => {
    const { project } = buildReferenceProject();
    const r = buildBudget(takeoff(project), mergePriceItems(createEmptyPriceDatabase(), EXAMPLE_PRICE_ITEMS(TODAY)), { today: TODAY });
    expect(r.examplePrices).toBeGreaterThan(5);
    expect(r.missingPrices).toBeGreaterThan(0); // portas/janelas não têm preço de exemplo
    const tinta = r.lines.find((l) => l.code === "PINT-TINTA")!;
    expect(tinta.total).toBe(Math.round(24.512 * 20 * 100) / 100);
    expect(r.total).toBe(r.subtotal);
  });
});
