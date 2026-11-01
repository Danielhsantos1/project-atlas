import type { BuildingObject, Level, Project } from "../core/model/schema";
import { roomShape } from "../core/geometry/rooms";
import { levelWalls } from "../core/model/operations";
import { assume, baseCalc, resolveParam, type CalcBase } from "./types";
import { structuralWalls, wallSkeleton } from "./common";

/**
 * Água fria: reservatório (volume), pressões estáticas por ponto e melhor
 * localização do reservatório. PRÉ-DIMENSIONAMENTO — sem perdas detalhadas,
 * sem dimensionamento de tubulações.
 */

export const COMMERCIAL_TANK_VOLUMES_L: readonly number[] = [500, 750, 1000, 1500, 2000, 3000, 5000];
export const WATER_UNIT_WEIGHT_KN_M3 = 9.81;

export type FixtureKind = "toilet" | "washbasin" | "shower" | "sink-cabinet" | "bath-vanity";

/** Altura típica do ponto de saída acima da base do objeto (m). referencia — conferir. */
export const FIXTURE_OUTLET_HEIGHT_M: Record<FixtureKind, number> = {
  shower: 2.1,
  washbasin: 0.9,
  "sink-cabinet": 1.0,
  "bath-vanity": 0.9,
  toilet: 0.3,
};

const FIXTURE_KINDS = Object.keys(FIXTURE_OUTLET_HEIGHT_M) as FixtureKind[];

export interface WaterParams {
  peoplePerBedroom?: number;
  perCapitaLPerDay?: number;
  reserveDays?: number;
  /** Volumes comerciais de caixa d'água (L). */
  commercialVolumesL?: readonly number[];
  /** Divide o volume em N reservatórios. */
  tankCount?: number;
  /** Cota ABSOLUTA da base do reservatório (m). Se omitida, é sugerida. */
  tankBaseElevation?: number;
  headLossMca?: number;
  minPressureMca?: number;
  maxStaticMca?: number;
  /** Penalidade (m equivalentes) para parede de quarto/suíte. */
  bedroomWallPenalty?: number;
}

export interface FixturePressure {
  objectId: string;
  name: string;
  kind: FixtureKind;
  levelId: string;
  x: number;
  y: number;
  outletElevation: number;
  staticMca: number;
  dynamicMca: number;
  status: "ok" | "baixa" | "alta";
}

export interface TankLocation {
  x: number;
  y: number;
  wallId: string;
  levelId: string;
  /** Soma de distâncias horizontais + descidas verticais até os pontos (m), ramais diretos. */
  totalPipeLengthEstimate: number;
  cost: number;
  onBedroomWall: boolean;
  reason: string;
}

export interface WaterDesign extends CalcBase {
  occupants: number;
  bedrooms: number;
  volume: {
    perCapitaLPerDay: number;
    reserveDays: number;
    requiredL: number;
    commercialVolumesL: number[];
    tankCount: number;
    tanks: number[];
    totalCapacityL: number;
  };
  fixtures: FixturePressure[];
  pressure: {
    tankBaseElevation: number;
    tankBaseSource: "informado" | "sugerido";
    headLossMca: number;
    minPressureMca: number;
    maxStaticMca: number;
    suggestedTankBase: number | null;
    topSlabElevation: number;
    topSlabProvides: boolean | null;
    /** Elevação de pedestal necessária sobre a laje (m), quando insuficiente. */
    pedestalRiseM: number | null;
    recommendation: string;
  };
  location: TankLocation | null;
  tankLoad: { totalKN: number; perTankKN: number[]; note: string };
}

