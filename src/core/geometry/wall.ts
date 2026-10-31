import type { Opening, Wall } from "../model/schema";
import { add, distance, normalize, perpLeft, projectOnSegment, samePoint, scale, sub, type Vec2, type Vec3 } from "./vec";
import { radToDeg } from "../units/units";

const EPS = 1e-6;

/** Referencial local da parede: u ao longo do eixo (a partir de start), n perpendicular (esquerda). */
export interface WallFrame {
  origin: Vec2;
  dir: Vec2;
  normal: Vec2;
  length: number;
  /** Ângulo do eixo em graus, anti-horário a partir de +X. */
  angle: number;
}

export function wallLength(wall: Pick<Wall, "start" | "end">): number {
  return distance(wall.start, wall.end);
}

export function wallFrame(wall: Pick<Wall, "start" | "end">): WallFrame {
  const d = sub(wall.end, wall.start);
  const dir = normalize(d);
  return {
    origin: wall.start,
    dir,
    normal: perpLeft(dir),
    length: wallLength(wall),
    angle: radToDeg(Math.atan2(d.y, d.x)),
  };
}

/** Ponto do plano a partir de coordenadas locais (u ao longo do eixo, n perpendicular). */
export function wallLocalToPlan(frame: WallFrame, u: number, n = 0): Vec2 {
  return add(add(frame.origin, scale(frame.dir, u)), scale(frame.normal, n));
}

/**
 * Prolongamento (+) ou recuo (−) aplicado a cada extremidade da parede para
 * resolver encontros sem frestas nem sobreposição (junta "de topo").
 */
export interface WallExtension {
  start: number;
  end: number;
}

const ZERO_EXT: WallExtension = { start: 0, end: 0 };

function areCollinear(a: Wall, b: Wall): boolean {
  const da = wallFrame(a).dir;
  const db = wallFrame(b).dir;
  return Math.abs(da.x * db.y - da.y * db.x) < 1e-3;
}

/**
 * Calcula os ajustes de extremidade de todas as paredes:
 *  - Canto (extremidades coincidentes, não colineares): a primeira parede
 *    (na ordem do projeto) avança metade da espessura da outra; a outra recua
 *    metade da espessura da primeira. O quadrado do canto fica coberto uma única vez.
 *  - Encontro em "T" (extremidade sobre o meio de outra parede): a parede que
 *    chega recua metade da espessura da parede hospedeira.
 *  - Paredes colineares: sem ajuste.
 */
export function computeWallJoins(walls: readonly Wall[], tolerance = 1e-3): Map<string, WallExtension> {
  const result = new Map<string, WallExtension>();
  walls.forEach((w) => result.set(w.id, { start: 0, end: 0 }));

  walls.forEach((wall, index) => {
    for (const endKey of ["start", "end"] as const) {
      const point = wall[endKey];
      const ext = result.get(wall.id)!;

      // Paredes não colineares que compartilham esta extremidade.
      const partners = walls
        .map((other, otherIndex) => ({ other, otherIndex }))
        .filter(
          ({ other }) =>
            other.id !== wall.id &&
            (samePoint(other.start, point, tolerance) || samePoint(other.end, point, tolerance)) &&
            !areCollinear(wall, other),
        );

      if (partners.length > 0) {
        const firstIndex = Math.min(index, ...partners.map((p) => p.otherIndex));
        if (firstIndex === index) {
          ext[endKey] = Math.max(...partners.map((p) => p.other.thickness / 2));
        } else {
          const first = walls[firstIndex]!;
          ext[endKey] = -first.thickness / 2;
        }
        continue;
      }

      // Encontro em T.
      for (const host of walls) {
        if (host.id === wall.id) continue;
        const proj = projectOnSegment(point, host.start, host.end);
        if (proj.distance < tolerance && proj.t > EPS && proj.t < 1 - EPS) {
          ext[endKey] = -host.thickness / 2;
          break;
        }
      }
    }
  });
  return result;
}

/** Vão de abertura no referencial local da parede (u ao longo, v na vertical a partir da base). */
export interface Hole {
  openingId: string;
  u0: number;
  u1: number;
  v0: number;
  v1: number;
}

