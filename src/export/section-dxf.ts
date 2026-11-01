import type { Opening, Project } from "../core/model/schema";
import { isFloor, isObject, isRoof, isRoom } from "../core/model/schema";
import { levelWalls } from "../core/model/operations";
import { computeWallJoins, computeWallPieces, wallFrame } from "../core/geometry/wall";
import { roomShape } from "../core/geometry/rooms";
import { floorCorners, rectCorners } from "../core/geometry/shapes";
import { objectParts } from "../core/geometry/objects";
import { roofGeometry } from "../core/geometry/roof";
import { degToRad } from "../core/units/units";
import type { Pt } from "./dxf-writer";
import { estimateTextWidth } from "./dxf-writer";
import { hatchConvex } from "./annotations";
import { fmtLen, fmtNum } from "./format";
import { add, clipLineConvex, dot, ellipsePoints, rot } from "./geom";
import { projectOpenings } from "./schedules";
import { LAYER, Scene, TEXT_MM, resolveOptions, type DxfResult, type ExportOptions } from "./sheet";
import { finishView } from "./vertical";

const EPS = 1e-6;

/**
 * Corte (seção vertical) em DXF.
 *
 * `axis: "y"` => plano de corte Y = position, observador olhando para +Y (X cresce
 * para a direita). `axis: "x"` => plano X = position, observador olhando para +X
 * (o eixo horizontal da vista é -Y, isto é, o sul fica à direita).
 *
 * Elementos CORTADOS (desenhados com contorno fechado + hachura diagonal a 45° na
 * camada HACHURA — escolhida em vez de contorno mais grosso porque o R12 não tem
 * espessura de linha por camada): paredes (peças sólidas reais, vãos de portas e
 * janelas ficam vazios), lajes/pisos, pilares/vigas e degraus de escada.
 * Cobertura: interseção do plano com a superfície paramétrica, em LINHAS (face
 * superior e inferior deslocada pela espessura) — sem hachura.
 *
 * SIMPLIFICAÇÕES: NÃO há elementos "em vista" além do plano (paredes, esquadrias e
 * mobiliário atrás do corte não são desenhados); parede cruzada em ângulo usa a
 * largura espessura/|cos|, sem fechar o canto; a escada é a união de blocos
 * (cada degrau é um paralelepípedo do chão até o topo do degrau, como no 3D).
 * Rótulos de ambiente: nome e pé-direito no maior trecho do ambiente cortado.
 * Eixo horizontal do DXF = horizontal da vista; eixo vertical = cota Z.
 */
