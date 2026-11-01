import type { BuildingObject, Level, Project, Room, RoomType, Roof, Floor, Wall } from "../core/model/schema";
import { roomShape, pointInPolygon, polygonPerimeter, polygonSignedArea, type RoomShape } from "../core/geometry/rooms";
import { floorCorners, rectCorners } from "../core/geometry/shapes";
import { projectOnSegment, type Vec2 } from "../core/geometry/vec";
import { levelWalls } from "../core/model/operations";
import { createObject } from "../core/model/factory";
import { getLibraryItem, type LibrarySpec } from "../core/library/catalog";
import { assume, baseCalc, resolveParam, type CalcBase } from "./types";
import { ceilTo, distToBoundary, structuralWalls, sum, wallSkeleton, DEFAULT_MIN_STRUCTURAL_WALL_HEIGHT } from "./common";

/**
 * Lançamento preliminar + pré-dimensionamento de pilares, vigas, lajes e sapatas.
 * Cargas apenas verticais (gravitacionais), sem vento, sem pórtico, sem fissuração/flecha.
 * NÃO é projeto estrutural validado.
 */

/** Sobrecargas (kPa) por tipo de ambiente — referencia NBR 6120, conferir. Conservadoras. */
export const DEFAULT_LIVE_LOADS_KPA: Record<RoomType, number> = {
  sala: 1.5,
  cozinha: 1.5,
  quarto: 1.5,
  suite: 1.5,
  banheiro: 1.5,
  lavabo: 1.5,
  garagem: 3.0,
  gourmet: 2.0,
  lavanderia: 2.0,
  escritorio: 2.0,
  circulacao: 2.5,
  varanda: 2.5,
  outro: 2.0,
};

export interface StructureParams {
  fckMPa?: number;
  gammaC?: number;
  gammaS?: number;
  fykMPa?: number;
  concreteUnitWeight?: number;
  masonryUnitWeight?: number;
  concreteBlockUnitWeight?: number;
  plasterUnitWeight?: number;
  plasterThicknessM?: number;
  finishKPa?: number;
  gammaF?: number;
  liveLoadsKPa?: Partial<Record<RoomType, number>>;
  roofLiveKPa?: number;
  pitchedRoofDeadKPa?: number;
  /** Vão máximo entre pilares ao longo de um eixo de parede (m). */
  maxSpan?: number;
  /** Vigas biapoiadas (L/10) em vez de contínuas (L/12). */
  simplySupported?: boolean;
  minStructuralWallHeight?: number;
  mergeTol?: number;
  /** ρ (taxa de armadura) usada no pré-dimensionamento de pilares. */
  columnRho?: number;
  /** Fator de excentricidade/esbeltez do pré-dimensionamento de pilares. */
  columnFactor?: number;
  columnMinAreaCm2?: number;
  columnMinSideM?: number;
  slabMinFloorM?: number;
  slabMinRoofM?: number;
  slabDivisor?: number;
  beamMinHeightM?: number;
  baldrameMinHeightM?: number;
  beamMinWidthM?: number;
  /** Raio máximo para transferir carga de pilar superior ao inferior (m). */
  transferRadiusM?: number;
  steelRatesKgM3?: { columns?: number; beams?: number; slabs?: number; footings?: number };
  /** σadm do solo (kPa). SEM padrão — depende da sondagem. */
  soilAllowableKPa?: number;
  footingWeightFactor?: number;
  footingMinSideM?: number;
  footingMinHeightM?: number;
}

export interface ColumnDesign {
  id: string;
  levelId: string;
  x: number;
  y: number;
  /** Lado medido perpendicular à parede (alinhado à espessura) — comprimento X local do objeto. */
  b: number;
  /** Outro lado (largura Y local do objeto). */
  h: number;
  height: number;
  rotationDeg: number;
  Nk: number;
  Nd: number;
  NkLevel: number;
  NkFromAbove: number;
  requiredAreaCm2: number;
  areaCm2: number;
  governedBy: "resistencia" | "minimo";
  slenderness: number;
  slender: boolean;
}

export interface BeamDesign {
  id: string;
  levelId: string;
  kind: "baldrame" | "viga" | "cobertura";
  from: Vec2;
  to: Vec2;
  fromColumnId: string;
  toColumnId: string;
  length: number;
  b: number;
  h: number;
  /** Carga linear característica (kN/m). */
  qk: number;
  load: { wall: number; slab: number; self: number };
  wallIds: string[];
  rule: string;
}

export interface SlabDesign {
  id: string;
  levelId: string;
  kind: "laje-piso" | "laje-cobertura";
  roomId?: string;
  floorId?: string;
  lx: number;
  ly: number;
  h: number;
  /** Carga permanente (kN/m²), com peso próprio. */
  g: number;
  /** Sobrecarga (kPa). */
  q: number;
  qTotal: number;
  area: number;
  /** Fração da área do ambiente sem laje acima (vão de escada etc.), 0–1. */
  voidFraction: number;
  minGoverned: boolean;
}

