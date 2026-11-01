import { describe, expect, it } from "vitest";
import { buildModernHouse } from "../core/templates/modern-house";
import { emptyProject, allFinite, withRoom } from "./test-fixtures";
import { assume, engineeringSummary, resolveParam, normRef } from "./index";

describe("types helpers", () => {
  it("assume/resolveParam registram origem e validam", () => {
    const book: ReturnType<typeof assume>[] = [];
    expect(resolveParam(book, "a", "A", undefined, 3, "adotado", { unit: "m" })).toBe(3);
    expect(resolveParam(book, "b", "B", 5, 3, "referencia")).toBe(5);
    expect(book.map((x) => x.origin)).toEqual(["adotado", "informado"]);
    expect(() => resolveParam(book, "c", "C", 0, 1, "adotado")).toThrow(RangeError);
    expect(resolveParam(book, "d", "D", 0, 1, "adotado", { allowZero: true })).toBe(0);
    expect(assume("x", "X", "texto", "adotado").unit).toBeUndefined();
    expect(normRef("NBR 6118")).toBe("NBR 6118 — referência de consulta — conferir edição vigente");
  });
});

describe("engineeringSummary na casa modelo", () => {
  const p = buildModernHouse();

  it("sem dados do local: chuva e σadm ficam em missingInputs; calhas e fundação null; o resto calcula", () => {
    const s = engineeringSummary(p);
    expect(s.status).toBe("pre-dimensionamento");
    expect(s.roofs).toHaveLength(2);
    expect(s.roofs!.every((r) => r.gutters === null)).toBe(true);
    expect(s.structure!.foundation).toBeNull();
    expect(s.water!.volume.tanks).toEqual([2000]);
    expect(s.missingInputs.some((m) => m.includes("mm/h"))).toBe(true);
    expect(s.missingInputs.some((m) => m.includes("σadm"))).toBe(true);
    expect(s.missingInputs).toHaveLength(2); // deduplicado entre os 2 telhados
    expect(allFinite(s)).toBe(true);
    expect(s.warnings.length).toBe(new Set(s.warnings).size);
  });

  it("com chuva e σadm: nenhuma entrada faltante, tudo preenchido e finito", () => {
    const s = engineeringSummary(p, { rainIntensityMmH: 150, soilAllowableKPa: 180 });
    expect(s.missingInputs).toEqual([]);
    expect(s.roofs!.every((r) => r.gutters !== null)).toBe(true);
    expect(s.structure!.foundation!.length).toBeGreaterThan(0);
    expect(allFinite(s)).toBe(true);
    for (const part of [...s.roofs!, s.water!, s.structure!]) {
      expect(part.status).toBe("pre-dimensionamento");
      expect(part.assumptions.length).toBeGreaterThan(0);
      expect(part.references.length).toBeGreaterThan(0);
      expect(part.references.every((r) => r.includes("referência de consulta"))).toBe(true);
      expect(part.warnings.length).toBeGreaterThan(0);
    }
    // nenhum texto afirma conformidade
    const text = JSON.stringify(s).toLowerCase();
    expect(text).not.toContain("atende à nbr");
    expect(text).not.toContain("em conformidade");
  });

  it("parâmetros por parte têm precedência sobre os atalhos", () => {
    const s = engineeringSummary(p, { rainIntensityMmH: 100, roof: { rainIntensityMmH: 200 }, water: { perCapitaLPerDay: 200 }, structure: { maxSpan: 4 } });
    expect(s.roofs![0]!.gutters!.rainIntensityMmH).toBe(200);
    expect(s.water!.volume.requiredL).toBe(2400);
    expect(s.structure!.assumptions.find((a) => a.id === "maxSpan")?.value).toBe(4);
  });

  it("entrada inválida em uma parte a deixa null sem derrubar as demais", () => {
    const s = engineeringSummary(p, { water: { perCapitaLPerDay: -1 } });
    expect(s.water).toBeNull();
    expect(s.structure).not.toBeNull();
    expect(s.warnings.some((w) => w.startsWith("Água fria: não calculado"))).toBe(true);
  });

  it("projeto sem telhado: roofs vazio; sem paredes: estrutura vazia sem lançar", () => {
    const s = engineeringSummary(withRoom(emptyProject(), [0, 0], [4, 4], "sala"));
    expect(s.roofs).toEqual([]);
    expect(s.warnings.some((w) => w.includes("Nenhum telhado"))).toBe(true);
    const e = engineeringSummary(emptyProject(), { soilAllowableKPa: 100 });
    expect(e.structure!.columns).toEqual([]);
    expect(e.structure!.foundation).toEqual([]);
    expect(e.water!.occupants).toBe(1);
    expect(allFinite(e)).toBe(true);
  });
});
