import { describe, expect, it } from "vitest";
import { roomShape, uncoveredSegments } from "./rooms";
import { roofGeometry } from "./roof";
import { createProject, createRoomWithWalls, createLevel } from "../model/factory";
import { addElements, addLevel, deleteLevel, levelWalls, resizeRoom, projectStats } from "../model/operations";
import type { Project, Room, Wall } from "../model/schema";

const opts = { height: 2.8, thickness: 0.2, materialId: "plaster-white", levelId: "terreo" };
const w = (id: string, ax: number, ay: number, bx: number, by: number, t = 0.2): Wall => ({
  id, type: "wall", name: id, levelId: "terreo", core: "ceramic-brick", start: { x: ax, y: ay }, end: { x: bx, y: by },
  baseElevation: 0, height: 2.8, thickness: t, materialId: "plaster-white",
});

function addRoom(p: Project, a: { x: number; y: number }, b: { x: number; y: number }, type: Room["roomType"] = "sala") {
  const { walls, room } = createRoomWithWalls(p.elements, a, b, type, opts);
  return { project: addElements(p, [...walls, room]), walls, room };
}

describe("detecção de ambientes", () => {
  it("retângulo de 4 paredes: área útil desconta meia espessura", () => {
    const walls = [w("a", 0, 0, 5, 0), w("b", 5, 0, 5, 4), w("c", 5, 4, 0, 4), w("d", 0, 4, 0, 0)];
    const s = roomShape(walls, { x: 2, y: 2 })!;
    expect(s.area).toBeCloseTo(4.8 * 3.8, 9);
    expect(s.perimeter).toBeCloseTo(2 * (4.8 + 3.8), 9);
    expect(s.rect).toEqual({ minX: 0, maxX: 5, minY: 0, maxY: 4 });
    expect(s.wallIds.sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("parede divisória em T separa dois ambientes", () => {
    const walls = [w("a", 0, 0, 8, 0), w("b", 8, 0, 8, 4), w("c", 8, 4, 0, 4), w("d", 0, 4, 0, 0), w("x", 3, 0, 3, 4)];
    const left = roomShape(walls, { x: 1, y: 2 })!;
    const right = roomShape(walls, { x: 6, y: 2 })!;
    expect(left.rect).toEqual({ minX: 0, maxX: 3, minY: 0, maxY: 4 });
    expect(right.rect).toEqual({ minX: 3, maxX: 8, minY: 0, maxY: 4 });
    expect(left.area + right.area).toBeCloseTo(2.8 * 3.8 + 4.8 * 3.8, 9);
  });

  it("formato em L é detectado (não retangular)", () => {
    const walls = [w("a", 0, 0, 6, 0), w("b", 6, 0, 6, 3), w("c", 6, 3, 3, 3), w("d", 3, 3, 3, 6), w("e", 3, 6, 0, 6), w("f", 0, 6, 0, 0)];
    const s = roomShape(walls, { x: 1, y: 1 })!;
    expect(s.rect).toBeNull();
    expect(s.area).toBeGreaterThan(20);
  });

  it("espaço aberto (parede faltando) não é ambiente", () => {
    const walls = [w("a", 0, 0, 5, 0), w("b", 5, 0, 5, 4), w("c", 5, 4, 0, 4)];
    expect(roomShape(walls, { x: 2, y: 2 })).toBeNull();
  });

  it("trechos já cobertos por paredes colineares não são recriados", () => {
    const existing = [w("a", 0, 0, 4, 0)];
    expect(uncoveredSegments({ x: 0, y: 0 }, { x: 4, y: 0 }, existing)).toEqual([]);
    expect(uncoveredSegments({ x: 2, y: 0 }, { x: 7, y: 0 }, existing)).toEqual([[{ x: 4, y: 0 }, { x: 7, y: 0 }]]);
    expect(uncoveredSegments({ x: 0, y: 1 }, { x: 4, y: 1 }, existing)).toHaveLength(1);
  });
});

describe("cômodos encostados e redimensionamento", () => {
  it("segundo cômodo reaproveita a parede compartilhada", () => {
    let p = createProject({ name: "C", category: "residencial", site: { width: 30, depth: 30 } });
    p = addRoom(p, { x: 0, y: 0 }, { x: 4, y: 4 }, "sala").project;
    const second = addRoom(p, { x: 4, y: 0 }, { x: 7, y: 4 }, "cozinha");
    expect(second.walls).toHaveLength(3); // a parede x=4 já existia
    p = second.project;
    expect(levelWalls(p, "terreo")).toHaveLength(7);
    expect(roomShape(levelWalls(p, "terreo"), second.room.seed)?.rect).toEqual({ minX: 4, maxX: 7, minY: 0, maxY: 4 });
  });

  it("alterar a largura de um cômodo move a parede e o vizinho se ajusta", () => {
    let p = createProject({ name: "C", category: "residencial", site: { width: 30, depth: 30 } });
    const a = addRoom(p, { x: 0, y: 0 }, { x: 4, y: 4 }, "sala");
    p = a.project;
    const b = addRoom(p, { x: 4, y: 0 }, { x: 7, y: 4 }, "cozinha");
    p = b.project;
    p = resizeRoom(p, a.room.id, "x", 5);
    const walls = levelWalls(p, "terreo");
    expect(roomShape(walls, (p.elements.find((e) => e.id === a.room.id) as Room).seed)?.rect).toEqual({ minX: 0, maxX: 5, minY: 0, maxY: 4 });
    expect(roomShape(walls, b.room.seed)?.rect).toEqual({ minX: 5, maxX: 7, minY: 0, maxY: 4 });
    expect(() => resizeRoom(p, a.room.id, "y", 0.2)).toThrow(/60 cm/);
  });

  it("estatísticas somam áreas úteis dos ambientes", () => {
    let p = createProject({ name: "C", category: "residencial", site: { width: 30, depth: 30 } });
    p = addRoom(p, { x: 0, y: 0 }, { x: 4, y: 4 }).project;
    expect(projectStats(p)).toMatchObject({ rooms: 1, walls: 4 });
    expect(projectStats(p).totalRoomArea).toBeCloseTo(3.8 * 3.8, 9);
  });
});

describe("pavimentos", () => {
  it("cria pavimento acima e exclui com seus elementos", () => {
    let p = createProject({ name: "S", category: "residencial", site: { width: 20, depth: 20 } });
    const upper = createLevel(p.levels);
    expect(upper.elevation).toBeCloseTo(3.0);
    p = addLevel(p, upper);
    const { walls, room } = createRoomWithWalls(p.elements, { x: 0, y: 0 }, { x: 4, y: 4 }, "quarto", { ...opts, levelId: upper.id });
    p = addElements(p, [...walls, room]);
    expect(levelWalls(p, "terreo")).toHaveLength(0);
    p = deleteLevel(p, upper.id);
    expect(p.levels).toHaveLength(1);
    expect(p.elements).toHaveLength(0);
    expect(() => deleteLevel(p, "terreo")).toThrow(/ao menos um pavimento/);
  });

  it("elemento em pavimento inexistente é rejeitado", () => {
    const p = createProject({ name: "S", category: "residencial", site: { width: 20, depth: 20 } });
    const { walls } = createRoomWithWalls([], { x: 0, y: 0 }, { x: 4, y: 4 }, "sala", { ...opts, levelId: "nao-existe" });
    expect(() => addElements(p, walls)).toThrow(/pavimento existente/);
  });
});

describe("telhados", () => {
  const base = { width: 10, depth: 8, overhang: 0.5 };
  it("áreas inclinadas e cumeeiras", () => {
    const L = 11;
    const D = 9;
    const cos = Math.cos((30 * Math.PI) / 180);
    const gable = roofGeometry({ ...base, roofType: "gable", pitch: 30 });
    expect(gable.area).toBeCloseTo((L * D) / cos, 9);
    expect(gable.ridge).toBe(11);
    expect(gable.rise).toBeCloseTo(4.5 * Math.tan(Math.PI / 6), 9);
    const hip = roofGeometry({ ...base, roofType: "hip", pitch: 30 });
    expect(hip.ridge).toBeCloseTo(2, 9);
    expect(hip.area).toBeCloseTo((L * D) / cos, 9);
    expect(roofGeometry({ ...base, roofType: "flat", pitch: 0 }).area).toBe(99);
  });

  it("a soma das áreas dos triângulos confere com a área declarada", () => {
    for (const roofType of ["gable", "hip", "shed", "flat"] as const) {
      const g = roofGeometry({ ...base, roofType, pitch: 25 });
      const sum = g.surface.reduce((s, [a, b, c]) => {
        const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        const x = u[1]! * v[2]! - u[2]! * v[1]!;
        const y = u[2]! * v[0]! - u[0]! * v[2]!;
        const z = u[0]! * v[1]! - u[1]! * v[0]!;
        return s + Math.hypot(x, y, z) / 2;
      }, 0);
      expect(sum, roofType).toBeCloseTo(g.area, 6);
    }
  });
});
