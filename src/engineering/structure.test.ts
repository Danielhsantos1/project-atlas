import { describe, expect, it } from "vitest";
import { buildModernHouse } from "../core/templates/modern-house";
import { addElements } from "../core/model/operations";
import { ElementSchema, type Project } from "../core/model/schema";
import { predimensionStructure, toModelElements } from "./structure";
import { allFinite, emptyProject, simpleHouse, withFlatRoof, withRoom } from "./test-fixtures";

const near = (a: { x: number; y: number }, x: number, y: number) => Math.hypot(a.x - x, a.y - y) < 1e-6;

function longHouse(): Project {
  // Um único cômodo de 12 × 4 m (parede longa de 12 m).
  return withFlatRoof(withRoom(emptyProject(), [0, 0], [12, 4], "sala"), [0, 0], [12, 4]);
}

describe("lançamento em casa retangular de 2 ambientes (10 × 4 m)", () => {
  const r = predimensionStructure(simpleHouse());

  it("pilares: 4 cantos + 2 encontros em T = 6", () => {
    expect(r.columns).toHaveLength(6);
    for (const [x, y] of [[0, 0], [10, 0], [10, 4], [0, 4], [5, 0], [5, 4]] as const) expect(r.columns.some((c) => near(c, x, y))).toBe(true);
    expect(new Set(r.columns.map((c) => c.id)).size).toBe(6);
  });

  it("vigas: 7 trechos entre pilares (nenhum acima de 5 m), mais 7 baldrames", () => {
    expect(r.beams).toHaveLength(7);
    expect(r.baldrame).toHaveLength(7);
    expect(r.beams.every((b) => b.length <= 5 + 1e-9)).toBe(true);
    expect(r.beams.every((b) => b.kind === "cobertura")).toBe(true); // único pavimento = topo
    expect(r.baldrame.every((b) => b.kind === "baldrame" && b.h >= 0.3 - 1e-9)).toBe(true);
    // vão 5 m: h = ceil5(5/12 = 0,4167) = 0,45; vão 4 m: ceil5(0,333) = 0,35; b = espessura 0,15
    const b5 = r.beams.find((b) => Math.abs(b.length - 5) < 1e-9)!;
    const b4 = r.beams.find((b) => Math.abs(b.length - 4) < 1e-9)!;
    expect(b5.h).toBeCloseTo(0.45, 9);
    expect(b4.h).toBeCloseTo(0.35, 9);
    expect(b5.b).toBeCloseTo(0.15, 9);
  });

  it("lajes de cobertura: lx = 4 m ⇒ h = max(7 cm, 4/40 = 10 cm) = 10 cm; g = 0,10·25 + 1,0 = 3,5; q = 0,5", () => {
    expect(r.slabs).toHaveLength(2);
    for (const s of r.slabs) {
      expect(s.kind).toBe("laje-cobertura");
      expect(s.lx).toBeCloseTo(4, 9);
      expect(s.ly).toBeCloseTo(5, 9);
      expect(s.h).toBeCloseTo(0.1, 9);
      expect(s.g).toBeCloseTo(3.5, 9);
      expect(s.q).toBeCloseTo(0.5, 9);
    }
  });

  it("carga das vigas: laje distribuída pelo perímetro (q·A/P) + peso próprio, sem parede acima", () => {
    // Laje 5 × 4: A = 20, P = 18, q = 4,0 ⇒ 4,444 kN/m nas vigas de contorno
    const south = r.beams.find((b) => near(b.from, 0, 0) && near(b.to, 5, 0))!;
    expect(south.load.wall).toBe(0);
    expect(south.load.slab).toBeCloseTo((4.0 * 20) / 18, 9);
    expect(south.load.self).toBeCloseTo(0.15 * south.h * 25, 9);
    expect(south.qk).toBeCloseTo(south.load.slab + south.load.self, 9);
    // viga do meio (entre ambientes) recebe as duas lajes
    const mid = r.beams.find((b) => near(b.from, 5, 0) && near(b.to, 5, 4)) ?? r.beams.find((b) => near(b.from, 5, 4) && near(b.to, 5, 0))!;
    expect(mid.load.slab).toBeCloseTo(2 * (4.0 * 20) / 18, 9);
  });

  it("equilíbrio: soma das cargas dos pilares = soma das reações das vigas + peso próprio dos pilares", () => {
    const reactions = r.beams.reduce((s, b) => s + (b.qk * b.length), 0);
    const selfCols = r.columns.reduce((s, c) => s + c.b * c.h * c.height * 25, 0);
    expect(r.columns.reduce((s, c) => s + c.Nk, 0)).toBeCloseTo(reactions + selfCols, 6);
    // Toda a carga de laje chega: ≥ 2 lajes · 20 m² · 4,0 kPa = 160 kN
    expect(reactions).toBeGreaterThan(160);
  });

  it("premissas, avisos e referências obrigatórios", () => {
    expect(r.status).toBe("pre-dimensionamento");
    expect(r.references.length).toBeGreaterThan(0);
    expect(r.references.every((x) => x.includes("referência de consulta — conferir edição vigente"))).toBe(true);
    expect(r.warnings[0]).toContain("Pré-dimensionamento");
    for (const id of ["fck", "gammaC", "gammaS", "fyk", "gamma.concrete", "gamma.masonry", "maxSpan", "steel.columns"]) {
      expect(r.assumptions.some((a) => a.id === id)).toBe(true);
    }
    expect(r.assumptions.find((a) => a.id === "fck")?.origin).toBe("adotado");
    expect(r.assumptions.find((a) => a.id === "gamma.masonry")?.value).toBe(13);
    expect(r.assumptions.find((a) => a.id === "live.dormitorio" || a.id === "live.quarto")?.origin).toBe("referencia");
    expect(allFinite(r)).toBe(true);
  });
});

