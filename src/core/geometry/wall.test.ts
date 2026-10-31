import { describe, expect, it } from "vitest";
import type { Door, Wall, Window } from "../model/schema";
import {
  clampOpeningOffset,
  computeWallJoins,
  computeWallPieces,
  openingCenter,
  validateOpening,
  wallFrame,
  wallPlanCut,
  wallQuantities,
} from "./wall";

const wall = (over: Partial<Wall> = {}): Wall => ({
  id: "w1",
  type: "wall",
  name: "Parede 1",
  levelId: "terreo",
  core: "ceramic-brick",
  start: { x: 0, y: 0 },
  end: { x: 5, y: 0 },
  baseElevation: 0,
  height: 2.8,
  thickness: 0.15,
  materialId: "plaster-white",
  ...over,
});

const door = (over: Partial<Door> = {}): Door => ({
  id: "d1",
  type: "door",
  name: "Porta 1",
  hostId: "w1",
  offset: 1,
  width: 0.8,
  height: 2.1,
  hinge: "left",
  opensTo: "left",
  style: "swing",
  materialId: "wood-oak",
  ...over,
});

const win = (over: Partial<Window> = {}): Window => ({
  id: "j1",
  type: "window",
  name: "Janela 1",
  hostId: "w1",
  offset: 3.5,
  width: 1.2,
  height: 1.2,
  sillHeight: 1,
  materialId: "aluminum",
  ...over,
});

const area = (p: { u0: number; u1: number; v0: number; v1: number }) => (p.u1 - p.u0) * (p.v1 - p.v0);

describe("referencial da parede", () => {
  it("calcula comprimento, direção e ângulo", () => {
    const f = wallFrame(wall({ end: { x: 3, y: 4 } }));
    expect(f.length).toBe(5);
    expect(f.dir.x).toBeCloseTo(0.6);
    expect(f.normal.x).toBeCloseTo(-0.8);
    expect(f.angle).toBeCloseTo(53.1301, 3);
  });
});

describe("geometria de paredes com aberturas", () => {
  it("parede sem aberturas é um único bloco", () => {
    expect(computeWallPieces(wall(), [])).toEqual([{ u0: 0, u1: 5, v0: 0, v1: 2.8 }]);
  });

  it("porta cria um vão real: nenhum bloco ocupa a região da porta", () => {
    const pieces = computeWallPieces(wall(), [door()]);
    // Esquerda, verga acima da porta, direita.
    expect(pieces).toHaveLength(3);
    const total = pieces.reduce((s, p) => s + area(p), 0);
    expect(total).toBeCloseTo(5 * 2.8 - 0.8 * 2.1, 9);
    for (const p of pieces) {
      const overlapU = Math.min(p.u1, 1.4) - Math.max(p.u0, 0.6);
      const overlapV = Math.min(p.v1, 2.1) - Math.max(p.v0, 0);
      expect(overlapU > 1e-9 && overlapV > 1e-9).toBe(false);
    }
  });

  it("janela cria peitoril e verga", () => {
    const pieces = computeWallPieces(wall(), [win()]);
    const middle = pieces.filter((p) => p.u0 >= 2.9 - 1e-9 && p.u1 <= 4.1 + 1e-9);
    expect(middle).toEqual([
      { u0: 2.9, u1: 4.1, v0: 0, v1: 1 },
      { u0: 2.9, u1: 4.1, v0: 2.2, v1: 2.8 },
    ]);
  });

  it("porta e janela juntas descontam as duas áreas", () => {
    const q = wallQuantities(wall(), [door(), win()]);
    expect(q.grossArea).toBeCloseTo(14);
    expect(q.openingsArea).toBeCloseTo(0.8 * 2.1 + 1.2 * 1.2, 9);
    expect(q.netArea).toBeCloseTo(14 - 1.68 - 1.44, 9);
    expect(q.volume).toBeCloseTo(q.netArea * 0.15, 9);
  });

  it("aberturas sobrepostas não descontam a mesma área duas vezes", () => {
    const q = wallQuantities(wall(), [door({ offset: 1 }), door({ id: "d2", offset: 1.2 })]);
    expect(q.openingsArea).toBeCloseTo(1.0 * 2.1, 9);
  });

  it("abertura fora da parede é recortada; abertura de outra parede é ignorada", () => {
    const q = wallQuantities(wall(), [door({ offset: 4.9 }), door({ id: "x", hostId: "outra" })]);
    expect(q.openingsArea).toBeCloseTo(0.5 * 2.1, 9);
  });

  it("planta baixa: o corte a 1,20 m interrompe a parede nas aberturas", () => {
    const cut = wallPlanCut(wall(), [door(), win()]);
    expect(cut).toEqual([
      { u0: 0, u1: 0.6 },
      { u0: 1.4, u1: 2.9 },
      { u0: 4.1, u1: 5 },
    ]);
    // Basculante alto (peitoril 1,60 m) não aparece no corte.
    expect(wallPlanCut(wall(), [win({ sillHeight: 1.6, height: 0.6 })])).toEqual([{ u0: 0, u1: 5 }]);
  });

  it("centro da abertura em 3D", () => {
    expect(openingCenter(wall(), win())).toEqual({ x: 3.5, y: 0, z: 1.6 });
  });
});