export function buildSectionDxf(project: Project, axis: "x" | "y", position: number, options: ExportOptions): DxfResult {
  if (axis !== "x" && axis !== "y") throw new Error(`Eixo de corte inválido: ${String(axis)}`);
  if (!Number.isFinite(position)) throw new Error("Posição do corte inválida.");
  const o = resolveOptions(project, options);
  const k = o.scale / 1000;
  const warnings: string[] = [];
  const scene = new Scene();

  const n: Pt = axis === "y" ? { x: 0, y: 1 } : { x: 1, y: 0 };
  const right: Pt = axis === "y" ? { x: 1, y: 0 } : { x: 0, y: -1 };
  const origin: Pt = { x: n.x * position, y: n.y * position };
  const U = (p: Pt) => dot(p, right);

  let xMin = Infinity;
  let xMax = -Infinity;
  let zTop = -Infinity;
  let cutCount = 0;
  const grow = (x0: number, x1: number, z1: number) => {
    xMin = Math.min(xMin, x0);
    xMax = Math.max(xMax, x1);
    zTop = Math.max(zTop, z1);
  };
  const cutRect = (layer: string, x0: number, z0: number, x1: number, z1: number, hatch: boolean) => {
    if (x1 - x0 < EPS || z1 - z0 < EPS) return;
    const poly: Pt[] = [{ x: x0, y: z0 }, { x: x1, y: z0 }, { x: x1, y: z1 }, { x: x0, y: z1 }];
    scene.poly(layer, poly, true);
    if (hatch) hatchConvex(scene, poly, 3 * k);
    grow(x0, x1, z1);
    cutCount++;
  };
  /** Trecho [t0,t1] (em X da vista) em que o plano atravessa um polígono convexo. */
  const chord = (poly: readonly Pt[]): [number, number] | null => {
    const d = right;
    const t = clipLineConvex(origin, d, poly);
    if (!t || t[1] - t[0] < 1e-4) return null;
    return [t[0], t[1]];
  };

  const allOpenings = projectOpenings(project);

  for (const level of project.levels) {
    const walls = levelWalls(project, level.id);
    const joins = computeWallJoins(walls);
    const ids = new Set(walls.map((w) => w.id));
    const openings: Opening[] = allOpenings.filter((x) => ids.has(x.hostId));

    // ---- Paredes ----
    for (const w of walls) {
      const f = wallFrame(w);
      const ext = joins.get(w.id)!;
      const base = level.elevation + w.baseElevation;
      const dn = dot(f.dir, n);
      const pieces = computeWallPieces(w, openings, ext);
      if (Math.abs(dn) < 1e-6) {
        // Plano paralelo à parede: corta no sentido do comprimento se estiver dentro da espessura.
        if (Math.abs(dot(w.start, n) - position) > w.thickness / 2 + EPS) continue;
        for (const p of pieces) {
          const a = U({ x: w.start.x + f.dir.x * p.u0, y: w.start.y + f.dir.y * p.u0 });
          const b = U({ x: w.start.x + f.dir.x * p.u1, y: w.start.y + f.dir.y * p.u1 });
          cutRect(LAYER.PAREDES, Math.min(a, b), base + p.v0, Math.max(a, b), base + p.v1, true);
        }
      } else {
        const s = (position - dot(w.start, n)) / dn; // posição ao longo do eixo
        if (s < -ext.start - EPS || s > f.length + ext.end + EPS) continue;
        const c = U({ x: w.start.x + f.dir.x * s, y: w.start.y + f.dir.y * s });
        const half = w.thickness / (2 * Math.abs(dn));
        for (const p of pieces) {
          if (p.u0 > s + EPS || p.u1 < s - EPS) continue;
          cutRect(LAYER.PAREDES, c - half, base + p.v0, c + half, base + p.v1, true);
        }
      }
    }

    // ---- Lajes / pisos ----
    for (const fl of project.elements.filter(isFloor)) {
      if (fl.levelId !== level.id) continue;
      const t = chord(floorCorners(fl));
      if (!t) continue;
      const top = level.elevation + fl.position.z;
      cutRect(LAYER.PISOS, t[0], top - fl.thickness, t[1], top, true);
    }

    // ---- Escada, pilares e vigas ----
    for (const ob of project.elements.filter(isObject)) {
      if (ob.levelId !== level.id) continue;
      if (ob.kind !== "stair-straight" && ob.kind !== "column-rect" && ob.kind !== "column-round" && ob.kind !== "beam") continue;
      const layer = ob.kind === "stair-straight" ? LAYER.ESCADA : LAYER.ESTRUTURA;
      const r = degToRad(ob.rotation);
      for (const part of objectParts(ob)) {
        const c = add(ob.position, rot({ x: part.x, y: part.y }, r));
        const poly = part.shape === "box" ? rectCorners(c, part.sx, part.sy, ob.rotation) : ellipsePoints(c, part.sx / 2, part.sy / 2, r, 32);
        const t = chord(poly);
        if (!t) continue;
        const z0 = level.elevation + ob.position.z + part.z - part.sz / 2;
        cutRect(layer, t[0], z0, t[1], z0 + part.sz, ob.kind !== "stair-straight");
      }
    }

    // ---- Rótulos de ambientes ----
    for (const room of project.elements.filter(isRoom)) {
      if (room.levelId !== level.id) continue;
      const shape = roomShape(walls, room.seed);
      if (!shape) continue;
      const segs = segmentsOfPolygon(origin, right, shape.inner);
      if (segs.length === 0) continue;
      const best = segs.reduce((a, b) => (b[1] - b[0] > a[1] - a[0] ? b : a));
      const label = room.name;
      const sub = `PD ${fmtLen(room.ceilingHeight)}`;
      const need = estimateTextWidth(label, TEXT_MM * k);
      if (best[1] - best[0] < need * 0.85) {
        warnings.push(`Rotulo do ambiente "${room.name}" omitido no corte: trecho cortado estreito demais para o texto.`);
        continue;
      }
      const xm = (best[0] + best[1]) / 2;
      const zc = level.elevation + 1.2;
      scene.text(LAYER.AMBIENTES, { at: { x: xm, y: zc + 0.9 * k }, height: TEXT_MM * k, text: label, halign: "center", valign: "bottom" });
      scene.text(LAYER.AMBIENTES, { at: { x: xm, y: zc - 0.9 * k }, height: TEXT_MM * k, text: sub, halign: "center", valign: "top" });
    }

    // ---- Coberturas ----
    for (const rf of project.elements.filter(isRoof)) {
      if (rf.levelId !== level.id) continue;
      const g = roofGeometry(rf);
      const rr = degToRad(rf.rotation);
      const zBase = level.elevation + rf.baseHeight;
      const world = (p: [number, number, number]): { x: number; y: number; z: number } => {
        const q = rot({ x: p[0], y: p[1] }, rr);
        return { x: rf.position.x + q.x, y: rf.position.y + q.y, z: zBase + p[2] };
      };
      const segs: Array<[Pt, Pt]> = [];
      for (const tri of g.surface) {
        const pts = tri.map(world);
        const sd = pts.map((p) => dot(p, n) - position);
        const cuts: Pt[] = [];
        for (let i = 0; i < 3; i++) {
          const a = pts[i]!;
          const b = pts[(i + 1) % 3]!;
          const da = sd[i]!;
          const db = sd[(i + 1) % 3]!;
          if ((da < -EPS && db > EPS) || (da > EPS && db < -EPS)) {
            const t = da / (da - db);
            cuts.push({ x: U({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }), y: a.z + (b.z - a.z) * t });
          } else if (Math.abs(da) <= EPS) cuts.push({ x: U(a), y: a.z });
        }
        // Remove duplicados (vértice sobre o plano é contado por duas arestas).
        const uniq = cuts.filter((p, i) => cuts.findIndex((q) => Math.hypot(q.x - p.x, q.y - p.y) < 1e-6) === i);
        if (uniq.length === 2 && Math.hypot(uniq[0]!.x - uniq[1]!.x, uniq[0]!.y - uniq[1]!.y) > 1e-6) segs.push([uniq[0]!, uniq[1]!]);
      }
      if (segs.length === 0) continue;
      for (const [a, b] of segs) {
        scene.line(LAYER.COBERTURA, a, b);
        scene.line(LAYER.COBERTURA, { x: a.x, y: a.y - rf.thickness }, { x: b.x, y: b.y - rf.thickness });
        grow(Math.min(a.x, b.x), Math.max(a.x, b.x), Math.max(a.y, b.y));
      }
      const all = segs.flat();
      const lo = all.reduce((m, p) => (p.x < m.x ? p : m));
      const hi = all.reduce((m, p) => (p.x > m.x ? p : m));
      for (const p of [lo, hi]) scene.line(LAYER.COBERTURA, p, { x: p.x, y: p.y - rf.thickness });
      cutCount++;
    }
  }

  if (cutCount === 0 || !Number.isFinite(xMin)) {
    warnings.push(`O plano de corte ${axis.toUpperCase()} = ${fmtNum(position)} m nao intercepta nenhum elemento; a prancha ficou vazia.`);
    xMin = 0;
    xMax = 1;
    zTop = 1;
  }

  const kind = axis === "y" ? "LONGITUDINAL" : "TRANSVERSAL";
  return finishView({
    project,
    o,
    scene,
    subject: `CORTE ${kind} — PLANO ${axis.toUpperCase()} = ${fmtNum(position)} m`,
    x0: xMin,
    x1: xMax,
    zTop,
    legend: ["hatch", "roof-elev", "level", "ground"],
    notes: [
      axis === "y"
        ? `Plano de corte Y = ${fmtNum(position)} m, observador olhando para o norte (+Y); o leste fica a direita.`
        : `Plano de corte X = ${fmtNum(position)} m, observador olhando para o leste (+X); o sul fica a direita.`,
      "Niveis em metros; +/-0,00 = piso do pavimento mais baixo. PD = pe-direito do ambiente.",
      "Somente elementos CORTADOS sao desenhados (paredes, lajes, pilares/vigas, degraus e cobertura); nao ha elementos em vista alem do plano.",
      "Cobertura: intersecao do plano com a superficie parametrica (indicativa).",
    ],
    warnings,
  });
}

/** Trechos (pares [t0,t1] em coordenada horizontal da vista) em que a reta cruza um polígono qualquer (regra par-ímpar). */
function segmentsOfPolygon(origin: Pt, dir: Pt, poly: readonly Pt[]): Array<[number, number]> {
  const ts: number[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const e = { x: b.x - a.x, y: b.y - a.y };
    const den = dir.x * e.y - dir.y * e.x;
    if (Math.abs(den) < 1e-12) continue;
    const ao = { x: a.x - origin.x, y: a.y - origin.y };
    const t = (ao.x * e.y - ao.y * e.x) / den;
    const s = (ao.x * dir.y - ao.y * dir.x) / den;
    if (s >= 0 && s < 1) ts.push(t);
  }
  ts.sort((p, q) => p - q);
  const out: Array<[number, number]> = [];
  for (let i = 0; i + 1 < ts.length; i += 2) if (ts[i + 1]! - ts[i]! > 1e-4) out.push([ts[i]!, ts[i + 1]!]);
  return out;
}