describe("regra de vão e vigas", () => {
  it("parede de 12 m com vão máximo 5 m ⇒ 3 trechos de 4 m (2 pilares intermediários por lado)", () => {
    const r = predimensionStructure(longHouse());
    expect(r.columns).toHaveLength(4 + 2 + 2);
    expect(r.beams).toHaveLength(3 + 3 + 1 + 1);
    const long = r.beams.filter((b) => Math.abs(b.length - 4) < 1e-9 && b.from.y === b.to.y);
    expect(long).toHaveLength(6);
    expect(r.beams.every((b) => b.length <= 5 + 1e-9)).toBe(true);
    expect(long[0]!.h).toBeCloseTo(0.35, 9); // ceil5(4/12)
  });

  it("vão máximo é parâmetro; biapoiada usa L/10; altura mínima 25 cm", () => {
    const six = predimensionStructure(longHouse(), { maxSpan: 6 });
    expect(six.beams.filter((b) => b.from.y === b.to.y && Math.abs(b.length - 6) < 1e-9)).toHaveLength(4);
    expect(six.beams.find((b) => Math.abs(b.length - 6) < 1e-9)!.h).toBeCloseTo(0.5, 9); // 6/12
    expect(six.assumptions.find((a) => a.id === "maxSpan")?.origin).toBe("informado");
    const ss = predimensionStructure(longHouse(), { simplySupported: true });
    expect(ss.beams.find((b) => Math.abs(b.length - 4) < 1e-9)!.h).toBeCloseTo(0.4, 9); // 4/10
    const short = predimensionStructure(withFlatRoof(withRoom(emptyProject(), [0, 0], [2, 2], "banheiro"), [0, 0], [2, 2]));
    expect(short.beams.every((b) => b.h >= 0.25 - 1e-9)).toBe(true);
    expect(short.beams[0]!.h).toBeCloseTo(0.25, 9);
  });

  it("largura da viga = espessura da parede (arredondada a 1 cm), mínimo 12 cm", () => {
    const thick = predimensionStructure(withFlatRoof(withRoom(emptyProject(), [0, 0], [4, 4], "sala", "terreo", 0.2), [0, 0], [4, 4]));
    expect(thick.beams.every((b) => Math.abs(b.b - 0.2) < 1e-9)).toBe(true);
    const thin = predimensionStructure(withFlatRoof(withRoom(emptyProject(), [0, 0], [4, 4], "sala", "terreo", 0.1), [0, 0], [4, 4]));
    expect(thin.beams.every((b) => Math.abs(b.b - 0.12) < 1e-9)).toBe(true);
  });
});

