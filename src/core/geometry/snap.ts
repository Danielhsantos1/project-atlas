import type { Wall } from "../model/schema";
import { distance, projectOnSegment, type Vec2 } from "./vec";
import { roundTo } from "../units/units";

export const snapToGrid = (p: Vec2, step: number): Vec2 => ({
  x: roundTo(Math.round(p.x / step) * step, 9),
  y: roundTo(Math.round(p.y / step) * step, 9),
});

export interface SnapOptions {
  gridSize: number;
  snapToGrid: boolean;
  /** Pontos notáveis (extremidades de paredes) com prioridade sobre a grade. */
  endpoints: readonly Vec2[];
  /** Raio de captura das extremidades (m). */
  tolerance: number;
}

export interface SnapResult {
  point: Vec2;
  kind: "endpoint" | "grid" | "free";
}

export function snapPoint(p: Vec2, opts: SnapOptions): SnapResult {
  let best: Vec2 | null = null;
  let bestDist = opts.tolerance;
  for (const e of opts.endpoints) {
    const d = distance(p, e);
    if (d <= bestDist) {
      best = e;
      bestDist = d;
    }
  }
  if (best) return { point: { ...best }, kind: "endpoint" };
  if (opts.snapToGrid) return { point: snapToGrid(p, opts.gridSize), kind: "grid" };
  return { point: { ...p }, kind: "free" };
}

/** Modo ortogonal: alinha `to` ao eixo dominante a partir de `from`. */
export function orthoConstrain(from: Vec2, to: Vec2): Vec2 {
  return Math.abs(to.x - from.x) >= Math.abs(to.y - from.y) ? { x: to.x, y: from.y } : { x: from.x, y: to.y };
}

export const wallEndpoints = (walls: readonly Wall[]): Vec2[] => walls.flatMap((w) => [w.start, w.end]);

/** Parede mais próxima de um ponto (até `maxDistance` da face). */
export function findNearestWall(walls: readonly Wall[], p: Vec2, maxDistance: number) {
  let best: { wall: Wall; along: number; distance: number } | null = null;
  for (const wall of walls) {
    const proj = projectOnSegment(p, wall.start, wall.end);
    const faceDist = Math.max(0, proj.distance - wall.thickness / 2);
    if (faceDist <= maxDistance && (!best || faceDist < best.distance)) {
      best = { wall, along: proj.along, distance: faceDist };
    }
  }
  return best;
}