export interface RoofLoadPanel {
  roomId: string;
  levelId: string;
  area: number;
  qTotal: number;
}

export interface FootingDesign {
  id: string;
  columnId: string;
  levelId: string;
  x: number;
  y: number;
  Nk: number;
  requiredAreaM2: number;
  side: number;
  height: number;
  sigmaAdmKPa: number;
}

export interface Quantities {
  concreteM3: { columns: number; beams: number; slabs: number; footings: number | null; total: number };
  steelKg: { columns: number; beams: number; slabs: number; footings: number | null; total: number };
  formworkM2: { columns: number; beams: number; slabs: number; footings: number | null; total: number };
  note: string;
}

export interface StructureResult extends CalcBase {
  materials: { fckMPa: number; fcdMPa: number; fydMPa: number; gammaF: number };
  levels: Array<{ id: string; name: string; columns: number; beams: number; slabs: number }>;
  columns: ColumnDesign[];
  /** Vigas de cada pavimento (topo do pavimento); a do último é cinta/viga de cobertura. */
  beams: BeamDesign[];
  /** Vigas baldrame sob as paredes do pavimento mais baixo. */
  baldrame: BeamDesign[];
  slabs: SlabDesign[];
  roofLoadPanels: RoofLoadPanel[];
  foundation: FootingDesign[] | null;
  quantities: Quantities;
}

interface Panel {
  poly: Vec2[];
  area: number;
  perimeter: number;
  qTotal: number;
}

interface ColWork {
  d: ColumnDesign;
  ownBeams: number;
  fromAbove: number;
  baldrameEnds: number;
  thickness: number;
}

const near = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
const normDeg180 = (d: number): number => ((d % 180) + 180) % 180;

function inRoofRect(roof: Roof, p: Vec2): boolean {
  return pointInPolygon(p, rectCorners(roof.position, roof.width, roof.depth, roof.rotation));
}