export const openingSill = (o: Opening): number => (o.type === "window" ? o.sillHeight : 0);

/** Retângulos de vão recortados aos limites da parede. Aberturas fora da parede são descartadas. */
export function openingHoles(wall: Wall, openings: readonly Opening[]): Hole[] {
  const L = wallLength(wall);
  const H = wall.height;
  const holes: Hole[] = [];
  for (const o of openings) {
    if (o.hostId !== wall.id) continue;
    const sill = openingSill(o);
    const hole: Hole = {
      openingId: o.id,
      u0: Math.max(o.offset - o.width / 2, 0),
      u1: Math.min(o.offset + o.width / 2, L),
      v0: Math.min(Math.max(sill, 0), H),
      v1: Math.min(Math.max(sill + o.height, 0), H),
    };
    if (hole.u1 - hole.u0 > EPS && hole.v1 - hole.v0 > EPS) holes.push(hole);
  }
  return holes;
}

/** Bloco sólido da parede em coordenadas locais. */
export interface WallPiece {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
}

/** Subtrai uma união de intervalos de [0, H]. */
function subtractIntervals(H: number, cuts: Array<[number, number]>): Array<[number, number]> {
  const sorted = [...cuts].sort((a, b) => a[0] - b[0]);
  const solids: Array<[number, number]> = [];
  let cursor = 0;
  for (const [a, b] of sorted) {
    if (a > cursor + EPS) solids.push([cursor, a]);
    cursor = Math.max(cursor, b);
  }
  if (H > cursor + EPS) solids.push([cursor, H]);
  return solids;
}

/**
 * Decompõe a parede em blocos sólidos, deixando os vãos das aberturas REALMENTE vazios.
 *
 * A parede é fatiada verticalmente em cada borda de abertura; em cada fatia,
 * os vãos que a cobrem são subtraídos da altura total. Blocos vizinhos com a
 * mesma faixa vertical são fundidos para reduzir a quantidade de malhas.
 */
export function computeWallPieces(
  wall: Wall,
  openings: readonly Opening[],
  ext: WallExtension = ZERO_EXT,
): WallPiece[] {
  const L = wallLength(wall);
  const H = wall.height;
  const uMin = 0 - ext.start; // evita -0
  const uMax = L + ext.end;
  if (uMax - uMin <= EPS) return [];

  const holes = openingHoles(wall, openings);
  const breaks = new Set<number>([uMin, uMax]);
  for (const h of holes) {
    if (h.u0 > uMin && h.u0 < uMax) breaks.add(h.u0);
    if (h.u1 > uMin && h.u1 < uMax) breaks.add(h.u1);
  }
  const xs = [...breaks].sort((a, b) => a - b);

  const pieces: WallPiece[] = [];
  for (let i = 0; i < xs.length - 1; i++) {
    const a = xs[i]!;
    const b = xs[i + 1]!;
    if (b - a <= EPS) continue;
    const covering = holes.filter((h) => h.u0 <= a + EPS && h.u1 >= b - EPS);
    for (const [v0, v1] of subtractIntervals(H, covering.map((h) => [h.v0, h.v1]))) {
      const prev = pieces.find((p) => Math.abs(p.u1 - a) < EPS && Math.abs(p.v0 - v0) < EPS && Math.abs(p.v1 - v1) < EPS);
      if (prev) prev.u1 = b;
      else pieces.push({ u0: a, u1: b, v0, v1 });
    }
  }
  return pieces;
}

export interface WallQuantities {
  length: number;
  height: number;
  thickness: number;
  /** Área de uma face sem descontar aberturas (m²). */
  grossArea: number;
  /** Área efetivamente aberta (m²). */
  openingsArea: number;
  /** Área de uma face descontando aberturas (m²). */
  netArea: number;
  /** Volume do eixo da parede, sem ajustes de canto (m³). */
  volume: number;
}

