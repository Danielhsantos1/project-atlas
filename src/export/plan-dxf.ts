import type { BuildingObject, Opening, Project, Wall } from "../core/model/schema";
import { isRoom, isRoof, isFloor, isObject } from "../core/model/schema";
import { levelWalls } from "../core/model/operations";
import { roomShape } from "../core/geometry/rooms";
import { floorCorners, objectCorners, rectCorners } from "../core/geometry/shapes";
import { objectParts } from "../core/geometry/objects";
import { computeWallJoins, openingHoles, wallFrame, wallLocalToPlan, wallPlanCut, wallSegmentPolygon } from "../core/geometry/wall";
import { degToRad } from "../core/units/units";
import type { Pt } from "./dxf-writer";
import { fmtArea, fmtNum } from "./format";
import { add, centroid, ellipsePoints, mul, rot } from "./geom";
import { dimension, northArrow, scaleBar } from "./annotations";
import { buildAreaRows, buildOpeningSchedule, projectOpenings, totalProjectArea } from "./schedules";
import { legendBlock, notesBlock } from "./blocks";
import { HEADING_MM, LAYER, Scene, Sheet, TEXT_MM, resolveOptions, type BlockSpec, type DxfResult, type ExportOptions } from "./sheet";

/** Altura do plano de corte da planta (m) — igual ao editor 2D. */
export const PLAN_CUT_HEIGHT = 1.2;
const GROUND_COVER = new Set(["grass", "paving-stone"]);

const objectLayer = (kind: BuildingObject["kind"]): string =>
  kind === "column-rect" || kind === "column-round" || kind === "beam" ? LAYER.ESTRUTURA : kind === "stair-straight" ? LAYER.ESCADA : LAYER.MOBILIARIO;

/**
 * Planta baixa de um pavimento em DXF (R12, metros, X leste / Y norte).
 *
 * Representação idêntica à do editor 2D (FloorPlan2D): paredes cortadas a 1,20 m
 * (peças reais de `wallPlanCut` + juntas), folha e arco de porta, porta de correr
 * com duas linhas, vão livre só com batentes, janela com 3 linhas, ambientes com
 * contorno útil tracejado, nome e área no centroide, mobiliário pelas projeções
 * de `objectParts`, cotas por parede e cotas gerais, norte e escala gráfica.
 *
 * As coordenadas da geometria são as do PROJETO (1:1, metros); a moldura da
 * folha é posicionada em volta do desenho. Cotas: ver `annotations.ts`.
 */