export function predimensionStructure(project: Project, params: StructureParams = {}): StructureResult {
  const out = baseCalc(["NBR 6118", "NBR 6120", "NBR 6122", "NBR 6123", "NBR 15270"]);
  const A = out.assumptions;
  const W = out.warnings;
  const fck = resolveParam(A, "fck", "fck do concreto", params.fckMPa, 25, "adotado", { unit: "MPa" });
  const gC = resolveParam(A, "gammaC", "γc (concreto)", params.gammaC, 1.4, "referencia", { note: "NBR 6118 — conferir" });
  const gS = resolveParam(A, "gammaS", "γs (aço)", params.gammaS, 1.15, "referencia", { note: "NBR 6118 — conferir" });
  const fyk = resolveParam(A, "fyk", "fyk do aço", params.fykMPa, 500, "adotado", { unit: "MPa", note: "CA-50" });
  const gConc = resolveParam(A, "gamma.concrete", "Peso específico do concreto armado", params.concreteUnitWeight, 25, "referencia", { unit: "kN/m³", note: "NBR 6120 — conferir" });
  const gMas = resolveParam(A, "gamma.masonry", "Peso específico da alvenaria (bloco cerâmico furado)", params.masonryUnitWeight, 13, "referencia", { unit: "kN/m³", note: "NBR 6120 — conferir" });
  const gBlk = resolveParam(A, "gamma.concreteBlock", "Peso específico da alvenaria de bloco de concreto", params.concreteBlockUnitWeight, 14, "referencia", { unit: "kN/m³", note: "NBR 6120 — conferir" });
  const gPl = resolveParam(A, "gamma.plaster", "Peso específico do reboco", params.plasterUnitWeight, 19, "referencia", { unit: "kN/m³", note: "NBR 6120 — conferir" });
  const tPl = resolveParam(A, "plaster.thickness", "Espessura de reboco por face", params.plasterThicknessM, 0.01, "adotado", { unit: "m" });
  const finish = resolveParam(A, "load.finish", "Revestimento de piso/contrapiso", params.finishKPa, 1.0, "adotado", { unit: "kN/m²" });
  const gF = resolveParam(A, "gammaF", "γf (ações)", params.gammaF, 1.4, "referencia", { note: "NBR 6118/8681 — conferir" });
  const roofLive = resolveParam(A, "load.roofLive", "Sobrecarga de cobertura (só manutenção)", params.roofLiveKPa, 0.5, "referencia", { unit: "kPa", note: "NBR 6120 — conferir" });
  const roofDead = resolveParam(A, "load.pitchedRoofDead", "Carga permanente de telhado inclinado (projeção horizontal)", params.pitchedRoofDeadKPa, 0.8, "adotado", { unit: "kN/m²", note: "telha + madeiramento; ajustar ao material" });
  const maxSpan = resolveParam(A, "maxSpan", "Vão máximo entre pilares ao longo da parede", params.maxSpan, 5.0, "adotado", { unit: "m" });
  const minWallH = resolveParam(A, "minStructuralWallHeight", "Altura mínima para parede ser considerada portante", params.minStructuralWallHeight, DEFAULT_MIN_STRUCTURAL_WALL_HEIGHT, "adotado", { unit: "m", note: "exclui guarda-corpos, muretas e muros de divisa" });
  const mergeTol = resolveParam(A, "mergeTol", "Tolerância de fusão de pilares", params.mergeTol, 0.3, "adotado", { unit: "m" });
  const rho = resolveParam(A, "column.rho", "Taxa de armadura ρ (pré-dimensionamento de pilar)", params.columnRho, 0.02, "adotado");
  const colFactor = resolveParam(A, "column.factor", "Fator de excentricidade/esbeltez do pilar", params.columnFactor, 1.5, "adotado", { note: "pré-dimensionamento; não é verificação de esbeltez" });
  const colMinArea = resolveParam(A, "column.minArea", "Área mínima de pilar", params.columnMinAreaCm2, 360, "referencia", { unit: "cm²", note: "NBR 6118 — conferir" });
  const colMinSide = resolveParam(A, "column.minSide", "Menor lado mínimo de pilar", params.columnMinSideM, 0.19, "referencia", { unit: "m", note: "NBR 6118 — conferir" });
  const slabMinFloor = resolveParam(A, "slab.minFloor", "Espessura mínima de laje de piso", params.slabMinFloorM, 0.08, "referencia", { unit: "m", note: "NBR 6118 — conferir" });
  const slabMinRoof = resolveParam(A, "slab.minRoof", "Espessura mínima de laje de cobertura", params.slabMinRoofM, 0.07, "referencia", { unit: "m", note: "NBR 6118 — conferir" });
  const slabDiv = resolveParam(A, "slab.divisor", "Divisor h = lx/…", params.slabDivisor, 40, "adotado");
  const beamMinH = resolveParam(A, "beam.minHeight", "Altura mínima de viga", params.beamMinHeightM, 0.25, "adotado", { unit: "m" });
  const baldMinH = resolveParam(A, "baldrame.minHeight", "Altura mínima de baldrame", params.baldrameMinHeightM, 0.3, "adotado", { unit: "m" });
  const beamMinB = resolveParam(A, "beam.minWidth", "Largura mínima de viga", params.beamMinWidthM, 0.12, "referencia", { unit: "m", note: "NBR 6118 — conferir" });
  const transferR = resolveParam(A, "transferRadius", "Raio de transferência de carga entre pavimentos", params.transferRadiusM, 1.5, "adotado", { unit: "m" });
  const fwF = resolveParam(A, "footing.weightFactor", "Fator de peso próprio da sapata", params.footingWeightFactor, 1.1, "adotado");
  const fMinSide = resolveParam(A, "footing.minSide", "Lado mínimo de sapata", params.footingMinSideM, 0.6, "adotado", { unit: "m" });
  const fMinH = resolveParam(A, "footing.minHeight", "Altura mínima de sapata", params.footingMinHeightM, 0.3, "adotado", { unit: "m" });
  const rates = {
    columns: resolveParam(A, "steel.columns", "Taxa de aço — pilares", params.steelRatesKgM3?.columns, 100, "referencia", { unit: "kg/m³" }),
    beams: resolveParam(A, "steel.beams", "Taxa de aço — vigas", params.steelRatesKgM3?.beams, 90, "referencia", { unit: "kg/m³" }),
    slabs: resolveParam(A, "steel.slabs", "Taxa de aço — lajes", params.steelRatesKgM3?.slabs, 70, "referencia", { unit: "kg/m³" }),
    footings: resolveParam(A, "steel.footings", "Taxa de aço — sapatas", params.steelRatesKgM3?.footings, 60, "referencia", { unit: "kg/m³" }),
  };
  const live: Record<RoomType, number> = { ...DEFAULT_LIVE_LOADS_KPA };
  for (const [k, v] of Object.entries(DEFAULT_LIVE_LOADS_KPA) as Array<[RoomType, number]>) {
    const given = params.liveLoadsKPa?.[k];
    if (given !== undefined && !(Number.isFinite(given) && given >= 0)) throw new RangeError(`Parâmetro inválido: sobrecarga de ${k}.`);
    live[k] = given ?? v;
    A.push(assume(`live.${k}`, `Sobrecarga — ${k}`, live[k], given !== undefined ? "informado" : "referencia", { unit: "kPa", note: "NBR 6120 — conferir (tabela conservadora)" }));
  }
  A.push(
    assume("beam.rule", "Altura de viga", params.simplySupported ? "h = L/10 (biapoiada)" : "h = L/12 (contínua)", params.simplySupported ? "informado" : "adotado", { note: "arredondada para cima a 5 cm" }),
    assume("beam.width", "Largura de viga", "b = max(mín., espessura da parede arredondada a 1 cm)", "adotado"),
    assume("wall.load", "Carga de parede", "h × (t·γ + 2·reboco·γ_reboco), sem descontar aberturas", "adotado", { note: "espessura do modelo tratada como espessura do bloco (conservador)" }),
    assume("slab.load", "Carga de laje nas vigas", "q·A/P (carga total da laje distribuída pelo perímetro)", "adotado", { note: "conserva a carga total; ≈ q·lx/2 em lajes alongadas" }),
    assume("beam.reaction", "Reação de viga nos pilares", "qk·L/2 em cada extremo", "adotado", { note: "sem continuidade nem pórtico" }),
  );
  const fcd = fck / gC;
  const fyd = fyk / gS;
  const levels = [...project.levels].sort((a, b) => a.elevation - b.elevation);
  const lowest = levels[0]!;
  const soil = params.soilAllowableKPa;
  if (soil !== undefined && !(Number.isFinite(soil) && soil > 0)) throw new RangeError("Parâmetro inválido: σadm do solo.");

  const gammaOf = (w: Wall): number => (w.core === "concrete" ? gConc : w.core === "concrete-block" ? gBlk : gMas);
  const wallLoad = (w: Wall): number => w.height * (w.thickness * gammaOf(w) + 2 * tPl * gPl);

  // Cache de formas dos ambientes.
  const shapeCache = new Map<string, RoomShape | null>();
  const shapeOf = (r: Room): RoomShape | null => {
    if (!shapeCache.has(r.id)) shapeCache.set(r.id, roomShape(levelWalls(project, r.levelId), r.seed));
    return shapeCache.get(r.id) ?? null;
  };
  const roomsOn = (levelId: string): Room[] => project.elements.filter((e): e is Room => e.type === "room" && e.levelId === levelId);
  const floorsOn = (levelId: string): Floor[] => project.elements.filter((e): e is Floor => e.type === "floor" && e.levelId === levelId);
  const roofsOn = (levelId: string): Roof[] => project.elements.filter((e): e is Roof => e.type === "roof" && e.levelId === levelId);

  const slabs: SlabDesign[] = [];
  const roofPanels: RoofLoadPanel[] = [];
  const panelsByLevel = new Map<string, Panel[]>();
  let slabN = 0;
  let unshapedRooms = 0;
  let standaloneCount = 0;
  let skippedThinFloors = 0;

  const slabDesign = (lx0: number, ly0: number, minH: number, extraG: number, liveK: number) => {
    const lx = Math.min(lx0, ly0);
    const ly = Math.max(lx0, ly0);
    const byRule = ceilTo(lx / slabDiv, 0.01);
    const h = Math.max(minH, byRule);
    const g = h * gConc + extraG;
    return { lx, ly, h, g, q: liveK, minGoverned: byRule <= minH };
  };

  levels.forEach((lv, li) => {
    const upper = levels[li + 1];
    const panels: Panel[] = [];
    panelsByLevel.set(lv.id, panels);
    const upperFloors = upper ? floorsOn(upper.id) : [];
    const upperRooms = upper ? roomsOn(upper.id) : [];
    for (const r of roomsOn(lv.id)) {
      const shape = shapeOf(r);
      if (!shape) {
        unshapedRooms++;
        continue;
      }
      const roof = roofsOn(lv.id).find((rf) => inRoofRect(rf, r.seed));
      const floorAbove = roof ? undefined : upperFloors.find((f) => f.thickness >= slabMinRoof - 1e-9 && pointInPolygon(r.seed, floorCorners(f)));
      const poly = shape.axis;
      const area = Math.abs(polygonSignedArea(poly));
      const perimeter = polygonPerimeter(poly);
      const xs = poly.map((p) => p.x);
      const ys = poly.map((p) => p.y);
      const dx = shape.rect ? shape.rect.maxX - shape.rect.minX : Math.max(...xs) - Math.min(...xs);
      const dy = shape.rect ? shape.rect.maxY - shape.rect.minY : Math.max(...ys) - Math.min(...ys);
      if (roof && roof.roofType === "flat") {
        const s = slabDesign(dx, dy, slabMinRoof, finish, roofLive);
        slabs.push({ id: `L${++slabN}`, levelId: lv.id, kind: "laje-cobertura", roomId: r.id, lx: s.lx, ly: s.ly, h: s.h, g: s.g, q: s.q, qTotal: s.g + s.q, area, voidFraction: 0, minGoverned: s.minGoverned });
        panels.push({ poly, area, perimeter, qTotal: s.g + s.q });
      } else if (roof) {
        const qTotal = roofDead + roofLive;
        roofPanels.push({ roomId: r.id, levelId: lv.id, area, qTotal });
        panels.push({ poly, area, perimeter, qTotal });
      } else if (floorAbove) {
        const above = upperRooms.find((u) => {
          const sh = shapeOf(u);
          return sh ? pointInPolygon(r.seed, sh.axis) : false;
        });
        const liveK = live[above?.roomType ?? r.roomType];
        const s = slabDesign(dx, dy, slabMinFloor, finish, liveK);
        // Fração sem laje (vãos): amostragem em grade de 0,25 m.
        const x0 = Math.min(...xs);
        const y0 = Math.min(...ys);
        let tot = 0;
        let miss = 0;
        for (let x = x0 + 0.125; x < Math.max(...xs); x += 0.25) {
          for (let y = y0 + 0.125; y < Math.max(...ys); y += 0.25) {
            if (!pointInPolygon({ x, y }, poly)) continue;
            tot++;
            if (!upperFloors.some((f) => f.thickness >= slabMinRoof - 1e-9 && pointInPolygon({ x, y }, floorCorners(f)))) miss++;
          }
        }
        const voidFraction = tot === 0 ? 0 : miss / tot;
        slabs.push({ id: `L${++slabN}`, levelId: lv.id, kind: "laje-piso", roomId: r.id, lx: s.lx, ly: s.ly, h: s.h, g: s.g, q: s.q, qTotal: s.g + s.q, area, voidFraction, minGoverned: s.minGoverned });
        panels.push({ poly, area, perimeter, qTotal: s.g + s.q });
        if (voidFraction > 0.02) W.push(`Ambiente "${r.name}": ${(voidFraction * 100).toFixed(0)}% da área sem laje acima (vão de escada/pé-direito duplo). Carga mantida integral (conservador); definir contorno real da laje.`);
      }
    }
    // Lajes (elementos "floor") do pavimento superior que não pertencem a nenhum ambiente do pavimento inferior.
    if (upper) {
      const lowerShapes = roomsOn(lv.id).map(shapeOf);
      for (const f of upperFloors) {
        if (f.thickness < slabMinRoof - 1e-9) {
          skippedThinFloors++;
          continue;
        }
        if (lowerShapes.some((sh) => sh && pointInPolygon(f.position, sh.axis))) continue;
        const s = slabDesign(f.width, f.depth, slabMinFloor, finish, live.varanda);
        const poly = floorCorners(f);
        standaloneCount++;
        slabs.push({ id: `L${++slabN}`, levelId: lv.id, kind: "laje-piso", floorId: f.id, lx: s.lx, ly: s.ly, h: s.h, g: s.g, q: s.q, qTotal: s.g + s.q, area: f.width * f.depth, voidFraction: 0, minGoverned: s.minGoverned });
        panels.push({ poly, area: f.width * f.depth, perimeter: polygonPerimeter(poly), qTotal: s.g + s.q });
      }
    }
  });
  if (unshapedRooms > 0) W.push(`${unshapedRooms} ambiente(s) sem contorno fechado de paredes foram ignorados no cálculo de lajes.`);
  if (standaloneCount > 0) W.push(`${standaloneCount} laje(s) (elementos "piso") sem ambiente abaixo: dimensionadas com sobrecarga de varanda (${live.varanda} kPa); confirmar apoio em vigas.`);
  if (skippedThinFloors > 0) W.push(`${skippedThinFloors} piso(s) de pavimento superior com espessura < ${slabMinRoof * 100} cm tratados como revestimento (não dimensionados como laje).`);
  if (slabs.length === 0 && roofPanels.length === 0) W.push("Nenhuma laje ou cobertura identificada sobre os ambientes: cargas de laje/telhado nas vigas = 0.");

  // Vigas, pilares.
  const columns: ColWork[] = [];
  const colsByLevel = new Map<string, ColWork[]>();
  const beams: BeamDesign[] = [];
  const baldrame: BeamDesign[] = [];
  let pN = 0;
  let vN = 0;
  let bN = 0;
  const topLevel = levels[levels.length - 1]!;
  let anyStructural = false;

  levels.forEach((lv, li) => {
    const upper = levels[li + 1];
    const sw = structuralWalls(levelWalls(project, lv.id), minWallH);
    const upperWalls = upper ? structuralWalls(levelWalls(project, upper.id), minWallH) : [];
    const skel = wallSkeleton(sw, mergeTol);
    const list: ColWork[] = [];
    colsByLevel.set(lv.id, list);
    if (skel.nodes.length > 0) anyStructural = true;
    const mk = (x: number, y: number, thickness: number, angleDeg: number): ColWork => {
      const cw: ColWork = {
        d: {
          id: `P${++pN}`,
          levelId: lv.id,
          x,
          y,
          b: 0,
          h: 0,
          height: lv.height,
          rotationDeg: normDeg180(angleDeg + 90),
          Nk: 0,
          Nd: 0,
          NkLevel: 0,
          NkFromAbove: 0,
          requiredAreaCm2: 0,
          areaCm2: 0,
          governedBy: "minimo",
          slenderness: 0,
          slender: false,
        },
        ownBeams: 0,
        fromAbove: 0,
        baldrameEnds: 0,
        thickness,
      };
      list.push(cw);
      columns.push(cw);
      return cw;
    };
    const nodeCol = skel.nodes.map((n) => mk(n.x, n.y, n.thickness, n.angleDeg));
    const panels = panelsByLevel.get(lv.id) ?? [];
    const isTop = lv.id === topLevel.id;
    const isLowest = lv.id === lowest.id;

    const addBeams = (c: (typeof skel.chains)[number]) => {
      const A0 = nodeCol[c.a]!;
      const B0 = nodeCol[c.b]!;
      const nSeg = Math.max(1, Math.ceil(c.length / maxSpan - 1e-9));
      const angle = (Math.atan2(B0.d.y - A0.d.y, B0.d.x - A0.d.x) * 180) / Math.PI;
      const pts: ColWork[] = [A0];
      for (let k = 1; k < nSeg; k++) {
        const t = k / nSeg;
        pts.push(mk(A0.d.x + (B0.d.x - A0.d.x) * t, A0.d.y + (B0.d.y - A0.d.y) * t, c.thickness, angle));
      }
      pts.push(B0);
      for (let k = 0; k < nSeg; k++) {
        const p = pts[k]!;
        const q = pts[k + 1]!;
        const L = near(p.d, q.d);
        const mid = { x: (p.d.x + q.d.x) / 2, y: (p.d.y + q.d.y) / 2 };
        const b = Math.max(beamMinB, ceilTo(c.thickness, 0.01));
        const mkBeam = (kind: BeamDesign["kind"]): BeamDesign => {
          const div = params.simplySupported ? 10 : 12;
          const hMin = kind === "baldrame" ? baldMinH : beamMinH;
          const h = Math.max(hMin, ceilTo(L / div, 0.05));
          const self = b * h * gConc;
          const wallsAbove = kind === "baldrame" ? sw : upperWalls;
          const here = wallsAbove.filter((w) => projectOnSegment(mid, w.start, w.end).distance <= 0.1);
          const wallK = here.length === 0 ? 0 : Math.max(...here.map(wallLoad));
          const slabK = kind === "baldrame" ? 0 : sum(panels.filter((pn) => distToBoundary(mid, pn.poly) <= 0.06).map((pn) => (pn.qTotal * pn.area) / pn.perimeter));
          return {
            id: kind === "baldrame" ? `B${++bN}` : `V${++vN}`,
            levelId: lv.id,
            kind,
            from: { x: p.d.x, y: p.d.y },
            to: { x: q.d.x, y: q.d.y },
            fromColumnId: p.d.id,
            toColumnId: q.d.id,
            length: L,
            b,
            h,
            qk: wallK + slabK + self,
            load: { wall: wallK, slab: slabK, self },
            wallIds: c.wallIds,
            rule: `h = max(${hMin * 100} cm, L/${div} ↑5 cm)`,
          };
        };
        const v = mkBeam(isTop ? "cobertura" : "viga");
        beams.push(v);
        p.ownBeams += (v.qk * L) / 2;
        q.ownBeams += (v.qk * L) / 2;
        if (isLowest) {
          const bd = mkBeam("baldrame");
          baldrame.push(bd);
          p.baldrameEnds += (bd.qk * L) / 2;
          q.baldrameEnds += (bd.qk * L) / 2;
        }
      }
    };
    skel.chains.forEach(addBeams);
  });
  if (!anyStructural) W.push("Nenhuma parede portante encontrada (altura ≥ mínimo, não drywall): sem lançamento de pilares/vigas.");

  // Pilares: cargas de cima para baixo e seção.
  const sectionFor = (Nk: number, thickness: number) => {
    const Nd = gF * Nk;
    const reqM2 = (colFactor * Nd) / (1000 * (0.85 * fcd + rho * (fyd - 0.85 * fcd)));
    const reqCm2 = reqM2 * 1e4;
    const minArea = colMinArea / 1e4;
    const b = ceilTo(Math.max(colMinSide, thickness), 0.05);
    const h = ceilTo(Math.max(Math.max(reqM2, minArea) / b, colMinSide), 0.05);
    return { Nd, reqCm2, b, h, governedBy: (reqCm2 > colMinArea ? "resistencia" : "minimo") as ColumnDesign["governedBy"] };
  };
  let transitions = 0;
  let farTransitions = 0;
  let lostLoads = 0;
  for (let li = levels.length - 1; li >= 0; li--) {
    const lv = levels[li]!;
    const list = colsByLevel.get(lv.id) ?? [];
    for (const c of list) {
      const N0 = c.ownBeams + c.fromAbove;
      const s1 = sectionFor(N0, c.thickness);
      const swt = s1.b * s1.h * lv.height * gConc;
      const Nk = N0 + swt;
      const s2 = sectionFor(Nk, c.thickness);
      const d = c.d;
      d.b = s2.b;
      d.h = s2.h;
      d.Nk = Nk;
      d.Nd = s2.Nd;
      d.NkLevel = c.ownBeams + swt;
      d.NkFromAbove = c.fromAbove;
      d.requiredAreaCm2 = s2.reqCm2;
      d.areaCm2 = s2.b * s2.h * 1e4;
      d.governedBy = s2.governedBy;
      d.slenderness = lv.height / Math.min(s2.b, s2.h);
      d.slender = d.slenderness > 12;
    }
    const below = levels[li - 1];
    if (!below) continue;
    const lowerList = colsByLevel.get(below.id) ?? [];
    for (const c of list) {
      let best: ColWork | null = null;
      let bd = Infinity;
      for (const l of lowerList) {
        const dd = near(c.d, l.d);
        if (dd < bd) {
          bd = dd;
          best = l;
        }
      }
      if (!best) {
        lostLoads++;
        continue;
      }
      best.fromAbove += c.d.Nk;
      if (bd > mergeTol) {
        transitions++;
        if (bd > transferR) farTransitions++;
      }
    }
  }
  if (lostLoads > 0) W.push(`${lostLoads} pilar(es) sem pilar no pavimento inferior: carga NÃO transferida (inconsistência do modelo).`);
  if (transitions > 0) W.push(`${transitions} pilar(es) sem apoio direto no pavimento inferior (desvio > ${mergeTol} m): carga atribuída ao pilar mais próximo; prever viga de transição.`);
  if (farTransitions > 0) W.push(`${farTransitions} transferência(s) a mais de ${transferR} m: viga de transição obrigatória e revisão do lançamento.`);
  const slender = columns.filter((c) => c.d.slender);
  if (slender.length > 0) W.push(`${slender.length} pilar(es) com altura/menor lado > 12: verificar esbeltez e efeitos de 2ª ordem (NBR 6118 — conferir).`);
  if (columns.length > 0) W.push("Aberturas (portas/janelas) não foram consideradas no lançamento: conferir se algum pilar cai sobre vãos.");
  W.push("Apenas cargas verticais características estimadas por áreas de influência; vento, estabilidade global, flechas, fissuração, punção e detalhamento de armaduras NÃO foram verificados.");

  // Fundação.
  let foundation: FootingDesign[] | null = null;
  if (soil === undefined) {
    out.missingInputs.push("σadm do solo (kPa) — obter em sondagem SPT / laudo geotécnico (NBR 6122).");
  } else {
    A.push(assume("soil.sigmaAdm", "σadm do solo", soil, "informado", { unit: "kPa" }));
    foundation = [];
    let sN = 0;
    for (const c of colsByLevel.get(lowest.id) ?? []) {
      const Nk = c.d.Nk + c.baldrameEnds;
      const req = (fwF * Nk) / soil;
      const side = Math.max(fMinSide, ceilTo(Math.sqrt(req), 0.05));
      const ap = Math.max(c.d.b, c.d.h);
      const height = Math.max(fMinH, ceilTo((side - ap) / 3, 0.05));
      foundation.push({ id: `S${++sN}`, columnId: c.d.id, levelId: lowest.id, x: c.d.x, y: c.d.y, Nk, requiredAreaM2: req, side, height, sigmaAdmKPa: soil });
    }
    W.push("Sapatas isoladas quadradas com altura por regra de rigidez (a − ap)/3; verificar flexão, cisalhamento, nível d'água, vizinhança e recalques conforme NBR 6122.");
  }

  // Quantitativos.
  const colsOut = columns.map((c) => c.d);
  const vCol = sum(colsOut.map((c) => (c.b * c.h * c.height)));
  const allBeams = [...beams, ...baldrame];
  const vBeam = sum(allBeams.map((b) => b.b * b.h * b.length));
  const vSlab = sum(slabs.map((s) => s.h * s.area));
  const vFoot = foundation ? sum(foundation.map((f) => f.side * f.side * f.height)) : null;
  const fCol = sum(colsOut.map((c) => 2 * (c.b + c.h) * c.height));
  const fBeam = sum(allBeams.map((b) => (b.b + 2 * b.h) * b.length));
  const fSlab = sum(slabs.map((s) => s.area));
  const fFoot = foundation ? sum(foundation.map((f) => 4 * f.side * f.height)) : null;
  const quantities: Quantities = {
    concreteM3: { columns: vCol, beams: vBeam, slabs: vSlab, footings: vFoot, total: vCol + vBeam + vSlab + (vFoot ?? 0) },
    steelKg: {
      columns: vCol * rates.columns,
      beams: vBeam * rates.beams,
      slabs: vSlab * rates.slabs,
      footings: vFoot === null ? null : vFoot * rates.footings,
      total: vCol * rates.columns + vBeam * rates.beams + vSlab * rates.slabs + (vFoot ?? 0) * rates.footings,
    },
    formworkM2: { columns: fCol, beams: fBeam, slabs: fSlab, footings: fFoot, total: fCol + fBeam + fSlab + (fFoot ?? 0) },
    note: "Estimativa por taxas de referência (kg/m³); sem desconto de interseções pilar/viga/laje. Sapatas excluídas sem σadm. Não substitui levantamento do projeto de armação.",
  };
  if (vFoot === null) W.push("Quantitativos de sapatas não calculados (falta σadm do solo).");

  return {
    ...out,
    materials: { fckMPa: fck, fcdMPa: fcd, fydMPa: fyd, gammaF: gF },
    levels: levels.map((lv) => ({
      id: lv.id,
      name: lv.name,
      columns: (colsByLevel.get(lv.id) ?? []).length,
      beams: beams.filter((b) => b.levelId === lv.id).length,
      slabs: slabs.filter((s) => s.levelId === lv.id).length,
    })),
    columns: colsOut,
    beams,
    baldrame,
    slabs,
    roofLoadPanels: roofPanels,
    foundation,
    quantities,
  };
}