describe("encontros de paredes", () => {
  it("canto em L: uma avança e a outra recua meia espessura", () => {
    const a = wall({ id: "a", start: { x: 0, y: 0 }, end: { x: 4, y: 0 }, thickness: 0.2 });
    const b = wall({ id: "b", start: { x: 4, y: 0 }, end: { x: 4, y: 3 }, thickness: 0.1 });
    const joins = computeWallJoins([a, b]);
    expect(joins.get("a")).toEqual({ start: 0, end: 0.05 });
    expect(joins.get("b")).toEqual({ start: -0.1, end: 0 });
    const pa = computeWallPieces(a, [], joins.get("a"));
    expect(pa[0]).toMatchObject({ u0: 0, u1: 4.05 });
  });

  it("ambiente fechado com 4 paredes: cada canto coberto uma única vez", () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 3 },
      { x: 0, y: 3 },
    ];
    const walls = pts.map((p, i) => wall({ id: `w${i}`, start: p, end: pts[(i + 1) % 4]! }));
    const joins = computeWallJoins(walls);
    const total = walls.reduce(
      (s, w) => s + computeWallPieces(w, [], joins.get(w.id)).reduce((a, p) => a + (p.u1 - p.u0), 0),
      0,
    );
    // Perímetro externo dos eixos (14 m): soma dos comprimentos ajustados = perímetro de eixo exato.
    expect(total).toBeCloseTo(14, 9);
  });

  it("encontro em T: parede que chega recua", () => {
    const host = wall({ id: "h", start: { x: 0, y: 0 }, end: { x: 6, y: 0 }, thickness: 0.2 });
    const t = wall({ id: "t", start: { x: 3, y: 0 }, end: { x: 3, y: 2 } });
    expect(computeWallJoins([host, t]).get("t")).toEqual({ start: -0.1, end: 0 });
  });

  it("paredes colineares não são ajustadas", () => {
    const a = wall({ id: "a", end: { x: 2, y: 0 } });
    const b = wall({ id: "b", start: { x: 2, y: 0 }, end: { x: 5, y: 0 } });
    expect(computeWallJoins([a, b]).get("a")).toEqual({ start: 0, end: 0 });
  });
});

describe("validação de aberturas", () => {
  it("aceita abertura válida", () => {
    expect(validateOpening(wall(), door(), [])).toEqual([]);
  });

  it("detecta abertura fora, alta demais, larga demais e sobreposta", () => {
    expect(validateOpening(wall(), door({ offset: 4.8 }), [])[0]?.code).toBe("out-of-bounds");
    expect(validateOpening(wall(), win({ sillHeight: 2 }), [])[0]?.code).toBe("too-tall");
    expect(validateOpening(wall({ end: { x: 0.5, y: 0 } }), door(), [])[0]?.code).toBe("too-wide");
    const other = door({ id: "d2", name: "Porta 2", offset: 1.3 });
    expect(validateOpening(wall(), door(), [other]).map((i) => i.code)).toEqual(["overlap"]);
  });

  it("limita o centro para a abertura caber", () => {
    expect(clampOpeningOffset(5, 0.8, 0)).toBe(0.4);
    expect(clampOpeningOffset(5, 0.8, 9)).toBe(4.6);
    expect(clampOpeningOffset(5, 0.8, 2)).toBe(2);
    expect(clampOpeningOffset(0.5, 0.8, 0.2)).toBeNull();
  });
});