export function wallQuantities(wall: Wall, openings: readonly Opening[]): WallQuantities {
  const L = wallLength(wall);
  const pieces = computeWallPieces(wall, openings);
  const netArea = pieces.reduce((s, p) => s + (p.u1 - p.u0) * (p.v1 - p.v0), 0);
  const grossArea = L * wall.height;
  return {
    length: L,
    height: wall.height,
    thickness: wall.thickness,
    grossArea,
    openingsArea: grossArea - netArea,
    netArea,
    volume: netArea * wall.thickness,
  };
}

/** Polígono (4 vértices, plano XY) de um trecho [u0,u1] da parede. */
export function wallSegmentPolygon(wall: Wall, u0: number, u1: number): Vec2[] {
  const f = wallFrame(wall);
  const h = wall.thickness / 2;
  return [
    wallLocalToPlan(f, u0, h),
    wallLocalToPlan(f, u1, h),
    wallLocalToPlan(f, u1, -h),
    wallLocalToPlan(f, u0, -h),
  ];
}

/**
 * Trechos da parede cortados por um plano horizontal (planta baixa).
 * Convenção usual: plano de corte a 1,20 m da base.
 */
export function wallPlanCut(
  wall: Wall,
  openings: readonly Opening[],
  ext: WallExtension = ZERO_EXT,
  cutHeight = 1.2,
): Array<{ u0: number; u1: number }> {
  const v = Math.min(cutHeight, wall.height - EPS);
  const spans = computeWallPieces(wall, openings, ext)
    .filter((p) => p.v0 <= v + EPS && p.v1 >= v - EPS)
    .map(({ u0, u1 }) => ({ u0, u1 }))
    .sort((a, b) => a.u0 - b.u0);
  // Funde trechos contíguos (fatias vizinhas com faixas verticais diferentes).
  const merged: Array<{ u0: number; u1: number }> = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s.u0 <= last.u1 + EPS) last.u1 = Math.max(last.u1, s.u1);
    else merged.push({ ...s });
  }
  return merged;
}

/** Centro 3D de uma abertura (para rótulos, câmera e quantitativos). */
export function openingCenter(wall: Wall, opening: Opening): Vec3 {
  const p = wallLocalToPlan(wallFrame(wall), opening.offset);
  return { x: p.x, y: p.y, z: wall.baseElevation + openingSill(opening) + opening.height / 2 };
}

/**
 * Posição válida do centro de uma abertura de largura `width` em uma parede
 * de comprimento L, a partir de uma posição desejada. Retorna null se a
 * abertura não cabe na parede.
 */
export function clampOpeningOffset(wallLen: number, width: number, desired: number): number | null {
  if (width > wallLen + EPS) return null;
  const half = width / 2;
  return Math.min(Math.max(desired, half), wallLen - half);
}

export interface OpeningIssue {
  code: "too-wide" | "out-of-bounds" | "too-tall" | "overlap";
  message: string;
}

/** Verifica se uma abertura é construtível na parede hospedeira. */
export function validateOpening(wall: Wall, opening: Opening, siblings: readonly Opening[]): OpeningIssue[] {
  const issues: OpeningIssue[] = [];
  const L = wallLength(wall);
  const u0 = opening.offset - opening.width / 2;
  const u1 = opening.offset + opening.width / 2;
  const sill = openingSill(opening);

  if (opening.width > L + EPS) {
    issues.push({ code: "too-wide", message: "A abertura é mais larga que a parede." });
  } else if (u0 < -EPS || u1 > L + EPS) {
    issues.push({ code: "out-of-bounds", message: "A abertura ultrapassa a extremidade da parede." });
  }
  if (sill + opening.height > wall.height + EPS) {
    issues.push({ code: "too-tall", message: "A abertura ultrapassa a altura da parede." });
  }
  for (const s of siblings) {
    if (s.id === opening.id || s.hostId !== opening.hostId) continue;
    const su0 = s.offset - s.width / 2;
    const su1 = s.offset + s.width / 2;
    const ss = openingSill(s);
    const overlapU = Math.min(u1, su1) - Math.max(u0, su0) > EPS;
    const overlapV = Math.min(sill + opening.height, ss + s.height) - Math.max(sill, ss) > EPS;
    if (overlapU && overlapV) issues.push({ code: "overlap", message: `Sobrepõe a abertura "${s.name}".` });
  }
  return issues;
}