describe("pilares", () => {
  it("fórmula: A_c = 1,5·Nd / (0,85·fcd + ρ·(fyd − 0,85·fcd)); Nd = 1000 kN ⇒ 636,4 cm² (fck 25, CA-50, ρ 2%)", () => {
    // fcd = 25/1,4 = 17,857; fyd = 500/1,15 = 434,78; denominador = 15,179 + 0,02·419,60 = 23,571 MPa
    // A_c = 1,5·1000 / 23571 kN/m² = 0,063637 m² = 636,4 cm²  ⇒  razão A_c/Nd = 0,63637 cm²/kN
    const r = predimensionStructure(buildModernHouse());
    for (const c of r.columns) {
      expect(c.Nd).toBeCloseTo(1.4 * c.Nk, 9);
      expect(c.requiredAreaCm2 / c.Nd).toBeCloseTo(0.63637, 4);
    }
    // Com 10× mais carga a seção passa a ser governada pela resistência
    const heavy = predimensionStructure(simpleHouse(), { liveLoadsKPa: {}, roofLiveKPa: 40 });
    const gov = heavy.columns.filter((c) => c.governedBy === "resistencia");
    expect(gov.length).toBeGreaterThan(0);
    for (const c of gov) expect(c.areaCm2).toBeGreaterThanOrEqual(c.requiredAreaCm2 - 1e-6);
  });

  it("mínimos: área ≥ 360 cm², menor lado ≥ 19 cm, lados em múltiplos de 5 cm, b alinhado à espessura", () => {
    const r = predimensionStructure(simpleHouse());
    for (const c of r.columns) {
      expect(c.areaCm2).toBeGreaterThanOrEqual(360 - 1e-6);
      expect(Math.min(c.b, c.h)).toBeGreaterThanOrEqual(0.19);
      expect(Math.abs(c.b * 20 - Math.round(c.b * 20))).toBeLessThan(1e-9);
      expect(Math.abs(c.h * 20 - Math.round(c.h * 20))).toBeLessThan(1e-9);
      expect(c.b).toBeCloseTo(0.2, 9); // parede de 15 cm ⇒ mínimo 19 ⇒ 20
      expect(c.governedBy).toBe("minimo");
    }
    // parâmetros de mínimo são sobrescrevíveis
    const loose = predimensionStructure(simpleHouse(), { columnMinAreaCm2: 100, columnMinSideM: 0.12 });
    expect(Math.min(...loose.columns.map((c) => Math.min(c.b, c.h)))).toBeCloseTo(0.15, 9);
    expect(loose.assumptions.find((a) => a.id === "column.minSide")?.origin).toBe("informado");
  });

  it("esbeltez: altura/menor lado > 12 gera um aviso agregado (3,2 m / 0,20 = 16)", () => {
    const r = predimensionStructure(simpleHouse());
    expect(r.columns.every((c) => c.slender && Math.abs(c.slenderness - 3.2 / 0.2) < 1e-9)).toBe(true);
    expect(r.warnings.filter((w) => w.includes("altura/menor lado")).length).toBe(1);
  });

  it("casa de 2 pavimentos: carga acumula para baixo (térreo ≥ superior no mesmo ponto)", () => {
    const p = buildModernHouse();
    const r = predimensionStructure(p);
    const upper = p.levels.find((l) => l.id !== "terreo")!;
    const up = r.columns.find((c) => c.levelId === upper.id && near(c, 3, 8))!;
    const low = r.columns.find((c) => c.levelId === "terreo" && near(c, 3, 8))!;
    expect(low.Nk).toBeGreaterThan(up.Nk);
    expect(low.NkFromAbove).toBeGreaterThanOrEqual(up.Nk - 1e-9);
  });
});

