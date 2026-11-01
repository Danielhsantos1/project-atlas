import { angleDeg, clipLineConvex, dist, dot, mul, add, perpL, readableAngle, sub, unit } from "./geom";
import type { Pt } from "./dxf-writer";
import { fmtLen, fmtNum } from "./format";
import { LAYER, Scene, TEXT_MM, HEADING_MM } from "./sheet";
import { estimateTextWidth } from "./dxf-writer";

/**
 * Cotas desenhadas com LINE + TEXT (e não com entidades DIMENSION). Motivo: no
 * formato R12 uma DIMENSION exige um BLOCO anônimo (`*D1`) com a geometria já
 * desenhada, o que é frágil entre visualizadores; LINE+TEXT aparece igual em
 * todos. Custo: as cotas NÃO são associativas (não acompanham o desenho se
 * editado no CAD).
 */
export interface DimOptions {
  /** Texto; padrão: distância a→b formatada em pt-BR (ex.: "5,00"). */
  text?: string;
  /** Não desenha o texto se não couber entre as marcas. */
  hideTextIfTight?: boolean;
  layer?: string;
}

/**
 * Cota linear entre `a` e `b`, deslocada `off` metros na direção unitária `n`
 * (ângulo de marcas a 45°, linhas de chamada com folga). `k` = metros por mm de papel.
 */
export function dimension(scene: Scene, k: number, a: Pt, b: Pt, n: Pt, off: number, o: DimOptions = {}): void {
  const layer = o.layer ?? LAYER.COTAS;
  const len = dist(a, b);
  if (len < 1e-6) return;
  const dir = unit(sub(b, a));
  const nn = unit(n);
  const A = add(a, mul(nn, off));
  const B = add(b, mul(nn, off));
  const sgn = off >= 0 ? 1 : -1;
  const gap = 1 * k * sgn;
  const over = 1.5 * k * sgn;
  scene.line(layer, add(a, mul(nn, gap)), add(A, mul(nn, over)));
  scene.line(layer, add(b, mul(nn, gap)), add(B, mul(nn, over)));
  scene.line(layer, A, B);
  const tick = mul(unit(add(dir, nn)), 1.2 * k);
  for (const p of [A, B]) scene.line(layer, sub(p, tick), add(p, tick));

  const text = o.text ?? fmtLen(len);
  const needMm = estimateTextWidth(text, TEXT_MM) * 0.85;
  if (o.hideTextIfTight !== false && len / k < needMm) return;
  const ang = readableAngle(angleDeg(dir));
  const up = perpL({ x: Math.cos((ang * Math.PI) / 180), y: Math.sin((ang * Math.PI) / 180) });
  const side = dot(nn, up) * sgn >= 0 ? 1 : -1;
  const mid = mul(add(A, B), 0.5);
  scene.text(layer, {
    at: add(mid, mul(up, side * 0.8 * k)),
    height: TEXT_MM * k,
    text,
    rotation: ang,
    halign: "center",
    valign: side > 0 ? "bottom" : "top",
  });
}

/** Hachura diagonal (45°) de um polígono convexo, alinhada a uma grade global (peças vizinhas continuam as linhas). */
export function hatchConvex(scene: Scene, poly: readonly Pt[], spacing: number, layer: string = LAYER.HACHURA): void {
  const d = { x: Math.SQRT1_2, y: Math.SQRT1_2 };
  const m = { x: -Math.SQRT1_2, y: Math.SQRT1_2 };
  const cs = poly.map((p) => dot(p, m));
  const lo = Math.min(...cs);
  const hi = Math.max(...cs);
  if ((hi - lo) / spacing > 4000) return;
  for (let c = Math.ceil(lo / spacing) * spacing; c <= hi + 1e-9; c += spacing) {
    if (c <= lo + 1e-9 || c >= hi - 1e-9) continue;
    const o = mul(m, c);
    const t = clipLineConvex(o, d, poly);
    if (!t || t[1] - t[0] < 1e-6) continue;
    scene.line(layer, add(o, mul(d, t[0])), add(o, mul(d, t[1])));
  }
}

/** Seta de norte (aponta para +Y do projeto). `c` = centro; tamanho em mm de papel. */
export function northArrow(scene: Scene, k: number, c: Pt): void {
  const P = (x: number, y: number): Pt => ({ x: c.x + x * k, y: c.y + y * k });
  scene.circle(LAYER.TEXTO, c, 7 * k);
  scene.poly(LAYER.TEXTO, [P(0, 7), P(3, -5), P(0, -2.5), P(-3, -5)], true);
  scene.solid(LAYER.TEXTO, P(0, 7), P(0, -2.5), P(-3, -5));
  scene.text(LAYER.TEXTO, { at: P(0, 8.5), height: HEADING_MM * k, text: "N", halign: "center", valign: "bottom" });
}

/** Escala gráfica de duas divisões; comprimento "redondo" que ocupa 20–60 mm de papel. */
export function scaleBar(scene: Scene, k: number, scale: number, at: Pt): number {
  const nice = [1, 2, 5, 10, 20, 50, 100];
  const L = nice.find((n) => (n * 1000) / scale >= 20) ?? 100;
  const h = 1.5 * k;
  const half = L / 2;
  const P = (x: number, y: number): Pt => ({ x: at.x + x, y: at.y + y });
  scene.poly(LAYER.TEXTO, [P(0, 0), P(L, 0), P(L, h), P(0, h)], true);
  scene.line(LAYER.TEXTO, P(half, 0), P(half, h));
  scene.solid(LAYER.TEXTO, P(0, 0), P(half, 0), P(half, h), P(0, h));
  const ty = -1 * k;
  scene.text(LAYER.TEXTO, { at: P(0, ty), height: TEXT_MM * k, text: "0", halign: "center", valign: "top" });
  scene.text(LAYER.TEXTO, { at: P(half, ty), height: TEXT_MM * k, text: fmtNum(half, half % 1 === 0 ? 0 : 1), halign: "center", valign: "top" });
  scene.text(LAYER.TEXTO, { at: P(L, ty), height: TEXT_MM * k, text: `${L} m`, halign: "center", valign: "top" });
  return L;
}
