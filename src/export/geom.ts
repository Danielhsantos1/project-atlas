import type { Pt } from "./dxf-writer";

export const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
export const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
export const mul = (a: Pt, s: number): Pt => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Pt, b: Pt): number => a.x * b.x + a.y * b.y;
export const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);
export const unit = (a: Pt): Pt => {
  const l = Math.hypot(a.x, a.y);
  return l === 0 ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
};
export const perpL = (a: Pt): Pt => ({ x: -a.y, y: a.x });
export const rot = (a: Pt, rad: number): Pt => ({ x: a.x * Math.cos(rad) - a.y * Math.sin(rad), y: a.x * Math.sin(rad) + a.y * Math.cos(rad) });
export const angleDeg = (a: Pt): number => (Math.atan2(a.y, a.x) * 180) / Math.PI;

/** Ângulo de leitura: texto nunca de cabeça para baixo. */
export function readableAngle(deg: number): number {
  let a = ((deg % 360) + 360) % 360;
  if (a > 90 && a <= 270) a -= 180;
  return a > 180 ? a - 360 : a;
}

export function centroid(poly: readonly Pt[]): Pt {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    const k = p.x * q.y - q.x * p.y;
    a += k;
    cx += (p.x + q.x) * k;
    cy += (p.y + q.y) * k;
  }
  return Math.abs(a) < 1e-9 ? poly[0]! : { x: cx / (3 * a), y: cy / (3 * a) };
}

/** Casco convexo (monotone chain), anti-horário. */
export function convexHull(points: readonly Pt[]): Pt[] {
  const pts = [...points].sort((p, q) => p.x - q.x || p.y - q.y);
  if (pts.length < 3) return pts;
  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Pt[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 1e-12) lower.pop();
    lower.push(p);
  }
  const upper: Pt[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 1e-12) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

/**
 * Interseção de uma reta (ponto `o`, direção unitária `d`) com um polígono CONVEXO.
 * Devolve [tMin, tMax] ao longo de `d`, ou null se a reta não cruza o polígono.
 */
export function clipLineConvex(o: Pt, d: Pt, poly: readonly Pt[]): [number, number] | null {
  const ts: number[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const e = sub(b, a);
    const den = d.x * e.y - d.y * e.x;
    if (Math.abs(den) < 1e-12) continue;
    const ao = sub(a, o);
    const t = (ao.x * e.y - ao.y * e.x) / den;
    const s = (ao.x * d.y - ao.y * d.x) / den;
    if (s >= -1e-9 && s <= 1 + 1e-9) ts.push(t);
  }
  if (ts.length < 2) return null;
  return [Math.min(...ts), Math.max(...ts)];
}

/** Elipse (ou círculo) como polilinha fechada. */
export function ellipsePoints(center: Pt, rx: number, ry: number, rotationRad: number, n = 24): Pt[] {
  return Array.from({ length: n }, (_, i) => {
    const t = (i / n) * Math.PI * 2;
    return add(center, rot({ x: rx * Math.cos(t), y: ry * Math.sin(t) }, rotationRad));
  });
}
