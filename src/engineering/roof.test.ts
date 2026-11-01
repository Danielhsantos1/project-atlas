import { describe, expect, it } from "vitest";
import { roofGeometry } from "../core/geometry/roof";
import { designRoof, gutterCapacityLMin, rainFlowLMin, ROOF_COVER_TYPES, type RoofDesignParams } from "./roof";

const mk = (over: Partial<Parameters<typeof designRoof>[0]> = {}) => ({
  id: "r1",
  roofType: "gable" as const,
  width: 10,
  depth: 6,
  pitch: 20,
  overhang: 0.5,
  materialId: "roof-tile-ceramic",
  ...over,
});

describe("tabela de coberturas", () => {
  it("é consistente e marcada como referência", () => {
    const ids = ROOF_COVER_TYPES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const want of ["ceramic-colonial", "ceramic-romana", "ceramic-francesa", "concrete-tile", "fibrocimento", "metal-trapezoidal", "metal-sandwich", "flat-slab"]) expect(ids).toContain(want);
    for (const c of ROOF_COVER_TYPES) {
      expect(c.minPitchPercent).toBeGreaterThan(0);
      expect(c.tilesPerM2 === null || c.tilesPerM2 > 0).toBe(true);
      expect(c.origin).toBe("referencia");
      expect(c.note).toContain("confirmar com o fabricante");
      expect(c.label.length).toBeGreaterThan(3);
    }
    // Chapas não têm telhas/m²; cerâmicas têm.
    expect(ROOF_COVER_TYPES.filter((c) => c.id.startsWith("ceramic")).every((c) => c.tilesPerM2 !== null)).toBe(true);
    expect(ROOF_COVER_TYPES.filter((c) => c.id.startsWith("metal")).every((c) => c.tilesPerM2 === null)).toBe(true);
  });
});

describe("designRoof: geometria, telhas e inclinação", () => {
  it("telhas: 77 m² / cos20° × 16 un/m² × 1,10 = 1442,14 → 1443; cumeeira 11 m / 0,40 = 27,5 → 28", () => {
    const r = designRoof(mk(), { coverType: "ceramic-romana" });
    expect(r.planAreaM2).toBeCloseTo(77, 9);
    expect(r.inclinedAreaM2).toBeCloseTo(77 / Math.cos((20 * Math.PI) / 180), 9);
    expect(r.tiles.exact).toBeCloseTo(1442.14, 1);
    expect(r.tiles.count).toBe(1443);
    expect(r.tiles.ridgeTileCount).toBe(28);
    expect(r.pitchPercent).toBeCloseTo(36.397, 3);
    expect(r.riseM).toBeCloseTo(roofGeometry(mk()).rise, 12);
    expect(r.status).toBe("pre-dimensionamento");
    expect(r.references.every((x) => x.includes("referência de consulta — conferir edição vigente"))).toBe(true);
    expect(r.assumptions.find((a) => a.id === "loss")?.origin).toBe("adotado");
  });

  it("perda é parâmetro (informado)", () => {
    const r = designRoof(mk(), { coverType: "ceramic-romana", lossPercent: 0 });
    expect(r.tiles.count).toBe(Math.ceil(r.inclinedAreaM2 * 16 - 1e-9));
    expect(r.assumptions.find((a) => a.id === "loss")?.origin).toBe("informado");
  });

  it("inclinação abaixo do mínimo gera aviso, ângulo sugerido e altura extra", () => {
    const r = designRoof(mk({ pitch: 10 }), { coverType: "ceramic-romana" });
    expect(r.pitchCheck.ok).toBe(false);
    // run = (6+1)/2 = 3,5 m; extra = (0,30 − tan10°)·3,5 = 0,4328 m; sugerido atan(0,30) = 16,70°
    expect(r.pitchCheck.extraRiseM).toBeCloseTo((0.3 - Math.tan((10 * Math.PI) / 180)) * 3.5, 9);
    expect(r.pitchCheck.suggestedPitchDeg).toBeCloseTo(16.699, 2);
    expect(r.warnings.some((w) => w.includes("abaixo do mínimo"))).toBe(true);
    expect(designRoof(mk({ pitch: 20 }), { coverType: "ceramic-romana" }).pitchCheck.ok).toBe(true);
    // Chapa metálica aceita 10°.
    expect(designRoof(mk({ pitch: 10, materialId: "roof-metal" })).pitchCheck.ok).toBe(true);
  });

  it("beiral: aviso abaixo do mínimo e acima do máximo", () => {
    expect(designRoof(mk({ overhang: 0.2 })).overhangCheck.ok).toBe(false);
    expect(designRoof(mk({ overhang: 1.5 })).overhangCheck.ok).toBe(false);
    expect(designRoof(mk({ overhang: 0.6 })).overhangCheck.ok).toBe(true);
  });

  it("quatro águas: comprimentos de espigão e áreas de escoamento fecham com a projeção", () => {
    const r = designRoof(mk({ roofType: "hip", pitch: 30, overhang: 0 }), { coverType: "concrete-tile" });
    expect(r.ridgeLengthM).toBeCloseTo(4, 9);
    // horizontal = hypot(5−2, 3) = 4,2426; rise = 3·tan30° = 1,7321 → 4,5826
    expect(r.hipLengthEachM).toBeCloseTo(4.5826, 3);
    expect(r.hipLengthTotalM).toBeCloseTo(4 * 4.5826, 2);
    expect(r.drainSides).toHaveLength(4);
    expect(r.drainSides.reduce((s, x) => s + x.planAreaM2, 0)).toBeCloseTo(60, 9);
    expect(r.tiles.ridgeLinearM).toBeCloseTo(4 + r.hipLengthTotalM, 9);
  });

  it("laje plana: caimento mínimo 1% e aviso de cobertura incompatível; estrutura do telhado não dimensionada", () => {
    const r = designRoof(mk({ roofType: "flat", pitch: 0, materialId: "concrete" }));
    expect(r.cover.id).toBe("flat-slab");
    expect(r.flatSlab?.minSlopePercent).toBe(1);
    expect(r.flatSlab?.minRiseM).toBeCloseTo(0.01 * (Math.min(11, 7) / 2), 9);
    expect(r.framingNote).toContain("NÃO é dimensionada");
    const bad = designRoof(mk({ roofType: "flat", pitch: 0 }), { coverType: "ceramic-romana" });
    expect(bad.warnings.some((w) => w.includes("não combina"))).toBe(true);
  });
});

