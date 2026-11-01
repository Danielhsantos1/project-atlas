import type { Wall } from "../model/schema";
import type { Vec2 } from "./vec";

/**
 * Detecção de ambientes a partir das paredes (grafo planar dos eixos).
 *
 * 1. Os eixos das paredes são divididos em todos os cruzamentos e encontros em T.
 * 2. As faces do grafo são percorridas pela regra "primeira aresta no sentido horário".
 * 3. O ambiente é a menor face fechada que contém o ponto-semente.
 * O contorno interno desconta meia espessura de cada parede (área útil).
 */

const EPS = 1e-6;
const key = (p: Vec2) => `${Math.round(p.x * 1e4)}|${Math.round(p.y * 1e4)}`;

interface Edge {
  to: string;
  angle: number;
  wallIds: Set<string>;
}

interface Graph {
  nodes: Map<string, Vec2>;
  adj: Map<string, Edge[]>;
}

function segmentParams(a: Vec2, b: Vec2, c: Vec2, d: Vec2): number[] {
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };
  const denom = r.x * s.y - r.y * s.x;
  const qp = { x: c.x - a.x, y: c.y - a.y };
  const len2 = r.x * r.x + r.y * r.y;
  if (Math.abs(denom) < 1e-12) {
    // Paralelos: se colineares, as extremidades de cd que caem em ab viram pontos de divisão.
    if (Math.abs(qp.x * r.y - qp.y * r.x) > 1e-9 * Math.max(1, len2)) return [];
    return [c, d]
      .map((p) => ((p.x - a.x) * r.x + (p.y - a.y) * r.y) / len2)
      .filter((t) => t > EPS && t < 1 - EPS);
  }
  const t = (qp.x * s.y - qp.y * s.x) / denom;
  const u = (qp.x * r.y - qp.y * r.x) / denom;
  if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) return [];
  return t > EPS && t < 1 - EPS ? [t] : [];
}

export function buildWallGraph(walls: readonly Wall[]): Graph {
  const nodes = new Map<string, Vec2>();
  const adj = new Map<string, Edge[]>();
  const addNode = (p: Vec2) => {
    const k = key(p);
    if (!nodes.has(k)) {
      nodes.set(k, p);
      adj.set(k, []);
    }
    return k;
  };
  const addEdge = (from: string, to: string, wallId: string) => {
    const a = nodes.get(from)!;
    const b = nodes.get(to)!;
    const list = adj.get(from)!;
    const existing = list.find((e) => e.to === to);
    if (existing) existing.wallIds.add(wallId);
    else list.push({ to, angle: Math.atan2(b.y - a.y, b.x - a.x), wallIds: new Set([wallId]) });
  };

  for (const w of walls) {
    const ts = [0, 1];
    for (const o of walls) if (o.id !== w.id) ts.push(...segmentParams(w.start, w.end, o.start, o.end));
    const sorted = [...new Set(ts.map((t) => Math.round(t * 1e9) / 1e9))].sort((x, y) => x - y);
    const pts = sorted.map((t) => ({ x: w.start.x + (w.end.x - w.start.x) * t, y: w.start.y + (w.end.y - w.start.y) * t }));
    for (let i = 0; i < pts.length - 1; i++) {
      const ka = addNode(pts[i]!);
      const kb = addNode(pts[i + 1]!);
      if (ka === kb) continue;
      addEdge(ka, kb, w.id);
      addEdge(kb, ka, w.id);
    }
  }
  return { nodes, adj };
}

export const polygonSignedArea = (poly: readonly Vec2[]): number => {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
};

export const polygonPerimeter = (poly: readonly Vec2[]): number =>
  poly.reduce((s, p, i) => {
    const q = poly[(i + 1) % poly.length]!;
    return s + Math.hypot(q.x - p.x, q.y - p.y);
  }, 0);