describe("fundação e quantitativos", () => {
  it("sem σadm ⇒ foundation null e missingInputs com SPT; quantitativos de sapata ausentes", () => {
    const r = predimensionStructure(simpleHouse());
    expect(r.foundation).toBeNull();
    expect(r.missingInputs).toHaveLength(1);
    expect(r.missingInputs[0]).toContain("σadm");
    expect(r.missingInputs[0]).toContain("SPT");
    expect(r.quantities.concreteM3.footings).toBeNull();
    expect(r.quantities.steelKg.footings).toBeNull();
  });

  it("com σadm: A = 1,1·Nk/σadm, lado = ⌈√A⌉ a 5 cm, mínimo 60 cm", () => {
    const sigma = 150;
    const r = predimensionStructure(simpleHouse(), { soilAllowableKPa: sigma });
    expect(r.missingInputs).toEqual([]);
    expect(r.foundation).toHaveLength(r.columns.length);
    for (const f of r.foundation!) {
      const col = r.columns.find((c) => c.id === f.columnId)!;
      const bald = r.baldrame.reduce((s, b) => s + (b.fromColumnId === col.id || b.toColumnId === col.id ? (b.qk * b.length) / 2 : 0), 0);
      expect(f.Nk).toBeCloseTo(col.Nk + bald, 9);
      expect(f.requiredAreaM2).toBeCloseTo((1.1 * f.Nk) / sigma, 12);
      expect(f.side).toBeGreaterThanOrEqual(0.6);
      expect(f.side).toBeGreaterThanOrEqual(Math.sqrt(f.requiredAreaM2) - 1e-9);
      expect(f.side - 0.05).toBeLessThan(Math.max(0.6, Math.sqrt(f.requiredAreaM2)) + 1e-9);
      expect(Math.abs(f.side * 20 - Math.round(f.side * 20))).toBeLessThan(1e-9);
    }
    expect(r.assumptions.find((a) => a.id === "soil.sigmaAdm")?.origin).toBe("informado");
    // solo mais fraco ⇒ sapatas maiores
    const weak = predimensionStructure(simpleHouse(), { soilAllowableKPa: 50 });
    expect(weak.foundation![0]!.side).toBeGreaterThanOrEqual(r.foundation![0]!.side);
    expect(() => predimensionStructure(simpleHouse(), { soilAllowableKPa: -5 })).toThrow(RangeError);
  });

  it("quantitativos: volumes e taxas de aço (referência, sobrescrevíveis)", () => {
    const r = predimensionStructure(simpleHouse(), { soilAllowableKPa: 150, steelRatesKgM3: { columns: 120 } });
    const q = r.quantities;
    const vCol = r.columns.reduce((s, c) => s + c.b * c.h * c.height, 0);
    expect(q.concreteM3.columns).toBeCloseTo(vCol, 9);
    expect(q.steelKg.columns).toBeCloseTo(vCol * 120, 9);
    expect(q.steelKg.beams).toBeCloseTo(q.concreteM3.beams * 90, 9);
    expect(q.steelKg.slabs).toBeCloseTo(q.concreteM3.slabs * 70, 9);
    expect(q.concreteM3.slabs).toBeCloseTo(2 * 0.1 * 20, 9);
    expect(q.concreteM3.total).toBeCloseTo(q.concreteM3.columns + q.concreteM3.beams + q.concreteM3.slabs + q.concreteM3.footings!, 9);
    expect(q.formworkM2.total).toBeGreaterThan(0);
    expect(r.assumptions.find((a) => a.id === "steel.columns")?.origin).toBe("informado");
    expect(r.assumptions.find((a) => a.id === "steel.beams")?.origin).toBe("referencia");
  });
});