describe("calhas (NBR 10844)", () => {
  it("capacidade bate com a tabela usual (0,5%): Ø100≈130, Ø125≈236, Ø150≈384, Ø200≈829 L/min (±2%)", () => {
    const table: Array<[number, number]> = [[100, 130], [125, 236], [150, 384], [200, 829]];
    for (const [d, q] of table) expect(Math.abs(gutterCapacityLMin(d, 0.005) / q - 1)).toBeLessThan(0.02);
    // Conta à mão Ø125: S = π·0,125²/8 = 0,0061359; R = 0,03125; R^(2/3) = 0,09921; i^½ = 0,070711
    // Q = 60000·(0,0061359/0,011)·0,09921·0,070711 = 234,8 L/min
    expect(gutterCapacityLMin(125, 0.005)).toBeCloseTo(234.8, 0);
  });

  it("capacidade é monotônica no diâmetro e na declividade", () => {
    const d = [100, 125, 150, 200].map((x) => gutterCapacityLMin(x, 0.005));
    expect(d).toEqual([...d].sort((a, b) => a - b));
    const s = [0.005, 0.01, 0.02].map((i) => gutterCapacityLMin(125, i));
    expect(s[0]!).toBeLessThan(s[1]!);
    expect(s[1]!).toBeLessThan(s[2]!);
    expect(gutterCapacityLMin(125, 0.02) / gutterCapacityLMin(125, 0.005)).toBeCloseTo(2, 9); // √4
  });

  it("exemplo à mão: I = 150 mm/h, A = 11 × 3,5 = 38,5 m² → Q = 96,25 L/min; 2 condutores → 48,125 L/min → Ø100", () => {
    expect(rainFlowLMin(150, 38.5)).toBeCloseTo(96.25, 9);
    const r = designRoof(mk(), { rainIntensityMmH: 150 });
    const side = r.gutters!.sides[0]!;
    expect(r.gutters!.sides).toHaveLength(2);
    expect(side.planAreaM2).toBeCloseTo(38.5, 9);
    expect(side.flowLMin).toBeCloseTo(96.25, 9);
    expect(side.leaders).toBe(2); // ceil(11 / 10)
    expect(side.designFlowLMin).toBeCloseTo(48.125, 9);
    expect(side.diameterMm).toBe(100);
    expect(r.gutters!.totalLeaders).toBe(4);
    expect(r.warnings.some((w) => w.includes("condutor vertical NÃO dimensionado"))).toBe(true);
    expect(r.missingInputs).toEqual([]);
  });

  it("chuva forte escolhe diâmetro maior; fator de segurança também; nenhum atende ⇒ aviso", () => {
    const strong = designRoof(mk(), { rainIntensityMmH: 500 }); // 160,4 L/min por condutor
    expect(strong.gutters!.sides[0]!.diameterMm).toBe(125);
    const safe = designRoof(mk(), { rainIntensityMmH: 150, gutterSafetyFactor: 3 }); // 144 L/min
    expect(safe.gutters!.sides[0]!.diameterMm).toBe(125);
    const huge = designRoof(mk(), { rainIntensityMmH: 5000 });
    expect(huge.gutters!.sides[0]!.diameterMm).toBeNull();
    expect(huge.gutters!.sides[0]!.leadersNeededForLargest).toBeGreaterThan(2);
    expect(huge.warnings.some((w) => w.includes("excede a calha"))).toBe(true);
  });

  it("declividade maior reduz o diâmetro necessário", () => {
    const flat = designRoof(mk(), { rainIntensityMmH: 500, gutterSlope: 0.005 }).gutters!.sides[0]!.diameterMm!;
    const steep = designRoof(mk(), { rainIntensityMmH: 500, gutterSlope: 0.02 }).gutters!.sides[0]!.diameterMm!;
    expect(steep).toBeLessThan(flat);
  });

  it("lados que drenam: duas águas = 2, quatro águas = 4, uma água = 1 (lado baixo, área total)", () => {
    const p: RoofDesignParams = { rainIntensityMmH: 100 };
    expect(designRoof(mk(), p).gutters!.sides).toHaveLength(2);
    expect(designRoof(mk({ roofType: "hip" }), p).gutters!.sides).toHaveLength(4);
    const shed = designRoof(mk({ roofType: "shed" }), p).gutters!.sides;
    expect(shed).toHaveLength(1);
    expect(shed[0]!.planAreaM2).toBeCloseTo(77, 9);
  });

  it("nº de condutores segue o trecho máximo (parâmetro)", () => {
    const r = designRoof(mk({ width: 30 }), { rainIntensityMmH: 100, maxGutterRunM: 8 });
    expect(r.gutters!.sides[0]!.leaders).toBe(Math.ceil(31 / 8)); // 4
    expect(r.assumptions.find((a) => a.id === "gutter.maxRun")?.origin).toBe("informado");
    expect(designRoof(mk(), { rainIntensityMmH: 100 }).assumptions.find((a) => a.id === "gutter.maxRun")?.origin).toBe("adotado");
  });

  it("chuva incidente em parede só entra quando solicitada", () => {
    const base = designRoof(mk(), { rainIntensityMmH: 100 }).gutters!.sides[0]!;
    const withWall = designRoof(mk(), { rainIntensityMmH: 100, addWallContribution: true, wallContributionHeightM: 2 }).gutters!.sides[0]!;
    expect(base.wallContributionM2).toBe(0);
    expect(withWall.wallContributionM2).toBeCloseTo(0.5 * 11 * 2, 9);
    expect(withWall.flowLMin).toBeGreaterThan(base.flowLMin);
    const missing = designRoof(mk(), { rainIntensityMmH: 100, addWallContribution: true });
    expect(missing.missingInputs.some((m) => m.includes("Altura da parede"))).toBe(true);
  });

  it("sem intensidade de chuva: calhas null e missingInputs com dica", () => {
    const r = designRoof(mk(), {});
    expect(r.gutters).toBeNull();
    expect(r.missingInputs).toHaveLength(1);
    expect(r.missingInputs[0]).toContain("mm/h");
    expect(r.missingInputs[0]).toContain("pluviométricos");
    // geometria e telhas continuam disponíveis
    expect(r.tiles.count).toBeGreaterThan(0);
  });

  it("parâmetros inválidos lançam RangeError", () => {
    expect(() => designRoof(mk(), { rainIntensityMmH: -1 })).toThrow(RangeError);
    expect(() => designRoof(mk(), { rainIntensityMmH: 100, gutterSlope: 0 })).toThrow(RangeError);
  });
});
