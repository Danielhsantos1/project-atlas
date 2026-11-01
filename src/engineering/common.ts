import type { Wall } from "../core/model/schema";
import { buildWallGraph } from "../core/geometry/rooms";
import type { Vec2 } from "../core/geometry/vec";

/** Arredonda PARA CIMA ao múltiplo de `step`, tolerando ruído de ponto flutuante. */
export function ceilTo(x: number, step: number): number {
  const v = Math.ceil(x / step - 1e-9) * step;
  return Math.round(v * 1e6) / 1e6;
}

export const sum = (xs: readonly number[]): number => xs.reduce((s, x) => s + x, 0);

/** Menor distância de um ponto ao contorno de um polígono. */
export function distToBoundary(p: Vec2, poly: readonly Vec2[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
    best = Math.min(best, Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t)));
  }
  return best;
}

export const DEFAULT_MIN_STRUCTURAL_WALL_HEIGHT = 2.2;

/**
 * Paredes consideradas estruturais/portantes no pré-dimensionamento:
 * exclui drywall e elementos baixos (guarda-corpos, muretas) e muros de divisa (h < mínimo).
 */
export const structuralWalls = (walls: readonly Wall[], minHeight = DEFAULT_MIN_STRUCTURAL_WALL_HEIGHT): Wall[] =>
  walls.filter((w) => w.core !== "drywall" && w.height >= minHeight);

export interface SkelNode {
  id: number;
  x: number;
  y: number;
  /** Ângulo (graus) da primeira parede incidente. */
  angleDeg: number;
  /** Maior espessura das paredes incidentes. */
  thickness: number;
}

export interface SkelChain {
  a: number;
  b: number;
  wallIds: string[];
  thickness: number;
  length: number;
}

export interface Skeleton {
  nodes: SkelNode[];
  chains: SkelChain[];
}

/**
 * Esqueleto dos eixos: nós onde há pilar (canto, T, cruzamento, ponta livre),
 * agrupados quando distam menos que `mergeTol`, e trechos retos entre eles.
 */
export function wallSkeleton(walls: readonly Wall[], mergeTol = 0.3): Skeleton {
  if (walls.length === 0) return { nodes: [], chains: [] };
  const g = buildWallGraph(walls);
  const byId = new Map(walls.map((w) => [w.id, w]));
  const isColumn = (k: string): boolean => {
    const edges = g.adj.get(k)!;
    if (edges.length !== 2) return true;
    const d = edges[1]!.angle - edges[0]!.angle;
    return !(Math.abs(Math.sin(d)) < 1e-6 && Math.cos(d) < 0);
  };
  const raw = [...g.nodes.keys()].filter(isColumn);
  // Agrupamento (union-find) por proximidade.
  const parent = raw.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  for (let i = 0; i < raw.length; i++) {
    for (let j = i + 1; j < raw.length; j++) {
      const a = g.nodes.get(raw[i]!)!;
      const b = g.nodes.get(raw[j]!)!;
      if (Math.hypot(a.x - b.x, a.y - b.y) <= mergeTol) parent[find(j)] = find(i);
    }
  }
  const clusterOfRoot = new Map<number, number>();
  const clusterOfKey = new Map<string, number>();
  const members: string[][] = [];
  raw.forEach((k, i) => {
    const r = find(i);
    if (!clusterOfRoot.has(r)) {
      clusterOfRoot.set(r, members.length);
      members.push([]);
    }
    const c = clusterOfRoot.get(r)!;
    members[c]!.push(k);
    clusterOfKey.set(k, c);
  });
  const nodes: SkelNode[] = members.map((keys, id) => {
    const pts = keys.map((k) => g.nodes.get(k)!);
    const first = g.adj.get(keys[0]!)![0];
    const incident = keys.flatMap((k) => g.adj.get(k)!.flatMap((e) => [...e.wallIds]));
    return {
      id,
      x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
      y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
      angleDeg: ((first?.angle ?? 0) * 180) / Math.PI,
      thickness: Math.max(0, ...incident.map((w) => byId.get(w)?.thickness ?? 0)),
    };
  });

  const chains: SkelChain[] = [];
  const seen = new Set<string>();
  for (const k of raw) {
    for (const e of g.adj.get(k)!) {
      const ids = new Set(e.wallIds);
      let prev = k;
      let cur = e.to;
      for (let guard = 0; guard < 100000 && !clusterOfKey.has(cur); guard++) {
        const next = g.adj.get(cur)!.find((x) => x.to !== prev);
        if (!next) break;
        next.wallIds.forEach((w) => ids.add(w));
        prev = cur;
        cur = next.to;
      }
      const ca = clusterOfKey.get(k)!;
      const cb = clusterOfKey.get(cur);
      if (cb === undefined || ca === cb) continue;
      const key = ca < cb ? `${ca}|${cb}` : `${cb}|${ca}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const na = nodes[ca]!;
      const nb = nodes[cb]!;
      const length = Math.hypot(nb.x - na.x, nb.y - na.y);
      if (length < 1e-6) continue;
      chains.push({ a: ca, b: cb, wallIds: [...ids], thickness: Math.max(0, ...[...ids].map((w) => byId.get(w)?.thickness ?? 0)), length });
    }
  }
  return { nodes, chains };
}
