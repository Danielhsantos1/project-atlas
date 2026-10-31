import { describe, expect, it } from "vitest";
import { findNearestWall, orthoConstrain, snapPoint, snapToGrid } from "./snap";
import { projectBounds, rectCorners } from "./shapes";
import type { Wall } from "../model/schema";

describe("snap", () => {
  it("arredonda para a grade", () => {
    expect(snapToGrid({ x: 1.234, y: -0.049 }, 0.1)).toEqual({ x: 1.2, y: 0 });
    expect(snapToGrid({ x: 0.26, y: 0.74 }, 0.5)).toEqual({ x: 0.5, y: 0.5 });
  });

  it("extremidades têm prioridade sobre a grade", () => {
    const r = snapPoint({ x: 1.03, y: 0.98 }, { gridSize: 0.5, snapToGrid: true, endpoints: [{ x: 1.05, y: 1 }], tolerance: 0.1 });
    expect(r).toEqual({ point: { x: 1.05, y: 1 }, kind: "endpoint" });
    const g = snapPoint({ x: 1.3, y: 0.98 }, { gridSize: 0.5, snapToGrid: true, endpoints: [{ x: 1.05, y: 1 }], tolerance: 0.1 });
    expect(g.kind).toBe("grid");
    const f = snapPoint({ x: 1.3, y: 0.98 }, { gridSize: 0.5, snapToGrid: false, endpoints: [], tolerance: 0.1 });
    expect(f).toEqual({ point: { x: 1.3, y: 0.98 }, kind: "free" });
  });

  it("modo ortogonal", () => {
    expect(orthoConstrain({ x: 0, y: 0 }, { x: 3, y: 0.4 })).toEqual({ x: 3, y: 0 });
    expect(orthoConstrain({ x: 0, y: 0 }, { x: 0.2, y: -2 })).toEqual({ x: 0, y: -2 });
  });

  it("encontra a parede mais próxima pela face", () => {
    const w = (id: string, y: number): Wall => ({
      id, type: "wall", name: id, levelId: "terreo", core: "ceramic-brick", start: { x: 0, y }, end: { x: 4, y }, baseElevation: 0, height: 2.8, thickness: 0.2, materialId: "concrete",
    });
    const hit = findNearestWall([w("a", 0), w("b", 2)], { x: 1.5, y: 1.6 }, 0.5);
    expect(hit?.wall.id).toBe("b");
    expect(hit?.along).toBeCloseTo(1.5);
    expect(hit?.distance).toBeCloseTo(0.3);
    expect(findNearestWall([w("a", 0)], { x: 1, y: 1 }, 0.5)).toBeNull();
  });
});

describe("formas", () => {
  it("cantos de retângulo rotacionado", () => {
    const c = rectCorners({ x: 0, y: 0 }, 2, 1, 90);
    expect(c[0]!.x).toBeCloseTo(0.5);
    expect(c[0]!.y).toBeCloseTo(-1);
  });

  it("caixa envolvente do projeto", () => {
    expect(projectBounds({ elements: [] })).toBeNull();
  });
});
