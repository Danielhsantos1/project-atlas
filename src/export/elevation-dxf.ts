import type { Opening, Project, Wall } from "../core/model/schema";
import { isRoof } from "../core/model/schema";
import { levelWalls } from "../core/model/operations";
import { computeWallJoins, computeWallPieces, openingHoles, wallFrame, wallLocalToPlan } from "../core/geometry/wall";
import { roofGeometry } from "../core/geometry/roof";
import { degToRad } from "../core/units/units";
import type { Pt } from "./dxf-writer";
import { convexHull, dot, rot } from "./geom";
import { buildOpeningSchedule, projectOpenings } from "./schedules";
import { LAYER, Scene, resolveOptions, type DxfResult, type ExportOptions } from "./sheet";
import { finishView } from "./vertical";

export type ElevationSide = "front" | "back" | "left" | "right";

/**
 * Para cada lado: `right` = direção do plano que vira o eixo horizontal da
 * vista (para a direita do observador) e `into` = direção do observador para a
 * cena. "front" = observador ao sul olhando para o norte (X cresce para a direita).
 */
export const VIEWS: Record<ElevationSide, { right: Pt; into: Pt; title: string }> = {
  front: { right: { x: 1, y: 0 }, into: { x: 0, y: 1 }, title: "FACHADA FRONTAL" },
  back: { right: { x: -1, y: 0 }, into: { x: 0, y: -1 }, title: "FACHADA POSTERIOR" },
  left: { right: { x: 0, y: -1 }, into: { x: 1, y: 0 }, title: "FACHADA LATERAL ESQUERDA" },
  right: { right: { x: 0, y: 1 }, into: { x: -1, y: 0 }, title: "FACHADA LATERAL DIREITA" },
};

interface Rect {
  xa: number;
  xb: number;
  z0: number;
  z1: number;
  depth: number;
  parallel: boolean;
  wallId: string;
}

const EPS = 1e-6;

/** Subtrai intervalos de [a,b]. */
function subtractIntervals(a: number, b: number, cuts: Array<[number, number]>): Array<[number, number]> {
  const sorted = cuts.filter(([c0, c1]) => c1 > a && c0 < b).sort((p, q) => p[0] - q[0]);
  const out: Array<[number, number]> = [];
  let cur = a;
  for (const [c0, c1] of sorted) {
    if (c0 > cur + EPS) out.push([cur, Math.min(c0, b)]);
    cur = Math.max(cur, c1);
  }
  if (b > cur + EPS) out.push([cur, b]);
  return out;
}

/**
 * Fachada ortogonal (elevação) em DXF.
 *
 * SIMPLIFICAÇÕES (honestas):
 *  - Mostra paredes cujo plano não é perpendicular à vista (|cos| ≥ 0,2). Paredes
 *    perpendiculares à vista (vistas "de topo") não são desenhadas.
 *  - Ocultamento de linhas SIMPLIFICADO: trechos de paredes paralelas ao plano da
 *    vista são recortados (no eixo horizontal) apenas onde uma peça sólida MAIS
 *    PRÓXIMA cobre toda a altura do trecho. Não há remoção geral de linhas ocultas.
 *    Paredes inclinadas em relação à vista são desenhadas inteiras.
 *  - Espessura das paredes ignorada (projeção das faces). Lajes, mobiliário,
 *    escadas, pilares e vegetação NÃO são representados.
 *  - Esquadrias: retângulo externo + batente interno (+ montante nas janelas),
 *    com o mesmo código da planta; sem desenho de folhas/vidros.
 *  - Cobertura: silhueta = casco convexo da superfície paramétrica (com a
 *    espessura aproximada por deslocamento vertical).
 * Eixo horizontal do DXF = horizontal da vista; eixo vertical do DXF = cota Z.
 */