export interface ToModelOptions {
  /** Inclui vigas baldrame (abaixo do piso). Padrão: false. */
  includeBaldrame?: boolean;
}

/** Elementos `column-rect` e `beam` prontos para `addElements` (IDs novos a cada chamada). */
export function toModelElements(project: Pick<Project, "elements" | "levels">, result: Pick<StructureResult, "columns" | "beams" | "baldrame">, opts: ToModelOptions = {}): BuildingObject[] {
  const levelOf = new Map<string, Level>(project.levels.map((l) => [l.id, l]));
  const colItem = getLibraryItem("column-rect-20x40");
  const beamItem = getLibraryItem("beam-15x40");
  if (!colItem || colItem.spec.elementType !== "object" || !beamItem || beamItem.spec.elementType !== "object") {
    throw new Error("Itens de biblioteca de pilar/viga não encontrados.");
  }
  const colSpec = colItem.spec;
  const beamSpec = beamItem.spec;
  const used = new Set(project.elements.map((e) => e.name));
  const uniq = (base: string): string => {
    let name = base;
    for (let n = 2; used.has(name); n++) name = `${base} (${n})`;
    used.add(name);
    return name;
  };
  const out: BuildingObject[] = [];
  for (const c of result.columns) {
    const lv = levelOf.get(c.levelId);
    if (!lv) continue;
    const spec: Extract<LibrarySpec, { elementType: "object" }> = { ...colSpec, length: c.b, width: c.h, height: lv.height, elevation: 0 };
    const o = createObject(project.elements, spec, "Pilar", { x: c.x, y: c.y }, c.levelId);
    out.push({ ...o, name: uniq(`Pilar ${c.id}`), rotation: c.rotationDeg });
  }
  const bs = opts.includeBaldrame ? [...result.beams, ...result.baldrame] : result.beams;
  for (const b of bs) {
    const lv = levelOf.get(b.levelId);
    if (!lv) continue;
    const z = b.kind === "baldrame" ? -b.h : lv.height - b.h;
    const spec: Extract<LibrarySpec, { elementType: "object" }> = { ...beamSpec, length: b.length, width: b.b, height: b.h, elevation: z };
    const mid = { x: (b.from.x + b.to.x) / 2, y: (b.from.y + b.to.y) / 2 };
    const o = createObject(project.elements, spec, "Viga", mid, b.levelId);
    const angle = (Math.atan2(b.to.y - b.from.y, b.to.x - b.from.x) * 180) / Math.PI;
    out.push({ ...o, name: uniq(`${b.kind === "baldrame" ? "Baldrame" : "Viga"} ${b.id}`), rotation: angle });
  }
  return out;
}