export function collectFixtures(project: Pick<Project, "elements" | "levels">): Array<{ obj: BuildingObject; level: Level; kind: FixtureKind; outletElevation: number }> {
  const levels = new Map(project.levels.map((l) => [l.id, l]));
  const out: Array<{ obj: BuildingObject; level: Level; kind: FixtureKind; outletElevation: number }> = [];
  for (const e of project.elements) {
    if (e.type !== "object") continue;
    if (!(FIXTURE_KINDS as string[]).includes(e.kind)) continue;
    const level = levels.get(e.levelId);
    if (!level) continue;
    const kind = e.kind as FixtureKind;
    out.push({ obj: e, level, kind, outletElevation: level.elevation + e.position.z + FIXTURE_OUTLET_HEIGHT_M[kind] });
  }
  return out;
}

function pickTanks(required: number, volumes: number[], requested: number | undefined): number[] {
  const max = volumes[volumes.length - 1]!;
  const n = requested ?? Math.max(1, Math.ceil(required / max - 1e-9));
  const per = required / n;
  const vol = volumes.find((v) => v >= per - 1e-9) ?? max;
  return Array.from({ length: n }, () => vol);
}

export function designWaterSystem(project: Project, params: WaterParams = {}): WaterDesign {
  const out = baseCalc(["NBR 5626", "NBR 12217", "NBR 6120"]);
  const A = out.assumptions;
  const perBed = resolveParam(A, "people.perBedroom", "Pessoas por quarto/suíte", params.peoplePerBedroom, 2, "referencia", { unit: "pessoas" });
  const perCapita = resolveParam(A, "water.perCapita", "Consumo per capita", params.perCapitaLPerDay, 150, "referencia", { unit: "L/dia", note: "residencial usual 150 L/hab·dia — conferir" });
  const reserveDays = resolveParam(A, "water.reserveDays", "Dias de reserva", params.reserveDays, 2, "adotado", { unit: "dias" });
  const headLoss = resolveParam(A, "pressure.headLoss", "Perda de carga estimada até o ponto", params.headLossMca, 0.5, "adotado", { unit: "mca", note: "global, sem cálculo de tubulação" });
  const minP = resolveParam(A, "pressure.min", "Pressão dinâmica mínima", params.minPressureMca, 1, "referencia", { unit: "mca", note: "NBR 5626 — conferir (alguns aparelhos exigem mais)" });
  const maxS = resolveParam(A, "pressure.maxStatic", "Pressão estática máxima", params.maxStaticMca, 40, "referencia", { unit: "mca", note: "NBR 5626 — conferir" });
  const bedPenalty = resolveParam(A, "location.bedroomPenalty", "Penalidade de parede de quarto/suíte", params.bedroomWallPenalty, 1000, "adotado", { unit: "m eq." });
  const volumes = [...(params.commercialVolumesL ?? COMMERCIAL_TANK_VOLUMES_L)].sort((a, b) => a - b);
  if (volumes.length === 0 || volumes.some((v) => !(v > 0))) throw new RangeError("Parâmetro inválido: volumes comerciais de reservatório.");
  A.push(assume("tank.volumes", "Volumes comerciais de reservatório", volumes.join(", "), params.commercialVolumesL ? "informado" : "referencia", { unit: "L", note: "confirmar linha do fabricante" }));
  if (params.tankCount !== undefined && !(Number.isInteger(params.tankCount) && params.tankCount >= 1)) throw new RangeError("Parâmetro inválido: número de reservatórios.");
  if (params.tankCount !== undefined) A.push(assume("tank.count", "Número de reservatórios", params.tankCount, "informado"));

  // Ocupação e volume.
  const rooms = project.elements.filter((e) => e.type === "room");
  const bedrooms = rooms.filter((r) => r.type === "room" && (r.roomType === "quarto" || r.roomType === "suite")).length;
  let occupants = bedrooms * perBed;
  if (occupants < 1) {
    occupants = 1;
    out.warnings.push("Nenhum quarto/suíte encontrado: ocupação mínima de 1 pessoa adotada. Informe a população real.");
  }
  const requiredL = occupants * perCapita * reserveDays;
  const tanks = pickTanks(requiredL, volumes, params.tankCount);
  const totalCapacity = tanks.reduce((s, v) => s + v, 0);
  if (tanks.length > 1 && params.tankCount === undefined) out.warnings.push(`Volume acima do maior reservatório comercial: dividido em ${tanks.length} unidades.`);
  out.warnings.push("Volume de reserva não inclui reserva técnica de incêndio nem reservatório inferior/bombeamento; verificar uso e normas locais.");

  // Pontos e pressões.
  const fixtures = collectFixtures(project);
  const topLevel = project.levels.reduce((a, b) => (b.elevation > a.elevation ? b : a), project.levels[0]!);
  const topSlab = topLevel.elevation + topLevel.height;
  const suggested = fixtures.length === 0 ? null : Math.max(...fixtures.map((f) => f.outletElevation + minP + headLoss));
  let base: number;
  let source: "informado" | "sugerido";
  if (params.tankBaseElevation !== undefined) {
    if (!Number.isFinite(params.tankBaseElevation)) throw new RangeError("Parâmetro inválido: cota da base do reservatório.");
    base = params.tankBaseElevation;
    source = "informado";
    A.push(assume("tank.base", "Cota da base do reservatório", base, "informado", { unit: "m" }));
  } else {
    base = Math.max(topSlab, suggested ?? topSlab);
    source = "sugerido";
    A.push(assume("tank.base", "Cota da base do reservatório", base, "adotado", { unit: "m", note: "maior entre laje de cobertura e cota mínima sugerida" }));
  }
  if (fixtures.length === 0) out.warnings.push("Nenhum ponto hidráulico (bacia, lavatório, chuveiro, pia, gabinete) encontrado: pressões e localização não calculadas.");

  const rows: FixturePressure[] = fixtures.map((f) => {
    const stat = base - f.outletElevation;
    const dyn = stat - headLoss;
    return {
      objectId: f.obj.id,
      name: f.obj.name,
      kind: f.kind,
      levelId: f.obj.levelId,
      x: f.obj.position.x,
      y: f.obj.position.y,
      outletElevation: f.outletElevation,
      staticMca: stat,
      dynamicMca: dyn,
      status: stat > maxS ? "alta" : dyn < minP ? "baixa" : "ok",
    };
  });
  for (const r of rows) {
    if (r.status === "baixa") out.warnings.push(`${r.name}: pressão dinâmica estimada ${r.dynamicMca.toFixed(2)} mca < mínimo ${minP} mca.`);
    if (r.status === "alta") out.warnings.push(`${r.name}: pressão estática ${r.staticMca.toFixed(1)} mca > ${maxS} mca — prever válvula redutora de pressão.`);
  }
  const topProvides = suggested === null ? null : topSlab >= suggested - 1e-9;
  const pedestal = suggested !== null && !topProvides ? suggested - topSlab : null;
  const recommendation =
    suggested === null
      ? "Sem pontos hidráulicos para verificar."
      : topProvides
        ? `A laje de cobertura (cota ${topSlab.toFixed(2)} m) já fornece a cota mínima sugerida (${suggested.toFixed(2)} m).`
        : `Elevar pedestal em ${(pedestal as number).toFixed(2)} m acima da laje de cobertura (cota ${topSlab.toFixed(2)} m → ${(suggested as number).toFixed(2)} m) ou usar pressurizador.`;
  if (pedestal !== null) out.warnings.push(recommendation);

  const location = bestTankLocation(project, topLevel, fixtures, bedPenalty, out);

  const perTankKN = tanks.map((v) => (v / 1000) * WATER_UNIT_WEIGHT_KN_M3);
  const totalKN = perTankKN.reduce((s, v) => s + v, 0);
  out.warnings.push(`Carga do reservatório cheio (apenas a água): ${totalKN.toFixed(1)} kN (γ = ${WATER_UNIT_WEIGHT_KN_M3} kN/m³). Verificar a estrutura de apoio (laje/vigas/pilares) — peso próprio do reservatório e pedestal não incluídos.`);

  return {
    ...out,
    occupants,
    bedrooms,
    volume: { perCapitaLPerDay: perCapita, reserveDays, requiredL, commercialVolumesL: volumes, tankCount: tanks.length, tanks, totalCapacityL: totalCapacity },
    fixtures: rows,
    pressure: {
      tankBaseElevation: base,
      tankBaseSource: source,
      headLossMca: headLoss,
      minPressureMca: minP,
      maxStaticMca: maxS,
      suggestedTankBase: suggested,
      topSlabElevation: topSlab,
      topSlabProvides: topProvides,
      pedestalRiseM: pedestal,
      recommendation,
    },
    location,
    tankLoad: { totalKN, perTankKN, note: "Água a γ = 9,81 kN/m³ sobre o volume comercial adotado; sem peso do reservatório." },
  };
}