export function pointInPolygon(p: Vec2, poly: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

interface Face {
  nodes: string[];
  polygon: Vec2[];
  area: number;
  /** Paredes de cada aresta i → i+1. */
  edgeWalls: Set<string>[];
}

export function graphFaces(g: Graph): Face[] {
  const visited = new Set<string>();
  const faces: Face[] = [];
  const norm = (a: number) => (a < 0 ? a + Math.PI * 2 : a);
  for (const [from, edges] of g.adj) {
    for (const e of edges) {
      if (visited.has(`${from}>${e.to}`)) continue;
      const nodes: string[] = [];
      const edgeWalls: Set<string>[] = [];
      let u = from;
      let cur = e;
      for (let guard = 0; guard < 10000; guard++) {
        const id = `${u}>${cur.to}`;
        if (visited.has(id)) break;
        visited.add(id);
        nodes.push(u);
        edgeWalls.push(cur.wallIds);
        const v = cur.to;
        const out = g.adj.get(v)!;
        const back = norm(Math.atan2(g.nodes.get(u)!.y - g.nodes.get(v)!.y, g.nodes.get(u)!.x - g.nodes.get(v)!.x));
        // Primeira aresta no sentido horário a partir da aresta de volta.
        let best: Edge | null = null;
        let bestDelta = Infinity;
        for (const o of out) {
          let delta = back - norm(o.angle);
          if (delta <= 1e-9) delta += Math.PI * 2;
          if (o.to === u && out.length > 1) continue;
          if (delta < bestDelta) {
            bestDelta = delta;
            best = o;
          }
        }
        if (!best) break;
        u = v;
        cur = best;
      }
      const polygon = nodes.map((k) => g.nodes.get(k)!);
      faces.push({ nodes, polygon, area: polygonSignedArea(polygon), edgeWalls });
    }
  }
  return faces;
}

/** Remove vértices colineares (encontros em T no meio de um lado). */
export function simplifyPolygon(poly: readonly Vec2[]): Vec2[] {
  const out = [...poly];
  let changed = true;
  while (changed && out.length > 3) {
    changed = false;
    for (let i = 0; i < out.length; i++) {
      const a = out[(i + out.length - 1) % out.length]!;
      const b = out[i]!;
      const c = out[(i + 1) % out.length]!;
      const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      if (Math.abs(cross) < 1e-9) {
        out.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return out;
}

export interface RoomShape {
  /** Contorno pelos eixos das paredes (anti-horário). */
  axis: Vec2[];
  /** Contorno interno (descontada meia espessura das paredes). */
  inner: Vec2[];
  /** Área útil (m²). */
  area: number;
  /** Perímetro interno (m). */
  perimeter: number;
  /** Paredes que delimitam o ambiente. */
  wallIds: string[];
  /** Retângulo alinhado aos eixos X/Y (permite editar largura/profundidade). */
  rect: { minX: number; maxX: number; minY: number; maxY: number } | null;
}

function offsetInner(poly: Vec2[], thickness: number[]): Vec2[] {
  const n = poly.length;
  const lines = poly.map((p, i) => {
    const q = poly[(i + 1) % n]!;
    const len = Math.hypot(q.x - p.x, q.y - p.y) || 1;
    const nx = -(q.y - p.y) / len;
    const ny = (q.x - p.x) / len;
    const o = (thickness[i] ?? 0) / 2;
    return { p: { x: p.x + nx * o, y: p.y + ny * o }, d: { x: (q.x - p.x) / len, y: (q.y - p.y) / len } };
  });
  return lines.map((cur, i) => {
    const prev = lines[(i + n - 1) % n]!;
    const denom = prev.d.x * cur.d.y - prev.d.y * cur.d.x;
    if (Math.abs(denom) < 1e-9) return cur.p;
    const t = ((cur.p.x - prev.p.x) * cur.d.y - (cur.p.y - prev.p.y) * cur.d.x) / denom;
    return { x: prev.p.x + prev.d.x * t, y: prev.p.y + prev.d.y * t };
  });
}

/** Contorno do ambiente que contém `seed`, ou null se o ponto não estiver num espaço fechado. */
export function roomShape(walls: readonly Wall[], seed: Vec2): RoomShape | null {
  if (walls.length < 3) return null;
  const faces = graphFaces(buildWallGraph(walls)).filter((f) => f.area > 1e-4 && pointInPolygon(seed, f.polygon));
  if (faces.length === 0) return null;
  const face = faces.reduce((a, b) => (b.area < a.area ? b : a));
  const byId = new Map(walls.map((w) => [w.id, w]));
  const thickness = face.edgeWalls.map((ids) => Math.max(...[...ids].map((id) => byId.get(id)?.thickness ?? 0)));
  const inner = offsetInner(face.polygon, thickness);
  const simple = simplifyPolygon(face.polygon);
  const xs = simple.map((p) => p.x);
  const ys = simple.map((p) => p.y);
  const isRect = simple.length === 4 && simple.every((p, i) => {
    const q = simple[(i + 1) % 4]!;
    return Math.abs(p.x - q.x) < 1e-6 || Math.abs(p.y - q.y) < 1e-6;
  });
  return {
    axis: face.polygon,
    inner,
    area: Math.abs(polygonSignedArea(inner)),
    perimeter: polygonPerimeter(inner),
    wallIds: [...new Set(face.edgeWalls.flatMap((s) => [...s]))],
    rect: isRect ? { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) } : null,
  };
}

/**
 * Trechos de [a,b] ainda não cobertos por paredes colineares existentes —
 * usado para não duplicar paredes quando cômodos são encostados.
 */
export function uncoveredSegments(a: Vec2, b: Vec2, walls: readonly Wall[], tol = 1e-3): Array<[Vec2, Vec2]> {
  const L = Math.hypot(b.x - a.x, b.y - a.y);
  if (L < EPS) return [];
  const d = { x: (b.x - a.x) / L, y: (b.y - a.y) / L };
  const along = (p: Vec2) => (p.x - a.x) * d.x + (p.y - a.y) * d.y;
  const off = (p: Vec2) => Math.abs((p.x - a.x) * d.y - (p.y - a.y) * d.x);
  const covered: Array<[number, number]> = [];
  for (const w of walls) {
    if (off(w.start) > tol || off(w.end) > tol) continue;
    const s = along(w.start);
    const e = along(w.end);
    covered.push([Math.max(0, Math.min(s, e)), Math.min(L, Math.max(s, e))]);
  }
  covered.sort((x, y) => x[0] - y[0]);
  const free: Array<[number, number]> = [];
  let cursor = 0;
  for (const [s, e] of covered) {
    if (e <= cursor + tol) continue;
    if (s > cursor + tol) free.push([cursor, s]);
    cursor = Math.max(cursor, e);
  }
  if (L > cursor + tol) free.push([cursor, L]);
  const at = (t: number): Vec2 => ({ x: Math.round((a.x + d.x * t) * 1e6) / 1e6, y: Math.round((a.y + d.y * t) * 1e6) / 1e6 });
  return free.filter(([s, e]) => e - s > 0.05).map(([s, e]) => [at(s), at(e)]);
}
