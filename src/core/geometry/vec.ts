/**
 * Vetores do domínio.
 *
 * Sistema de coordenadas do PROJECT ATLAS (convenção CAD/BIM):
 *   X → leste, Y → norte (plano da planta), Z → para cima (cota/elevação).
 * O renderizador 3D (Three.js, Y-up) converte via `toThree` na camada de
 * visualização — o domínio nunca depende da convenção do motor gráfico.
 */
export interface Vec2 {
  x: number;
  y: number;
}

export interface Vec3 extends Vec2 {
  z: number;
}

export const vec2 = (x: number, y: number): Vec2 => ({ x, y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const length = (a: Vec2): number => Math.hypot(a.x, a.y);
export const distance = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

export function normalize(a: Vec2): Vec2 {
  const len = length(a);
  if (len === 0) return { x: 0, y: 0 };
  return { x: a.x / len, y: a.y / len };
}

/** Perpendicular à esquerda (rotação de +90°). */
export const perpLeft = (a: Vec2): Vec2 => ({ x: -a.y, y: a.x });

export function rotate(a: Vec2, radians: number): Vec2 {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c };
}

export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

export const nearlyEqual = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) <= eps;
export const samePoint = (a: Vec2, b: Vec2, eps = 1e-4): boolean => distance(a, b) <= eps;

/**
 * Projeta um ponto num segmento. Retorna o parâmetro t ∈ [0,1], a distância
 * ao longo do segmento (em metros) e a distância perpendicular ao segmento.
 */
export function projectOnSegment(p: Vec2, a: Vec2, b: Vec2) {
  const ab = sub(b, a);
  const len2 = dot(ab, ab);
  const tRaw = len2 === 0 ? 0 : dot(sub(p, a), ab) / len2;
  const t = Math.min(1, Math.max(0, tRaw));
  const point = lerp(a, b, t);
  return { t, along: t * Math.sqrt(len2), point, distance: distance(p, point) };
}

/** Converte ponto do domínio (Z-up) para coordenadas Three.js (Y-up). */
export const toThree = (p: Vec3): [number, number, number] => [p.x, p.z, -p.y];

/** Converte ponto Three.js (Y-up) para o plano do domínio. */
export const fromThree = (x: number, y: number, z: number): Vec3 => ({ x, y: -z, z: y });