const SAMPLE_STEP = 0.25;
const CORNER_BEARING_DIST = 0.5;
const CORNER_WEIGHT = 0.5;

function bestTankLocation(
  project: Project,
  top: Level,
  fixtures: ReturnType<typeof collectFixtures>,
  bedPenalty: number,
  out: CalcBase,
): TankLocation | null {
  if (fixtures.length === 0) return null;
  const all = levelWalls(project, top.id);
  const walls = structuralWalls(all);
  if (walls.length === 0) {
    out.warnings.push("Pavimento mais alto sem paredes portantes: localização do reservatório não calculada.");
    return null;
  }
  const bedroomWallIds = new Set<string>();
  for (const r of project.elements) {
    if (r.type !== "room" || r.levelId !== top.id || (r.roomType !== "quarto" && r.roomType !== "suite")) continue;
    roomShape(all, r.seed)?.wallIds.forEach((id) => bedroomWallIds.add(id));
  }
  const corners = wallSkeleton(walls).nodes;
  let best: { x: number; y: number; wallId: string; cost: number; pipe: number; bed: boolean } | null = null;
  for (const w of walls) {
    const len = Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y);
    const n = Math.max(1, Math.ceil(len / SAMPLE_STEP - 1e-9));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = w.start.x + (w.end.x - w.start.x) * t;
      const y = w.start.y + (w.end.y - w.start.y) * t;
      let pipe = 0;
      for (const f of fixtures) pipe += Math.hypot(f.obj.position.x - x, f.obj.position.y - y);
      const bed = bedroomWallIds.has(w.id);
      const dCorner = corners.length === 0 ? 0 : Math.min(...corners.map((c) => Math.hypot(c.x - x, c.y - y)));
      const cost = pipe + (bed ? bedPenalty : 0) + CORNER_WEIGHT * Math.max(0, dCorner - CORNER_BEARING_DIST);
      if (best === null || cost < best.cost - 1e-12) best = { x, y, wallId: w.id, cost, pipe, bed };
    }
  }
  if (!best) return null;
  const base = top.elevation + top.height;
  const vertical = fixtures.reduce((s, f) => s + Math.abs(base - f.outletElevation), 0);
  if (best.bed) out.warnings.push("Todas as paredes candidatas delimitam quarto/suíte: reservatório sobre parede de dormitório (ruído/umidade).");
  return {
    x: best.x,
    y: best.y,
    wallId: best.wallId,
    levelId: top.id,
    totalPipeLengthEstimate: best.pipe + vertical,
    cost: best.cost,
    onBedroomWall: best.bed,
    reason:
      `Ponto sobre o eixo de parede portante do pavimento mais alto (amostragem a cada ${SAMPLE_STEP} m) que minimiza a soma das distâncias horizontais até ${fixtures.length} pontos hidráulicos, ` +
      `com penalidade grande para paredes de quarto/suíte e pequena para distância a canto/pilar acima de ${CORNER_BEARING_DIST} m (apoio). Heurística, não otimização hidráulica.`,
  };
}