export function buildPlanDxf(project: Project, levelId: string, options: ExportOptions): DxfResult {
  const level = project.levels.find((l) => l.id === levelId);
  if (!level) throw new Error(`Pavimento inexistente: ${levelId}`);
  const o = resolveOptions(project, options);
  const k = o.scale / 1000;
  const th = TEXT_MM * k;
  const warnings: string[] = [];
  const scene = new Scene();

  const walls = levelWalls(project, levelId);
  const wallIds = new Set(walls.map((w) => w.id));
  const openings = projectOpenings(project).filter((x) => wallIds.has(x.hostId));
  const wallById = new Map(walls.map((w) => [w.id, w]));
  const joins = computeWallJoins(walls);
  const schedule = buildOpeningSchedule(project, levelId);

  // ---------------- Paredes (peças cortadas a 1,20 m) e eixos ----------------
  for (const w of walls) {
    const ext = joins.get(w.id)!;
    for (const sp of wallPlanCut(w, openings, ext, PLAN_CUT_HEIGHT)) {
      const poly = wallSegmentPolygon(w, sp.u0, sp.u1);
      scene.poly(LAYER.PAREDES, poly, true);
      scene.include(...poly);
    }
    scene.line(LAYER.EIXOS, w.start, w.end);
  }

  // ---------------- Pisos ----------------
  for (const f of project.elements.filter(isFloor)) {
    if (f.levelId !== levelId) continue;
    const c = floorCorners(f);
    scene.poly(LAYER.PISOS, c, true);
    if (!GROUND_COVER.has(f.materialId)) scene.include(...c);
  }

  // ---------------- Ambientes ----------------
  for (const r of project.elements.filter(isRoom)) {
    if (r.levelId !== levelId) continue;
    const shape = roomShape(walls, r.seed);
    if (!shape) {
      warnings.push(`Ambiente "${r.name}" nao esta fechado por paredes: contorno e area omitidos.`);
      continue;
    }
    scene.poly(LAYER.AMBIENTES, shape.inner, true);
    const c = centroid(shape.inner);
    scene.text(LAYER.AMBIENTES, { at: { x: c.x, y: c.y + 0.9 * k }, height: th, text: r.name, halign: "center", valign: "bottom" });
    scene.text(LAYER.AMBIENTES, { at: { x: c.x, y: c.y - 0.9 * k }, height: th, text: fmtArea(shape.area), halign: "center", valign: "top" });
  }

  // ---------------- Objetos: estrutura, escada e mobiliário ----------------
  for (const ob of project.elements.filter(isObject)) {
    if (ob.levelId !== levelId) continue;
    const layer = objectLayer(ob.kind);
    if (layer === LAYER.MOBILIARIO && !o.includeFurniture) continue;
    scene.include(...objectCorners(ob));
    const r = degToRad(ob.rotation);
    for (const part of objectParts(ob)) {
      if (part.sx < 0.02 || part.sy < 0.02) continue;
      const c = add(ob.position, rot({ x: part.x, y: part.y }, r));
      if (part.shape === "box") scene.poly(layer, rectCorners(c, part.sx, part.sy, ob.rotation), true);
      else if (Math.abs(part.sx - part.sy) < 1e-6) scene.circle(layer, c, part.sx / 2);
      else scene.poly(layer, ellipsePoints(c, part.sx / 2, part.sy / 2, r), true);
    }
  }

  // ---------------- Coberturas (projeção tracejada) ----------------
  for (const rf of project.elements.filter(isRoof)) {
    if (rf.levelId !== levelId) continue;
    const c = rectCorners(rf.position, rf.width + rf.overhang * 2, rf.depth + rf.overhang * 2, rf.rotation);
    scene.poly(LAYER.COBERTURA, c, true);
    scene.include(...c);
  }

  // ---------------- Aberturas ----------------
  const off7 = 7 * k;
  for (const op of openings) {
    const host = wallById.get(op.hostId);
    if (host) drawOpening(scene, k, host, op, schedule.codeOf.get(op.id) ?? "?");
  }

  // ---------------- Cotas ----------------
  if (o.includeDimensions && walls.length > 0) {
    for (const w of walls) {
      const f = wallFrame(w);
      const t = w.thickness / 2;
      if (f.length >= 0.3) dimension(scene, k, wallLocalToPlan(f, 0, -t), wallLocalToPlan(f, f.length, -t), { x: -f.normal.x, y: -f.normal.y }, off7);
      // Cadeia de vãos (afastamentos e larguras), pelo lado esquerdo.
      const holes = openingHoles(w, openings).sort((a, b) => a.u0 - b.u0);
      if (holes.length > 0) {
        const marks = [0, ...holes.flatMap((h) => [h.u0, h.u1]), f.length];
        for (let i = 0; i < marks.length - 1; i++) {
          const u0 = marks[i]!;
          const u1 = marks[i + 1]!;
          if (u1 - u0 > 1e-6) dimension(scene, k, wallLocalToPlan(f, u0, t), wallLocalToPlan(f, u1, t), f.normal, off7);
        }
      }
    }
    overallChains(scene, k, walls);
  }

  // ---------------- Quadros ----------------
  const blocks = planBlocks(project, levelId, schedule);

  const sheet = new Sheet({
    project,
    opts: o,
    subject: `PLANTA BAIXA — ${level.name.toUpperCase()}`,
    core: scene.core,
    pad: { l: 28, r: 28, t: 30, b: 48 },
    blocks,
  });

  // ---------------- Anotações da prancha (norte, escala, título) e terreno ----------------
  const core = scene.core ?? { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  northArrow(scene, k, { x: core.maxX + 15 * k, y: core.maxY + 15 * k });
  scaleBar(scene, k, o.scale, { x: core.minX, y: core.minY - 40 * k });
  const midX = (core.minX + core.maxX) / 2;
  scene.text(LAYER.TEXTO, { at: { x: midX, y: core.minY - 29 * k }, height: HEADING_MM * k, text: `PLANTA BAIXA — ${level.name.toUpperCase()}`, halign: "center", valign: "middle" });
  scene.text(LAYER.TEXTO, { at: { x: midX, y: core.minY - 34.5 * k }, height: th, text: `ESCALA 1:${o.scale}`, halign: "center", valign: "middle" });

  const site = [
    { x: 0, y: 0 },
    { x: project.site.width, y: 0 },
    { x: project.site.width, y: project.site.depth },
    { x: 0, y: project.site.depth },
  ];
  const inside = site.every((p) => {
    const q = sheet.toPaper(p);
    return q.x >= sheet.draw.x0 && q.x <= sheet.draw.x1 && q.y >= sheet.draw.y0 && q.y <= sheet.draw.y1;
  });
  if (inside) scene.poly(LAYER.TERRENO, site, true);
  else warnings.push(`Terreno (${fmtNum(project.site.width)} x ${fmtNum(project.site.depth)} m) fora da area util da prancha: contorno do terreno omitido.`);

  return sheet.finish(scene, warnings);
}

/** Extremos dos EIXOS das paredes (para as cotas gerais). */
function axisExtents(walls: readonly Wall[]): { minX: number; maxX: number; minY: number; maxY: number } | null {
  if (walls.length === 0) return null;
  const xs = walls.flatMap((w) => [w.start.x, w.end.x]);
  const ys = walls.flatMap((w) => [w.start.y, w.end.y]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

/** Valores únicos (ordenados) com espaçamento mínimo; mantém sempre o primeiro e o último. */
function spaced(values: number[], min: number): number[] {
  const u = [...new Set(values.map((v) => Math.round(v * 1000) / 1000))].sort((a, b) => a - b);
  if (u.length <= 2) return u;
  const out = [u[0]!];
  for (const v of u.slice(1, -1)) if (v - out[out.length - 1]! >= min && u[u.length - 1]! - v >= min) out.push(v);
  out.push(u[u.length - 1]!);
  return out;
}

/** Cadeias de cotas gerais: parciais (eixo a eixo) embaixo/esquerda, total nos 4 lados. */
function overallChains(scene: Scene, k: number, walls: readonly Wall[]): void {
  const ax = axisExtents(walls);
  const core = scene.core;
  if (!ax || !core) return;
  const gapB = ax.minY - core.minY;
  const gapL = ax.minX - core.minX;
  const gapT = core.maxY - ax.maxY;
  const gapR = core.maxX - ax.maxX;
  const A = (x: number, y: number): Pt => ({ x, y });
  const vertical = walls.filter((w) => Math.abs(w.start.x - w.end.x) < 1e-6);
  const horizontal = walls.filter((w) => Math.abs(w.start.y - w.end.y) < 1e-6);
  const xs = spaced([ax.minX, ax.maxX, ...vertical.map((w) => w.start.x)], 0.3);
  const ys = spaced([ax.minY, ax.maxY, ...horizontal.map((w) => w.start.y)], 0.3);
  for (let i = 0; i < xs.length - 1; i++) dimension(scene, k, A(xs[i]!, ax.minY), A(xs[i + 1]!, ax.minY), { x: 0, y: -1 }, gapB + 10 * k);
  for (let i = 0; i < ys.length - 1; i++) dimension(scene, k, A(ax.minX, ys[i]!), A(ax.minX, ys[i + 1]!), { x: -1, y: 0 }, gapL + 10 * k);
  dimension(scene, k, A(ax.minX, ax.minY), A(ax.maxX, ax.minY), { x: 0, y: -1 }, gapB + 17 * k);
  dimension(scene, k, A(ax.minX, ax.minY), A(ax.minX, ax.maxY), { x: -1, y: 0 }, gapL + 17 * k);
  dimension(scene, k, A(ax.minX, ax.maxY), A(ax.maxX, ax.maxY), { x: 0, y: 1 }, gapT + 10 * k);
  dimension(scene, k, A(ax.maxX, ax.minY), A(ax.maxX, ax.maxY), { x: 1, y: 0 }, gapR + 10 * k);
}

function planBlocks(project: Project, levelId: string, schedule: ReturnType<typeof buildOpeningSchedule>): BlockSpec[] {
  const level = project.levels.find((l) => l.id === levelId)!;
  const { rows } = buildAreaRows(project, levelId);
  const total = rows.reduce((s, r) => s + r.area, 0);
  const areas = Sheet.table(
    "QUADRO DE AREAS",
    "QUADRO DE ÁREAS",
    [
      { header: "Ambiente", widthMm: 56 },
      { header: "Pavimento", widthMm: 38 },
      { header: "Área útil (m²)", widthMm: 26, align: "right" },
    ],
    rows.map((r) => [r.name, r.levelName, fmtNum(r.area)]),
    [
      ["TOTAL DO PAVIMENTO", level.name, fmtNum(total)],
      ["TOTAL DA OBRA", "todos", fmtNum(totalProjectArea(project))],
    ],
  );
  const esq = Sheet.table(
    "QUADRO DE ESQUADRIAS",
    "QUADRO DE ESQUADRIAS",
    [
      { header: "Cód.", widthMm: 10 },
      { header: "Tipo", widthMm: 30 },
      { header: "L x A x P (m)", widthMm: 30 },
      { header: "Qtd.", widthMm: 10, align: "right" },
      { header: "Material", widthMm: 40 },
    ],
    schedule.types.map((t) => [t.code, t.typeLabel, t.dimensions, String(t.quantity), t.materialName]),
  );
  const legend = legendBlock(["wall-cut", "door-swing", "door-sliding", "door-opening", "window", "room", "furniture", "structure", "roof-plan", "axis"]);
  const notes = notesBlock([
    "Planta cortada a 1,20 m acima do piso do pavimento; eixos X (leste) e Y (norte) em metros, coordenadas do projeto.",
    "Cota de cada parede = comprimento do eixo; cotas gerais entre eixos de paredes; cotas de vãos ao longo da parede, entre faces do vão (L x A x P = largura x altura x peitoril).",
    "Área útil = contorno interno do ambiente (descontada meia espessura de cada parede).",
  ]);
  return [areas, esq, legend, notes];
}

function drawOpening(scene: Scene, k: number, wall: Wall, op: Opening, code: string): void {
  const hole = openingHoles(wall, [op])[0];
  if (!hole) return;
  const f = wallFrame(wall);
  const t = wall.thickness / 2;
  const { u0, u1 } = hole;
  const L = (u: number, n: number): Pt => wallLocalToPlan(f, u, n);
  const cut = hole.v0 <= PLAN_CUT_HEIGHT && hole.v1 >= PLAN_CUT_HEIGHT;
  const tagU = (u0 + u1) / 2;
  let tagSide = 1;

  if (op.type === "door" && op.style === "opening") {
    scene.line(LAYER.PORTAS, L(u0, -t), L(u0, t), "DASHED");
    scene.line(LAYER.PORTAS, L(u1, -t), L(u1, t), "DASHED");
  } else if (op.type === "door" && op.style === "sliding") {
    const mid = (u0 + u1) / 2;
    scene.line(LAYER.PORTAS, L(u0, t / 4), L(mid + 0.05, t / 4));
    scene.line(LAYER.PORTAS, L(mid - 0.05, -t / 4), L(u1, -t / 4));
    scene.line(LAYER.PORTAS, L(u0, -t), L(u0, t));
    scene.line(LAYER.PORTAS, L(u1, -t), L(u1, t));
  } else if (op.type === "door") {
    const side = op.opensTo === "left" ? 1 : -1;
    tagSide = -side;
    const hingeU = op.hinge === "left" ? u0 : u1;
    const otherU = op.hinge === "left" ? u1 : u0;
    const w = u1 - u0;
    const pivot = L(hingeU, side * t);
    const leafEnd = L(hingeU, side * (t + w));
    scene.line(LAYER.PORTAS, pivot, leafEnd);
    // Arco anti-horário entre a folha fechada (rumo ao outro batente) e a aberta (normal).
    const closedDir = mul(f.dir, Math.sign(otherU - hingeU));
    const openDir = mul(f.normal, side);
    const a = (Math.atan2(closedDir.y, closedDir.x) * 180) / Math.PI;
    const b = (Math.atan2(openDir.y, openDir.x) * 180) / Math.PI;
    const ccw = closedDir.x * openDir.y - closedDir.y * openDir.x > 0;
    if (ccw) scene.arc(LAYER.PORTAS, pivot, w, a, b, "DASHED");
    else scene.arc(LAYER.PORTAS, pivot, w, b, a, "DASHED");
    scene.line(LAYER.PORTAS, L(u0, -t), L(u0, t));
    scene.line(LAYER.PORTAS, L(u1, -t), L(u1, t));
  } else {
    const lt = cut ? undefined : "DASHED";
    scene.poly(LAYER.JANELAS, [L(u0, t), L(u1, t), L(u1, -t), L(u0, -t)], true, lt);
    scene.line(LAYER.JANELAS, L(u0, 0), L(u1, 0), lt);
  }
  const layer = op.type === "door" ? LAYER.PORTAS : LAYER.JANELAS;
  scene.text(layer, { at: L(tagU, tagSide * (t + 3.2 * k)), height: TEXT_MM * k, text: code, halign: "center", valign: "middle" });
}