export function buildElevationDxf(project: Project, side: ElevationSide, options: ExportOptions): DxfResult {
  const view = VIEWS[side];
  if (!view) throw new Error(`Lado de fachada inválido: ${String(side)}`);
  const o = resolveOptions(project, options);
  const warnings: string[] = [];
  const scene = new Scene();
  const schedule = buildOpeningSchedule(project);
  const allOpenings = projectOpenings(project);
  const { right, into } = view;
  const U = (p: Pt) => dot(p, right);

  // 1) Peças sólidas de todas as paredes, já projetadas.
  const rects: Rect[] = [];
  const items: Array<{ wall: Wall; levelElev: number; openings: Opening[] }> = [];
  for (const level of project.levels) {
    const walls = levelWalls(project, level.id);
    const joins = computeWallJoins(walls);
    const ids = new Set(walls.map((w) => w.id));
    const openings = allOpenings.filter((x) => ids.has(x.hostId));
    for (const w of walls) {
      const f = wallFrame(w);
      const cosA = Math.abs(dot(f.dir, right));
      if (cosA < 0.2) continue;
      const parallel = cosA > 0.999;
      const mid = wallLocalToPlan(f, f.length / 2);
      items.push({ wall: w, levelElev: level.elevation, openings });
      for (const p of computeWallPieces(w, openings, joins.get(w.id)!)) {
        const a = U(wallLocalToPlan(f, p.u0));
        const b = U(wallLocalToPlan(f, p.u1));
        if (Math.abs(b - a) < EPS) continue;
        const z0 = level.elevation + w.baseElevation;
        rects.push({ xa: Math.min(a, b), xb: Math.max(a, b), z0: z0 + p.v0, z1: z0 + p.v1, depth: dot(mid, into), parallel, wallId: w.id });
      }
    }
  }

  // 2) Recorte pelas peças paralelas mais próximas que cobrem toda a altura.
  const coverersFor = (r: Rect) => rects.filter((c) => c.parallel && c.depth < r.depth - 0.02 && c.z0 <= r.z0 + EPS && c.z1 >= r.z1 - EPS);
  let xMin = Infinity;
  let xMax = -Infinity;
  let zTop = -Infinity;
  for (const r of rects) {
    const visible = subtractIntervals(r.xa, r.xb, coverersFor(r).map((c): [number, number] => [c.xa, c.xb]));
    for (const [a, b] of visible) {
      if (b - a < 1e-4) continue;
      scene.poly(LAYER.PAREDES, [{ x: a, y: r.z0 }, { x: b, y: r.z0 }, { x: b, y: r.z1 }, { x: a, y: r.z1 }], true);
      xMin = Math.min(xMin, a);
      xMax = Math.max(xMax, b);
      zTop = Math.max(zTop, r.z1);
    }
  }

  // 3) Esquadrias das paredes desenhadas.
  for (const it of items) {
    const f = wallFrame(it.wall);
    for (const op of it.openings.filter((x) => x.hostId === it.wall.id)) {
      const hole = openingHoles(it.wall, [op])[0];
      if (!hole) continue;
      const a = U(wallLocalToPlan(f, hole.u0));
      const b = U(wallLocalToPlan(f, hole.u1));
      const xa = Math.min(a, b);
      const xb = Math.max(a, b);
      const z0 = it.levelElev + it.wall.baseElevation + hole.v0;
      const z1 = it.levelElev + it.wall.baseElevation + hole.v1;
      const depth = dot(wallLocalToPlan(f, f.length / 2), into);
      const xm = (xa + xb) / 2;
      const hidden = rects.some((c) => c.parallel && c.depth < depth - 0.02 && c.xa <= xm && c.xb >= xm && c.z0 <= z0 + EPS && c.z1 >= z1 - EPS);
      if (hidden || Math.abs(f.dir.x * right.x + f.dir.y * right.y) < 0.999) continue;
      const layer = op.type === "door" ? LAYER.PORTAS : LAYER.JANELAS;
      const box = (x0: number, y0: number, x1: number, y1: number) => scene.poly(layer, [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }], true);
      box(xa, z0, xb, z1);
      const fr = Math.min(0.05, (xb - xa) / 4, (z1 - z0) / 4);
      box(xa + fr, z0 + fr, xb - fr, z1 - fr);
      if (op.type === "window" && xb - xa > 0.5) scene.line(layer, { x: xm, y: z0 + fr }, { x: xm, y: z1 - fr });
      if (op.type === "door" && op.style === "sliding") scene.line(layer, { x: xm, y: z0 + fr }, { x: xm, y: z1 - fr });
      scene.text(layer, { at: { x: xm, y: (z0 + z1) / 2 }, height: (o.scale / 1000) * 2.5, text: schedule.codeOf.get(op.id) ?? "?", halign: "center", valign: "middle" });
    }
  }

  // 4) Silhuetas das coberturas.
  for (const rf of project.elements.filter(isRoof)) {
    const level = project.levels.find((l) => l.id === rf.levelId);
    if (!level) continue;
    const g = roofGeometry(rf);
    const pts: Pt[] = [];
    for (const tri of g.surface)
      for (const [x, y, z] of tri) {
        const p = rot({ x, y }, degToRad(rf.rotation));
        const px = U({ x: rf.position.x + p.x, y: rf.position.y + p.y });
        const zz = level.elevation + rf.baseHeight + z;
        pts.push({ x: px, y: zz }, { x: px, y: zz - rf.thickness });
      }
    const hull = convexHull(pts);
    if (hull.length < 3) continue;
    scene.poly(LAYER.COBERTURA, hull, true, "CONTINUOUS");
    for (const p of hull) {
      xMin = Math.min(xMin, p.x);
      xMax = Math.max(xMax, p.x);
      zTop = Math.max(zTop, p.y);
    }
  }

  if (!Number.isFinite(xMin)) {
    warnings.push("Nenhuma parede ou cobertura visivel nesta fachada; a prancha ficou vazia.");
    xMin = 0;
    xMax = 1;
    zTop = 1;
  }

  return finishView({
    project,
    o,
    scene,
    subject: view.title,
    x0: xMin,
    x1: xMax,
    zTop,
    legend: ["wall-elev", "opening-elev", "roof-elev", "level", "ground"],
    notes: [
      "Niveis em metros; +/-0,00 = piso do pavimento mais baixo.",
      "Ocultamento de linhas simplificado: apenas paredes paralelas ao plano da vista sao recortadas por pecas mais proximas; lajes, mobiliario, escadas e vegetacao nao sao representados.",
      "Esquadrias com o mesmo codigo da planta baixa (ver QUADRO DE ESQUADRIAS).",
      "Silhueta da cobertura indicativa (superficie parametrica).",
    ],
    warnings,
  });
}

