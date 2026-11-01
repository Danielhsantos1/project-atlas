import { describe, expect, it } from "vitest";
import { DomainError } from "@/core/model/errors";
import {
  EXAMPLE_PRICE_ITEMS,
  EXAMPLE_SOURCE_NAME,
  addRegion,
  addSupplier,
  createEmptyPriceDatabase,
  findPrice,
  importSinapiCsv,
  mapPriceToService,
  mergePriceItems,
  parseBrazilianNumber,
  removePrice,
  upsertPrice,
  type PriceItem,
  type PriceSource,
} from "./prices";

const src = (kind: PriceSource["kind"], date: string): PriceSource => ({ kind, name: kind.toUpperCase(), date, region: "SP" });
const item = (id: string, code: string | null, source: PriceSource, material: number | null = 10, labor: number | null = null): PriceItem => ({
  id, serviceCode: code, description: id, unit: "m²", material, labor, equipment: null, currency: "BRL", source, supplierId: null, notes: "",
});

describe("base de preços", () => {
  it("preços de exemplo são marcados como exemplo e não são reais", () => {
    const items = EXAMPLE_PRICE_ITEMS("2026-10-31");
    expect(items.length).toBeGreaterThan(10);
    for (const i of items) {
      expect(i.source.kind).toBe("exemplo");
      expect(i.source.name).toBe(EXAMPLE_SOURCE_NAME);
      expect(i.source.date).toBe("2026-10-31");
    }
    expect(items.map((i) => i.serviceCode)).toEqual(expect.arrayContaining(["ALV-BLOCO-CERAMICO", "PINT-PAREDE", "PINT-TINTA", "LAJE-CONCRETO", "EST-CONCRETO", "FORRO-GESSO"]));
    expect(() => EXAMPLE_PRICE_ITEMS("31/10/2026")).toThrow();
  });

  it("findPrice prefere fontes reais ao exemplo e, entre elas, a mais recente", () => {
    let db = createEmptyPriceDatabase();
    db = mergePriceItems(db, [
      item("ex", "X", src("exemplo", "2026-10-01")),
      item("sinapi-old", "X", src("sinapi", "2024-01-01")),
      item("user", "X", src("usuario", "2025-05-01")),
      item("vazio", "X", src("fornecedor", "2026-10-30"), null, null),
      item("outro", "Y", src("usuario", "2026-10-30")),
    ]);
    expect(findPrice(db, "X")?.id).toBe("user");
    db = removePrice(db, "user");
    expect(findPrice(db, "X")?.id).toBe("sinapi-old");
    db = removePrice(removePrice(db, "sinapi-old"), "vazio");
    expect(findPrice(db, "X")?.id).toBe("ex");
    expect(findPrice(db, "Z")).toBeNull();
  });

  it("upsert, vínculo a serviço, fornecedores e regiões", () => {
    let db = createEmptyPriceDatabase();
    const s = addSupplier(db, { name: "Casa do Construtor", contact: "Ana", phone: "", email: "", region: "SP" });
    db = s.db;
    db = upsertPrice(db, { ...item("p1", null, src("fornecedor", "2026-10-01")), supplierId: s.supplier.id });
    expect(findPrice(db, "ALV-DRYWALL")).toBeNull();
    db = mapPriceToService(db, "p1", "ALV-DRYWALL");
    expect(findPrice(db, "ALV-DRYWALL")?.id).toBe("p1");
    db = upsertPrice(db, { ...db.items[0]!, material: 12 });
    expect(db.items).toHaveLength(1);
    expect(db.items[0]!.material).toBe(12);
    expect(() => upsertPrice(db, { ...item("p2", "A", src("usuario", "2026-01-01")), supplierId: "nao-existe" })).toThrow(DomainError);
    expect(() => upsertPrice(db, item("p3", "A", src("usuario", "2026-02-30")))).toThrow(DomainError);
    expect(() => upsertPrice(db, item("p4", "A", src("usuario", "2026-01-01"), -1))).toThrow(DomainError);
    const r = addRegion(db, { name: "Interior", factor: 0.9 });
    expect(r.db.regions[0]).toMatchObject({ name: "Interior", factor: 0.9 });
    expect(() => addRegion(db, { name: "Zero", factor: 0 })).toThrow(DomainError);
    expect(() => removePrice(db, "inexistente")).toThrow(DomainError);
  });
});

describe("importação SINAPI (CSV)", () => {
  it("números brasileiros", () => {
    expect(parseBrazilianNumber("1.234,56")).toBe(1234.56);
    expect(parseBrazilianNumber("1234,5")).toBe(1234.5);
    expect(parseBrazilianNumber("R$ 12.345")).toBe(12345);
    expect(parseBrazilianNumber("12.5")).toBe(12.5);
    expect(parseBrazilianNumber("abc")).toBeNull();
    expect(parseBrazilianNumber("")).toBeNull();
  });

  it("com cabeçalho (acentos/maiúsculas indiferentes), aspas, decimais com vírgula e erros por linha", () => {
    const csv = [
      "CÓDIGO;DESCRIÇÃO;UNIDADE;PREÇO MEDIANO (R$)",
      '87878;"CHAPISCO; APLICADO EM ALVENARIA";M2;1.234,56',
      "92;ALVENARIA DE VEDAÇÃO;m2;45,7",
      "93;SEM PREÇO;UN;",
      "94;;M2;10",
      "",
      "95;ITEM;KG;abc",
      "87878;DUPLICADO;M2;1",
      "96;CABO;KG;12.5",
    ].join("\r\n");
    const r = importSinapiCsv(csv, { uf: "sp", date: "2026-09-01" });
    expect(r.items.map((i) => [i.source.reference, i.material, i.unit])).toEqual([
      ["87878", 1234.56, "m²"],
      ["92", 45.7, "m²"],
      ["96", 12.5, "KG"],
    ]);
    expect(r.items[0]).toMatchObject({
      serviceCode: null,
      description: "CHAPISCO; APLICADO EM ALVENARIA",
      source: { kind: "sinapi", name: "SINAPI", reference: "87878", date: "2026-09-01", region: "SP" },
      labor: null,
      equipment: null,
    });
    expect(r.errors.map((e) => e.line)).toEqual([4, 5, 7, 8]);
    expect(r.errors[0]!.message).toContain("Preço inválido");
    expect(r.errors[1]!.message).toContain("Descrição ausente");
    expect(r.errors[3]!.message).toContain("repetido");
  });

  it("sem cabeçalho usa a ordem código;descrição;unidade;preço", () => {
    const r = importSinapiCsv("1;Item A;m;10,5\n2;Item B;m³;1.000,00", { uf: "MG", date: "2026-01-01" });
    expect(r.errors).toEqual([]);
    expect(r.items.map((i) => [i.unit, i.material])).toEqual([["m", 10.5], ["m³", 1000]]);
  });

  it("cabeçalho incompleto e parâmetros inválidos", () => {
    const r = importSinapiCsv("codigo;descricao;preco\n1;x;2", { uf: "RJ", date: "2026-01-01" });
    expect(r.items).toEqual([]);
    expect(r.errors[0]).toMatchObject({ line: 1 });
    expect(() => importSinapiCsv("", { uf: "São Paulo", date: "2026-01-01" })).toThrow(DomainError);
    expect(() => importSinapiCsv("", { uf: "SP", date: "2026-13-01" })).toThrow(DomainError);
  });
});