describe("toModelElements", () => {
  it("gera pilares e vigas válidos no schema e inseríveis com addElements", () => {
    const p = simpleHouse();
    const r = predimensionStructure(p);
    const els = toModelElements(p, r);
    expect(els.filter((e) => e.kind === "column-rect")).toHaveLength(r.columns.length);
    expect(els.filter((e) => e.kind === "beam")).toHaveLength(r.beams.length);
    for (const e of els) expect(ElementSchema.safeParse(e).success).toBe(true);
    expect(new Set(els.map((e) => e.name)).size).toBe(els.length);
    expect(els.some((e) => e.name === "Pilar P1")).toBe(true);
    expect(els.some((e) => e.name === "Viga V1")).toBe(true);
    const p2 = addElements(p, els);
    expect(p2.elements.length).toBe(p.elements.length + els.length);
    const lv = p.levels[0]!;
    const col = els.find((e) => e.kind === "column-rect")!;
    expect(col.height).toBeCloseTo(lv.height, 12);
    const cc = r.columns[0]!;
    expect(col.length).toBeCloseTo(cc.b, 12);
    expect(col.width).toBeCloseTo(cc.h, 12);
    const beam = els.find((e) => e.kind === "beam")!;
    const bb = r.beams[0]!;
    expect(beam.length).toBeCloseTo(bb.length, 9);
    expect(beam.width).toBeCloseTo(bb.b, 12);
    expect(beam.height).toBeCloseTo(bb.h, 12);
    expect(beam.position.z).toBeCloseTo(lv.height - bb.h, 12);
    expect(beam.position.x).toBeCloseTo((bb.from.x + bb.to.x) / 2, 9);
  });

  it("nomes não colidem ao gerar de novo sobre um projeto que já recebeu os elementos; baldrame opcional", () => {
    const p = simpleHouse();
    const r = predimensionStructure(p);
    const p2 = addElements(p, toModelElements(p, r));
    const again = toModelElements(p2, r);
    const names = new Set(p2.elements.map((e) => e.name));
    expect(again.every((e) => !names.has(e.name))).toBe(true);
    const withB = toModelElements(p, r, { includeBaldrame: true });
    expect(withB.length).toBe(r.columns.length + r.beams.length + r.baldrame.length);
    expect(withB.filter((e) => e.name.startsWith("Baldrame")).every((e) => e.position.z < 0)).toBe(true);
    for (const e of withB) expect(ElementSchema.safeParse(e).success).toBe(true);
  });
});

describe("casa modelo (buildModernHouse)", () => {
  const p = buildModernHouse();
  const r = predimensionStructure(p, { soilAllowableKPa: 150 });

  it("não lança, números finitos, ignora muros e guarda-corpos", () => {
    expect(allFinite(r)).toBe(true);
    expect(r.columns.length).toBeGreaterThan(20);
    // Nenhum pilar sobre o muro de divisa (x = 0 ou 20) nem nos guarda-corpos (x = 15,9 / 11,7 em y 18,8–20)
    expect(r.columns.every((c) => c.x > 0.5 && c.x < 19.5)).toBe(true);
    expect(r.columns.some((c) => near(c, 15.9, 18.8))).toBe(false);
    expect(r.levels.map((l) => l.columns).every((n) => n > 0)).toBe(true);
    expect(r.slabs.some((s) => s.kind === "laje-piso")).toBe(true);
    expect(r.slabs.some((s) => s.kind === "laje-cobertura")).toBe(true);
    expect(r.roofLoadPanels.length).toBeGreaterThan(0);
    expect(r.foundation).toHaveLength(r.columns.filter((c) => c.levelId === "terreo").length);
  });

  it("vão de escada sinalizado e elementos gerados são válidos e inseríveis", () => {
    expect(r.slabs.some((s) => s.voidFraction > 0.02)).toBe(true);
    expect(r.warnings.some((w) => w.includes("sem laje acima"))).toBe(true);
    const els = toModelElements(p, r);
    for (const e of els) expect(ElementSchema.safeParse(e).success).toBe(true);
    expect(addElements(p, els).elements.length).toBe(p.elements.length + els.length);
  });

  it("sem σadm: foundation null; com σadm: preenchida", () => {
    expect(predimensionStructure(p).foundation).toBeNull();
    expect(r.foundation).not.toBeNull();
  });
});
