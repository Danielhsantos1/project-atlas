import { z } from "zod";
import type { Opening, Project, Room, Wall } from "@/core/model/schema";
import { isOpening, isWall } from "@/core/model/schema";
import { getMaterial } from "@/core/model/materials";
import { levelWalls } from "@/core/model/operations";
import { DomainError } from "@/core/model/errors";
import { computeWallPieces, openingSill, wallFrame, wallLength, wallQuantities, type WallPiece } from "@/core/geometry/wall";
import { pointInPolygon, roomShape, type RoomShape } from "@/core/geometry/rooms";
import { roofGeometry } from "@/core/geometry/roof";
import { floorArea, floorVolume } from "@/core/geometry/shapes";
import type { Vec2 } from "@/core/geometry/vec";
import { STATIC_SERVICES, type ServiceDefinition } from "./services";
import { SLAB_MIN_THICKNESS, UNPAINTED_WALL_MATERIALS, UNPLASTERED_WALL_MATERIALS, round3, takeoff, type QuantityLine, type TakeoffParams, type TakeoffResult } from "./quantities";

/**
 * LEVANTAMENTO DA CONSTRUÇÃO COMO UM TODO (lista completa de materiais).
 *
 * Complementa `takeoff()` sem alterá-lo. Toda quantidade vem da geometria do
 * modelo (paredes por `core`, líquidas de aberturas, por pavimento; ambientes;
 * telhados; objetos estruturais). Coeficientes, traços, espessuras, perdas e
 * consumos são PARÂMETROS DE REFERÊNCIA EDITÁVEIS, NÃO NORMATIVOS, validados
 * por Zod (`ConstructionParamsSchema`). Traços, resistências e dosagens DEVEM
 * ser validados pelo engenheiro responsável. Nenhum preço é criado aqui.
 *
 * ---------------------------------------------------------------------------
 * TABELA DE PROPRIEDADE (quem emite cada item) — sem dupla contagem
 * ---------------------------------------------------------------------------
 * takeoff() é DONO de (constructionTakeoff NUNCA emite estes códigos):
 *   ALV-BLOCO-CERAMICO / ALV-BLOCO-CONCRETO / ALV-CONCRETO / ALV-DRYWALL (m² de parede, 1 face)
 *   REVEST-REBOCO (m² de chapisco+reboco, 2 faces, interno+externo)
 *   PINT-PAREDE (m²) e PINT-TINTA (L) de paredes (interno+externo)
 *   FORRO-GESSO / FORRO-<material> (m²)      PISO-<material> (m² com perda)
 *   LAJE-CONCRETO (m³ de lajes)              EST-CONCRETO (m³ de pilares e vigas)
 *   COB-<material> (m² de cobertura)         COB-CUMEEIRA (m)
 *   esquadrias (PORTA-*, JANELA-*), vãos livres, louças, móveis, equipamentos,
 *   piscina, paisagismo, escada.
 * constructionTakeoff() é DONO de (insumos e serviços que o takeoff não emite):
 *   Alvenaria: MAT-BLOCO-* (un), ARG-ASSENTAMENTO, ALV-VERGA/ALV-CONTRAVERGA (m),
 *     MAT-DRYWALL-CHAPA/MONTANTE/GUIA, EST-CONCRETO-PAREDE (paredes de concreto).
 *   Argamassas: ARG-CHAPISCO/EMBOCO/REBOCO-INT|EXT (volumes) -> MAT-CIMENTO, MAT-CAL,
 *     MAT-AREIA, MAT-BRITA (consolidados de TODOS os traços).
 *   Estrutura: EST-FUNDACAO (conceitual), EST-CONCRETO-ENG (override), EST-CONCRETO-TOTAL,
 *     MAT-ACO, EST-FORMA. (Volumes de lajes/pilares/vigas ficam com o takeoff;
 *     aqui eles só geram cimento/areia/brita/aço/fôrma.)
 *   Pisos: CONTRAPISO, MAT-ARG-COLANTE, MAT-REJUNTE, ACAB-RODAPE/SOLEIRA/PEITORIL,
 *     REVEST-CERAMICO-PAREDE (áreas molhadas).
 *   Pintura: PINT-INT-SELADOR/MASSA, PINT-EXT-SELADOR/MASSA/TEXTURA, PINT-FORRO(-TINTA).
 *     (A tinta de paredes continua sendo PINT-TINTA do takeoff.)
 *   Cobertura: MAT-TELHA-CERAMICA, MAT-TELHA-CUMEEIRA, COB-ESPIGAO, COB-CALHA,
 *     COB-RUFO, COB-ESTRUTURA (a dimensionar).
 * takeoffComplete() faz o merge e aplica SOMENTE estes ajustes explícitos:
 *   1. Com `structuralOverride.concreteM3`, remove LAJE-CONCRETO e EST-CONCRETO do takeoff
 *      (o volume do engenheiro os substitui via EST-CONCRETO-ENG).
 *   2. Desconta de PINT-PAREDE/PINT-TINTA a área azulejada (REVEST-CERAMICO-PAREDE) e,
 *      se `finishes.exterior.finish = "textura"`, as faces externas (PINT-EXT-TEXTURA).
 *   3. Códigos repetidos: mantém o primeiro e emite aviso (não deve ocorrer).
 *
 * ATENÇÃO DE PREÇO: linhas de serviço do takeoff (ex.: REVEST-REBOCO m²) costumam ser
 * composições que JÁ incluem material; linhas `role: "insumo"` desta lista alimentam a
 * tabela "Quantidade de materiais". Precifique UM dos níveis para não pagar duas vezes.
 * Linhas `role: "informativo"` (volumes de argamassa/concreto) são memória de cálculo e
 * saem como `optional: true` (fora do orçamento por padrão).
 * ---------------------------------------------------------------------------
 */

// ============================================================================
// Tipos de saída
// ============================================================================

export type LineRole = "insumo" | "servico" | "informativo";

export interface ConstructionLine extends QuantityLine {
  role: LineRole;
  /** Números auxiliares (ex.: cementKg, paintDeductM2) para resumos e para o merge. */
  details?: Record<string, number>;
}

export interface ConstructionResult extends TakeoffResult {
  lines: ConstructionLine[];
}

// ============================================================================
// Traços e materiais (fórmula textual de massa específica absoluta)
// ============================================================================

const pos = z.number().finite().positive();
const nn = z.number().finite().nonnegative();
const pct = z.number().finite().min(0).max(100);

/** Traço em massa, por 1 de cimento: cal, areia, brita e fator água/cimento (x). */
export const MixSchema = z.strictObject({ lime: nn, sand: nn, gravel: nn, waterCement: pos });
export type Mix = z.infer<typeof MixSchema>;

/** Traços de concreto de referência (editáveis; fck/consumo a validar pelo engenheiro). */
export const CONCRETE_MIX_PRESETS: Readonly<Record<string, Mix>> = {
  "1:2:3": { lime: 0, sand: 2, gravel: 3, waterCement: 0.55 },
  "1:2:4": { lime: 0, sand: 2, gravel: 4, waterCement: 0.6 },
  "1:3:5": { lime: 0, sand: 3, gravel: 5, waterCement: 0.7 },
};

/** Traços de argamassa de referência (editáveis). "1:1:6" = cimento:cal:areia. */
export const MORTAR_MIX_PRESETS: Readonly<Record<string, Mix>> = {
  "1:3": { lime: 0, sand: 3, gravel: 0, waterCement: 0.8 },
  "1:4": { lime: 0, sand: 4, gravel: 0, waterCement: 0.95 },
  "1:1:6": { lime: 1, sand: 6, gravel: 0, waterCement: 1.2 },
  "1:2:8": { lime: 2, sand: 8, gravel: 0, waterCement: 1.8 },
};

/** Propriedades dos materiais. Densidades reais em kg/dm³, aparentes em kg/m³. */
export const MaterialPropsSchema = z.strictObject({
  cementDensity: pos,
  limeDensity: pos,
  sandDensity: pos,
  gravelDensity: pos,
  /** Massa unitária (aparente) da areia SECA, kg/m³. */
  sandBulkDensity: pos,
  gravelBulkDensity: pos,
  /** Coeficiente de inchamento da areia úmida (volume úmido ÷ seco), ≥ 1. */
  sandSwelling: z.number().finite().min(1),
  cementBagKg: pos,
  limeBagKg: pos,
});
export type MaterialProps = z.infer<typeof MaterialPropsSchema>;

export const DEFAULT_MATERIAL_PROPS: MaterialProps = {
  cementDensity: 3.15,
  limeDensity: 2.3,
  sandDensity: 2.65,
  gravelDensity: 2.7,
  sandBulkDensity: 1500,
  gravelBulkDensity: 1400,
  sandSwelling: 1.25,
  cementBagKg: 50,
  limeBagKg: 20,
};

const MixRefSchema = z.union([z.string().min(1), MixSchema]);
export type MixRef = z.infer<typeof MixRefSchema>;

function resolveMix(ref: MixRef, kind: "mortar" | "concrete"): { name: string; mix: Mix } {
  const presets = kind === "mortar" ? MORTAR_MIX_PRESETS : CONCRETE_MIX_PRESETS;
  if (typeof ref === "string") {
    const mix = presets[ref];
    if (!mix) throw new DomainError(`Traço "${ref}" desconhecido para ${kind === "mortar" ? "argamassa" : "concreto"}. Opções: ${Object.keys(presets).join(", ")}.`);
    return { name: ref, mix };
  }
  const parsed = MixSchema.safeParse(ref);
  if (!parsed.success) throw new DomainError(`Traço inválido: ${parsed.error.issues[0]?.message ?? ""}`);
  const m = parsed.data;
  if (kind === "mortar" && m.gravel > 0) throw new DomainError("Argamassa não leva brita (gravel deve ser 0).");
  if (kind === "concrete" && m.gravel <= 0) throw new DomainError("Concreto estrutural exige brita (gravel > 0).");
  return { name: `1:${m.lime > 0 ? `${m.lime}:` : ""}${m.sand}${m.gravel > 0 ? `:${m.gravel}` : ""} (a/c ${m.waterCement})`, mix: m };
}

/**
 * Consumo de cimento por m³ de mistura (kg/m³), pela fórmula de massa específica absoluta:
 *   C = 1000 / (1/γc + cal/γcal + a/γa + p/γp + x)
 * com γ em kg/dm³ e a, p, cal, x em massa por 1 de cimento. Ignora ar incorporado.
 */
export function mixCementConsumption(mix: Mix, props: MaterialProps = DEFAULT_MATERIAL_PROPS): number {
  return 1000 / (1 / props.cementDensity + mix.lime / props.limeDensity + mix.sand / props.sandDensity + mix.gravel / props.gravelDensity + mix.waterCement);
}

export interface MixMaterials {
  volumeM3: number;
  /** C (kg de cimento por m³). */
  cementKgPerM3: number;
  cementKg: number;
  /** Sacos inteiros (arredondados para cima). */
  cementBags: number;
  limeKg: number;
  limeBags: number;
  sandKg: number;
  /** Areia a pedir (m³ solto, úmido): kg ÷ massa unitária seca × inchamento. */
  sandM3: number;
  gravelKg: number;
  gravelM3: number;
  waterL: number;
  /** Fórmula legível (memória de cálculo). */
  formula: string;
}

const ceilN = (x: number): number => Math.ceil(x - 1e-9);
const fmt = (n: number, dp = 3): string => round3(n).toLocaleString("pt-BR", { maximumFractionDigits: dp });

function mixMaterials(volumeM3: number, mix: Mix, name: string, propsIn: Partial<MaterialProps>): MixMaterials {
  if (!Number.isFinite(volumeM3) || volumeM3 < 0) throw new DomainError("Volume inválido para o cálculo de materiais.");
  const parsed = MaterialPropsSchema.safeParse({ ...DEFAULT_MATERIAL_PROPS, ...propsIn });
  if (!parsed.success) throw new DomainError(`Propriedades de material inválidas: ${parsed.error.issues[0]?.message ?? ""}`);
  const pr = parsed.data;
  const C = mixCementConsumption(mix, pr);
  const cementKg = C * volumeM3;
  const limeKg = mix.lime * cementKg;
  const sandKg = mix.sand * cementKg;
  const gravelKg = mix.gravel * cementKg;
  const terms = [`1/${fmt(pr.cementDensity)}`, ...(mix.lime > 0 ? [`${fmt(mix.lime)}/${fmt(pr.limeDensity)}`] : []), `${fmt(mix.sand)}/${fmt(pr.sandDensity)}`, ...(mix.gravel > 0 ? [`${fmt(mix.gravel)}/${fmt(pr.gravelDensity)}`] : []), fmt(mix.waterCement)];
  return {
    volumeM3,
    cementKgPerM3: C,
    cementKg,
    cementBags: ceilN(cementKg / pr.cementBagKg),
    limeKg,
    limeBags: ceilN(limeKg / pr.limeBagKg),
    sandKg,
    sandM3: (sandKg / pr.sandBulkDensity) * pr.sandSwelling,
    gravelKg,
    gravelM3: gravelKg / pr.gravelBulkDensity,
    waterL: mix.waterCement * cementKg,
    formula: `traço ${name}: C = 1000 ÷ (${terms.join(" + ")}) = ${fmt(C, 1)} kg/m³`,
  };
}

/**
 * Materiais de `volumeM3` de ARGAMASSA. `mix`: traço (cimento = 1) ou nome de preset
 * (`MORTAR_MIX_PRESETS`, ex.: "1:3"). Cimento kg = C·V; areia/cal kg = a·C, l·C; água L = x·C.
 * Referência editável, não normativa: validar traços com o responsável técnico.
 */
export function mortarMaterials(volumeM3: number, mix: Mix | string, props: Partial<MaterialProps> = {}): MixMaterials {
  const r = resolveMix(mix, "mortar");
  return mixMaterials(volumeM3, r.mix, r.name, props);
}

/** Materiais de `volumeM3` de CONCRETO (mesma fórmula, com brita p·C). Presets: `CONCRETE_MIX_PRESETS`. */
export function concreteMaterials(volumeM3: number, mix: Mix | string, props: Partial<MaterialProps> = {}): MixMaterials {
  const r = resolveMix(mix, "concrete");
  return mixMaterials(volumeM3, r.mix, r.name, props);
}

// ============================================================================
// Parâmetros
// ============================================================================

const BlockSchema = z.strictObject({ lengthM: pos, heightM: pos, thicknessM: pos });
const PlasterSideSchema = z.strictObject({ chapiscoM: nn, embocoM: nn, rebocoM: nn });
const TileSchema = z.strictObject({ lengthM: pos, widthM: pos, thicknessM: pos, jointM: nn });
const PaintStepSchema = z.strictObject({ sealerCoats: z.number().int().min(0).max(5), sealerYieldM2PerL: pos, massaCoats: z.number().int().min(0).max(5), massaYieldM2PerKgPerCoat: pos });
const CoveringSchema = z.strictObject({ kind: z.enum(["telha", "chapa"]), unitsPerM2: nn });

export const ConstructionParamsSchema = z.strictObject({
  materials: MaterialPropsSchema,
  /** Traço por uso: nome de preset ou objeto Mix. */
  mixes: z.strictObject({ chapisco: MixRefSchema, emboco: MixRefSchema, reboco: MixRefSchema, assentamento: MixRefSchema, contrapiso: MixRefSchema, concreto: MixRefSchema }),
  masonry: z.strictObject({
    ceramicBlock: BlockSchema,
    concreteBlock: BlockSchema,
    jointM: nn,
    blockLossPercent: pct,
    layingMortarLossPercent: pct,
    /** Diferença máxima aceita entre a espessura da parede e a das fiadas de bloco, sem aviso. */
    wallThicknessToleranceM: nn,
    lintelBearingM: nn,
    lintelHeightM: pos,
    studSpacingM: pos,
    drywallLossPercent: pct,
  }),
  plaster: z.strictObject({ interior: PlasterSideSchema, exterior: PlasterSideSchema, lossPercent: pct }),
  structure: z.strictObject({
    concreteLossPercent: pct,
    steelLossPercent: pct,
    steelKgPerM3: z.strictObject({ slab: nn, beam: nn, column: nn, foundation: nn, wall: nn, lintel: nn }),
    foundation: z.strictObject({ widthM: pos, heightM: pos }),
  }),
  /** Quantidades LÍQUIDAS (sem perda) do engenheiro; substituem lajes+pilares+vigas+fundação modelados. */
  structuralOverride: z.strictObject({ concreteM3: nn.optional(), steelKg: nn.optional(), formworkM2: nn.optional() }),
  floors: z.strictObject({
    subfloorThicknessM: pos,
    subfloorLossPercent: pct,
    floorAdhesiveKgPerM2: nn,
    wallAdhesiveKgPerM2: nn,
    floorTile: TileSchema,
    wallTile: TileSchema,
    groutDensityKgPerDm3: pos,
    groutLossPercent: pct,
    sillOverhangM: nn,
  }),
  finishes: z.strictObject({
    /** Altura do revestimento cerâmico por tipo de ambiente (0 = sem revestimento). */
    wallTileHeightM: z.record(z.string(), nn),
    wallTileLossPercent: pct,
    interior: PaintStepSchema,
    exterior: PaintStepSchema.extend({ finish: z.enum(["tinta", "textura"]), texturaKgPerM2: nn }),
    ceiling: z.strictObject({ coats: z.number().int().min(1).max(5), yieldM2PerLPerCoat: pos }),
  }),
  roof: z.strictObject({
    /** Cobertura por id de material: "telha" = un/m²; "chapa" = apenas m² (do takeoff). */
    coverings: z.record(z.string(), CoveringSchema),
    tileLossPercent: pct,
    ridgeTilesPerM: nn,
  }),
});
export type ConstructionParams = z.infer<typeof ConstructionParamsSchema>;

type DeepPartial<T> = T extends readonly unknown[] ? T : T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;
export type ConstructionParamsInput = DeepPartial<ConstructionParams>;

/**
 * Padrões = PARÂMETROS DE REFERÊNCIA EDITÁVEIS, NÃO NORMATIVOS (ordem de grandeza
 * usual de obra; conferir com fabricante, norma e engenheiro responsável).
 */
export const DEFAULT_CONSTRUCTION_PARAMS: ConstructionParams = {
  materials: DEFAULT_MATERIAL_PROPS,
  mixes: { chapisco: "1:3", emboco: "1:2:8", reboco: "1:2:8", assentamento: "1:1:6", contrapiso: "1:4", concreto: "1:2:3" },
  masonry: {
    ceramicBlock: { lengthM: 0.19, heightM: 0.19, thicknessM: 0.09 },
    concreteBlock: { lengthM: 0.39, heightM: 0.19, thicknessM: 0.14 },
    jointM: 0.01,
    blockLossPercent: 5,
    layingMortarLossPercent: 15,
    wallThicknessToleranceM: 0.03,
    lintelBearingM: 0.3,
    lintelHeightM: 0.1,
    studSpacingM: 0.6,
    drywallLossPercent: 10,
  },
  plaster: {
    // Interno: chapisco 5 mm + emboço 20 mm + reboco 5 mm. Externo: emboço paulista (massa única) 25 mm, sem reboco.
    interior: { chapiscoM: 0.005, embocoM: 0.02, rebocoM: 0.005 },
    exterior: { chapiscoM: 0.005, embocoM: 0.025, rebocoM: 0 },
    lossPercent: 20,
  },
  structure: {
    concreteLossPercent: 5,
    steelLossPercent: 10,
    steelKgPerM3: { slab: 80, beam: 120, column: 150, foundation: 90, wall: 60, lintel: 100 },
    foundation: { widthM: 0.2, heightM: 0.3 },
  },
  structuralOverride: {},
  floors: {
    subfloorThicknessM: 0.05,
    subfloorLossPercent: 10,
    floorAdhesiveKgPerM2: 5,
    wallAdhesiveKgPerM2: 4,
    floorTile: { lengthM: 0.6, widthM: 0.6, thicknessM: 0.009, jointM: 0.003 },
    wallTile: { lengthM: 0.3, widthM: 0.6, thicknessM: 0.008, jointM: 0.002 },
    groutDensityKgPerDm3: 1.9,
    groutLossPercent: 10,
    sillOverhangM: 0.05,
  },
  finishes: {
    wallTileHeightM: { banheiro: 2.1, lavabo: 2.1, cozinha: 1.5 },
    wallTileLossPercent: 10,
    interior: { sealerCoats: 1, sealerYieldM2PerL: 10, massaCoats: 2, massaYieldM2PerKgPerCoat: 2 },
    exterior: { sealerCoats: 1, sealerYieldM2PerL: 10, massaCoats: 2, massaYieldM2PerKgPerCoat: 2, finish: "tinta", texturaKgPerM2: 1.5 },
    ceiling: { coats: 2, yieldM2PerLPerCoat: 10 },
  },
  roof: {
    coverings: {
      "roof-tile-ceramic": { kind: "telha", unitsPerM2: 16 },
      "roof-metal": { kind: "chapa", unitsPerM2: 0 },
      "roof-fiber-cement": { kind: "chapa", unitsPerM2: 0 },
    },
    tileLossPercent: 5,
    ridgeTilesPerM: 3,
  },
};

const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
function deepMerge(base: unknown, over: unknown): unknown {
  if (over === undefined) return base;
  if (isPlain(base) && isPlain(over)) {
    const out: Record<string, unknown> = { ...base };
    for (const k of Object.keys(over)) out[k] = deepMerge(base[k], over[k]);
    return out;
  }
  return over;
}

/** Mescla (profundamente) os parâmetros informados sobre os padrões e valida com Zod. */
export function resolveConstructionParams(input: ConstructionParamsInput = {}): ConstructionParams {
  const parsed = ConstructionParamsSchema.safeParse(deepMerge(DEFAULT_CONSTRUCTION_PARAMS, input));
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    throw new DomainError(`Parâmetros de construção inválidos: ${i ? `${i.path.join(".")} ${i.message}`.trim() : ""}`);
  }
  return parsed.data;
}

// ============================================================================
// Contexto geométrico e classificação de faces
// ============================================================================

interface RoomInfo {
  room: Room;
  shape: RoomShape | null;
}

interface Ctx {
  project: Project;
  walls: Wall[];
  openings: Opening[];
  hosted: Map<string, Opening[]>;
  rooms: RoomInfo[];
  roomsByLevel: Map<string, RoomInfo[]>;
  levelName: (id: string | null) => string;
}

function buildCtx(project: Project): Ctx {
  const walls = project.elements.filter(isWall);
  const openings = project.elements.filter(isOpening);
  const hosted = new Map<string, Opening[]>();
  for (const o of openings) hosted.set(o.hostId, [...(hosted.get(o.hostId) ?? []), o]);
  const rooms: RoomInfo[] = [];
  const roomsByLevel = new Map<string, RoomInfo[]>();
  for (const e of project.elements) {
    if (e.type !== "room") continue;
    const info: RoomInfo = { room: e, shape: roomShape(levelWalls(project, e.levelId), e.seed) };
    rooms.push(info);
    roomsByLevel.set(e.levelId, [...(roomsByLevel.get(e.levelId) ?? []), info]);
  }
  const names = new Map(project.levels.map((l) => [l.id, l.name]));
  return { project, walls, openings, hosted, rooms, roomsByLevel, levelName: (id) => (id ? (names.get(id) ?? id) : "—") };
}

export interface WallFaceArea {
  wallId: string;
  levelId: string;
  /** "left" = lado da normal à esquerda do sentido start → end. */
  face: "left" | "right";
  /** Área bruta da face (comprimento × altura), m². */
  grossArea: number;
  /** Área líquida da face (descontadas as aberturas), m². */
  netArea: number;
  interiorArea: number;
  exteriorArea: number;
  /** Predominantemente interna (interiorArea ≥ exteriorArea e > 0). */
  interior: boolean;
  /** Ambientes voltados para esta face (parte interna). */
  roomIds: string[];
}

/** Parâmetro u (ao longo da reta p0 + d·u) onde a reta cruza o segmento a-b, ou null. */
function crossU(p0: Vec2, d: Vec2, a: Vec2, b: Vec2): number | null {
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const denom = d.x * ey - d.y * ex;
  if (Math.abs(denom) < 1e-12) return null;
  const wx = a.x - p0.x;
  const wy = a.y - p0.y;
  const s = (wx * d.y - wy * d.x) / denom;
  if (s < -1e-9 || s > 1 + 1e-9) return null;
  return (wx * ey - wy * ex) / denom;
}

const netBetween = (pieces: readonly WallPiece[], a: number, b: number): number =>
  pieces.reduce((s, p) => s + Math.max(0, Math.min(b, p.u1) - Math.max(a, p.u0)) * (p.v1 - p.v0), 0);

/** Ambiente (da lista) cujo contorno pelos eixos contém o ponto. */
const roomAt = (list: readonly RoomInfo[] | undefined, pt: Vec2): RoomInfo | undefined => (list ?? []).find((r) => r.shape && pointInPolygon(pt, r.shape.axis));

function classifyFace(ctx: Ctx, wall: Wall, sign: 1 | -1, pieces: readonly WallPiece[]): { interior: number; exterior: number; roomIds: string[] } {
  const f = wallFrame(wall);
  const off = sign * (wall.thickness / 2 + 0.05);
  const p0: Vec2 = { x: f.origin.x + f.normal.x * off, y: f.origin.y + f.normal.y * off };
  const list = ctx.roomsByLevel.get(wall.levelId);
  const cuts = new Set<number>([0, f.length]);
  for (const r of list ?? []) {
    if (!r.shape) continue;
    const poly = r.shape.axis;
    for (let i = 0; i < poly.length; i++) {
      const u = crossU(p0, f.dir, poly[i]!, poly[(i + 1) % poly.length]!);
      if (u !== null && u > 1e-9 && u < f.length - 1e-9) cuts.add(u);
    }
  }
  const us = [...cuts].sort((x, y) => x - y);
  let interior = 0;
  let exterior = 0;
  const roomIds = new Set<string>();
  for (let i = 0; i < us.length - 1; i++) {
    const a = us[i]!;
    const b = us[i + 1]!;
    if (b - a < 1e-9) continue;
    const mid = (a + b) / 2;
    const hit = roomAt(list, { x: p0.x + f.dir.x * mid, y: p0.y + f.dir.y * mid });
    const area = netBetween(pieces, a, b);
    if (hit) {
      interior += area;
      roomIds.add(hit.room.id);
    } else exterior += area;
  }
  return { interior, exterior, roomIds: [...roomIds] };
}

function computeFaces(ctx: Ctx): Map<string, [WallFaceArea, WallFaceArea]> {
  const out = new Map<string, [WallFaceArea, WallFaceArea]>();
  for (const w of ctx.walls) {
    const pieces = computeWallPieces(w, ctx.hosted.get(w.id) ?? []);
    const net = pieces.reduce((s, p) => s + (p.u1 - p.u0) * (p.v1 - p.v0), 0);
    const mk = (face: "left" | "right", sign: 1 | -1): WallFaceArea => {
      const c = classifyFace(ctx, w, sign, pieces);
      return { wallId: w.id, levelId: w.levelId, face, grossArea: wallLength(w) * w.height, netArea: net, interiorArea: c.interior, exteriorArea: c.exterior, interior: c.interior > 1e-9 && c.interior >= c.exterior, roomIds: c.roomIds };
    };
    out.set(w.id, [mk("left", 1), mk("right", -1)]);
  }
  return out;
}

/**
 * Classifica as DUAS faces de cada parede em interna/externa. Cada face é amostrada num
 * ponto deslocado de (espessura/2 + 0,05 m) do eixo; trechos cujo ponto cai dentro do
 * contorno (pelos eixos) de um ambiente do MESMO pavimento são internos, os demais externos.
 * A divisão é exata (cortes nos cruzamentos com os contornos), então uma face mista traz
 * `interiorArea` e `exteriorArea` parciais. A área é líquida de aberturas.
 */
export function wallFaceAreas(project: Project): WallFaceArea[] {
  const ctx = buildCtx(project);
  return [...computeFaces(ctx).values()].flat();
}

/** Ambientes voltados para cada lado do vão da abertura (amostra no centro da abertura). */
function openingRooms(ctx: Ctx, wall: Wall, o: Opening): RoomInfo[] {
  const f = wallFrame(wall);
  const u = Math.min(Math.max(o.offset, 0), f.length);
  const list = ctx.roomsByLevel.get(wall.levelId);
  const found: RoomInfo[] = [];
  for (const sign of [1, -1] as const) {
    const off = sign * (wall.thickness / 2 + 0.05);
    const hit = roomAt(list, { x: f.origin.x + f.dir.x * u + f.normal.x * off, y: f.origin.y + f.dir.y * u + f.normal.y * off });
    if (hit && !found.includes(hit)) found.push(hit);
  }
  return found;
}

// ============================================================================
// Acumuladores
// ============================================================================

class Tally {
  total = 0;
  readonly ids = new Set<string>();
  readonly levels = new Set<string | null>();
  private parts = new Map<string, number>();
  constructor(private readonly ctx: Ctx) {}
  add(value: number, els: { id: string } | readonly { id: string }[], levelId: string | null): void {
    this.total += value;
    for (const e of Array.isArray(els) ? (els as readonly { id: string }[]) : [els as { id: string }]) this.ids.add(e.id);
    this.levels.add(levelId);
    const label = this.ctx.levelName(levelId);
    this.parts.set(label, (this.parts.get(label) ?? 0) + value);
  }
  get any(): boolean {
    return this.total > 1e-9;
  }
  levelId(): string | null {
    return this.levels.size === 1 ? ([...this.levels][0] ?? null) : null;
  }
  idList(): string[] {
    return [...this.ids];
  }
  text(unit: string, dp = 3): string {
    return [...this.parts.entries()].map(([l, v]) => `${l} ${fmt(v, dp)} ${unit}`).join(" + ");
  }
}

/** Origem de elementos/pavimento de uma linha. */
interface Src {
  idList(): string[];
  levelId(): string | null;
}
const NO_SRC: Src = { idList: () => [], levelId: () => null };

const cm = (m: number): string => fmt(m * 100, 1);

interface Use {
  label: string;
  kind: "mortar" | "concrete";
  mixName: string;
  mix: Mix;
  /** Volume COM perda, m³. */
  volume: number;
  ids: string[];
  levelId: string | null;
}

const PAINTABLE_GROUPS: readonly string[] = ["Tinta", "Alvenaria", "Acabamento"]; // espelha takeoff (quantities.ts)
const isGlass = (w: Wall): boolean => getMaterial(w.materialId).group === "Vidro";
const isPaintable = (w: Wall): boolean => !UNPAINTED_WALL_MATERIALS.includes(w.materialId) && PAINTABLE_GROUPS.includes(getMaterial(w.materialId).group);
const isPlastered = (w: Wall): boolean => w.core !== "drywall" && !UNPLASTERED_WALL_MATERIALS.includes(w.materialId);
const TILED_GROUPS: readonly string[] = ["Cerâmica", "Pedra"];

// ============================================================================
// Levantamento
// ============================================================================

const S = STATIC_SERVICES;

/**
 * Lista de materiais da construção inteira (ver cabeçalho do arquivo para a tabela de
 * propriedade). Retorna o mesmo formato de `takeoff()` (linhas com `role`/`details` extras).
 */
export function constructionTakeoff(project: Project, paramsInput: ConstructionParamsInput = {}): ConstructionResult {
  const p = resolveConstructionParams(paramsInput);
  const ctx = buildCtx(project);
  const faces = computeFaces(ctx);
  const warnings: string[] = [];
  const lines: ConstructionLine[] = [];
  const uses: Use[] = [];

  const mixOf = {
    chapisco: resolveMix(p.mixes.chapisco, "mortar"),
    emboco: resolveMix(p.mixes.emboco, "mortar"),
    reboco: resolveMix(p.mixes.reboco, "mortar"),
    assentamento: resolveMix(p.mixes.assentamento, "mortar"),
    contrapiso: resolveMix(p.mixes.contrapiso, "mortar"),
    concreto: resolveMix(p.mixes.concreto, "concrete"),
  };

  const push = (def: ServiceDefinition, quantity: number, t: Src, basis: string, role: LineRole, extra: { details?: Record<string, number>; optional?: boolean } = {}): void => {
    const q = round3(quantity);
    if (!(q > 0)) return;
    const line: ConstructionLine = { code: def.code, description: def.description, unit: def.unit, quantity: q, category: def.category, elementIds: t.idList(), basis, levelId: t.levelId(), role };
    if (extra.details) line.details = extra.details;
    if (extra.optional) line.optional = true;
    lines.push(line);
  };
  const addUse = (label: string, kind: Use["kind"], key: keyof typeof mixOf, volumeNet: number, lossPercent: number, t: Src): void => {
    if (!(volumeNet > 1e-9)) return;
    uses.push({ label, kind, mixName: mixOf[key].name, mix: mixOf[key].mix, volume: volumeNet * (1 + lossPercent / 100), ids: t.idList(), levelId: t.levelId() });
  };
  const T = () => new Tally(ctx);
  const merge = (...ts: Tally[]): Tally => {
    const m = T();
    for (const x of ts) {
      for (const id of x.ids) m.ids.add(id);
      for (const l of x.levels) m.levels.add(l);
    }
    return m;
  };

  // ---------------- Paredes: alvenaria, drywall, concreto, faces ----------------
  const mp = p.masonry;
  const tCer = T();
  const tCon = T();
  const tLaying = T();
  let cerArea = 0;
  let conArea = 0;
  let cerRaw = 0;
  let conRaw = 0;
  let layingNet = 0;
  const perM2 = (b: { lengthM: number; heightM: number }) => 1 / ((b.lengthM + mp.jointM) * (b.heightM + mp.jointM));
  const tBoard = T();
  const tStud = T();
  const tGuide = T();
  let boardArea = 0;
  let studLen = 0;
  let guideLen = 0;
  const tWallC = T();
  let wallConcreteVol = 0;
  let wallConcreteForm = 0;
  const tVerga = T();
  const tContra = T();
  let vergaLen = 0;
  let contraLen = 0;
  let lintelVol = 0;
  const tPlasterInt = T();
  const tPlasterExt = T();
  const tPaintInt = T();
  const tPaintExt = T();
  const glassWalls: string[] = [];
  const thicknessMismatch: string[] = [];

  for (const w of ctx.walls) {
    if (isGlass(w)) {
      glassWalls.push(w.name);
      continue;
    }
    const hosted = ctx.hosted.get(w.id) ?? [];
    const net = wallQuantities(w, hosted).netArea;
    const fc = faces.get(w.id)!;
    const intA = fc[0].interiorArea + fc[1].interiorArea;
    const extA = fc[0].exteriorArea + fc[1].exteriorArea;

    if (w.core === "ceramic-brick" || w.core === "concrete-block") {
      const b = w.core === "ceramic-brick" ? mp.ceramicBlock : mp.concreteBlock;
      const leaves = Math.max(1, Math.round(w.thickness / b.thicknessM));
      const masonryT = leaves * b.thicknessM;
      if (Math.abs(w.thickness - masonryT) > mp.wallThicknessToleranceM + 1e-9) thicknessMismatch.push(`"${w.name}" (${cm(w.thickness)} cm × alvenaria de ${cm(masonryT)} cm)`);
      const count = net * leaves * perM2(b);
      const blocksVol = count * b.lengthM * b.heightM * b.thicknessM;
      layingNet += Math.max(0, net * masonryT - blocksVol);
      tLaying.add(Math.max(0, net * masonryT - blocksVol), w, w.levelId);
      if (w.core === "ceramic-brick") {
        tCer.add(count, w, w.levelId);
        cerArea += net * leaves;
        cerRaw += count;
      } else {
        tCon.add(count, w, w.levelId);
        conArea += net * leaves;
        conRaw += count;
      }
      // Vergas e contravergas
      for (const o of hosted) {
        const sill = openingSill(o);
        const top = sill + o.height;
        const len = o.width + 2 * mp.lintelBearingM;
        if (top < w.height - 1e-6) {
          vergaLen += len;
          lintelVol += len * w.thickness * mp.lintelHeightM;
          tVerga.add(len, o, w.levelId);
        }
        if (o.type === "window" && sill > 1e-6) {
          contraLen += len;
          lintelVol += len * w.thickness * mp.lintelHeightM;
          tContra.add(len, o, w.levelId);
        }
      }
    } else if (w.core === "concrete") {
      const vol = net * w.thickness;
      wallConcreteVol += vol;
      wallConcreteForm += 2 * net;
      tWallC.add(vol, w, w.levelId);
    } else {
      // drywall: chapas nas duas faces; montantes a cada studSpacing; guias em cima e embaixo
      const L = wallLength(w);
      boardArea += 2 * net;
      tBoard.add(2 * net, w, w.levelId);
      const studs = Math.floor(L / mp.studSpacingM + 1e-9) + 1;
      studLen += studs * w.height;
      tStud.add(studs * w.height, w, w.levelId);
      guideLen += 2 * L;
      tGuide.add(2 * L, w, w.levelId);
    }

    if (isPlastered(w)) {
      tPlasterInt.add(intA, w, w.levelId);
      tPlasterExt.add(extA, w, w.levelId);
    }
    if (isPaintable(w)) {
      tPaintInt.add(intA, w, w.levelId);
      tPaintExt.add(extA, w, w.levelId);
    }
  }

  if (glassWalls.length > 0) warnings.push(`Paredes de vidro (${glassWalls.join(", ")}) são tratadas como guarda-corpo/esquadria: sem insumos de alvenaria, revestimento ou pintura.`);
  if (thicknessMismatch.length > 0) {
    warnings.push(`Espessura da parede incompatível com as fiadas de bloco adotadas (${thicknessMismatch.slice(0, 4).join("; ")}${thicknessMismatch.length > 4 ? `; e mais ${thicknessMismatch.length - 4}` : ""}): verifique o bloco/parâmetros de alvenaria.`);
  }

  const blockLoss = 1 + mp.blockLossPercent / 100;
  const blockLine = (def: ServiceDefinition, t: Tally, area: number, raw: number, b: { lengthM: number; heightM: number; thicknessM: number }): void => {
    if (!t.any) return;
    push(
      def,
      ceilN(raw * blockLoss),
      t,
      `Σ área líquida de alvenaria × fiadas (${t.text("un")} em blocos) — área equivalente ${fmt(area)} m² × 1/((${fmt(b.lengthM)} + ${fmt(mp.jointM)}) × (${fmt(b.heightM)} + ${fmt(mp.jointM)})) = ${fmt(perM2(b))} un/m² → ${fmt(raw)} un × (1 + ${fmt(mp.blockLossPercent, 2)}% de perda), arredondado para cima. Bloco ${cm(b.thicknessM)}×${cm(b.heightM)}×${cm(b.lengthM)} cm (esp.×alt.×comp.), junta ${cm(mp.jointM)} cm (parâmetros de referência editáveis).`,
      "insumo",
      { details: { rawUnits: raw, areaM2: area } },
    );
  };
  blockLine(S["MAT-BLOCO-CERAMICO"], tCer, cerArea, cerRaw, mp.ceramicBlock);
  blockLine(S["MAT-BLOCO-CONCRETO"], tCon, conArea, conRaw, mp.concreteBlock);

  if (tLaying.any) {
    const vol = layingNet * (1 + mp.layingMortarLossPercent / 100);
    push(
      S["ARG-ASSENTAMENTO"],
      vol,
      tLaying,
      `Argamassa de assentamento = volume da alvenaria (área líquida × fiadas × espessura do bloco) − volume dos blocos (un × comp. × alt. × esp.) = ${fmt(layingNet)} m³ × (1 + ${fmt(mp.layingMortarLossPercent, 2)}% de perda); traço ${mixOf.assentamento.name}.`,
      "informativo",
      { optional: true },
    );
    addUse("assentamento de alvenaria", "mortar", "assentamento", layingNet, mp.layingMortarLossPercent, tLaying);
  }

  if (tVerga.any) {
    push(S["ALV-VERGA"], vergaLen, tVerga, `Σ (largura do vão + 2 × ${fmt(mp.lintelBearingM)} m de apoio) das aberturas com alvenaria acima (${tVerga.text("m")}); seção ${cm(mp.lintelHeightM)} cm de altura × espessura da parede. Concreto traço ${mixOf.concreto.name} entra nos insumos.`, "servico");
  }
  if (tContra.any) {
    push(S["ALV-CONTRAVERGA"], contraLen, tContra, `Σ (largura da janela + 2 × ${fmt(mp.lintelBearingM)} m de apoio) das janelas com peitoril (${tContra.text("m")}); seção ${cm(mp.lintelHeightM)} cm × espessura da parede.`, "servico");
  }

  if (tBoard.any) {
    push(S["MAT-DRYWALL-CHAPA"], boardArea * (1 + mp.drywallLossPercent / 100), tBoard, `Σ área líquida × 2 faces (${tBoard.text("m²")}) × (1 + ${fmt(mp.drywallLossPercent, 2)}% de perda).`, "insumo");
    push(S["MAT-DRYWALL-MONTANTE"], studLen, tStud, `Σ [(⌊comprimento ÷ ${fmt(mp.studSpacingM)} m⌋ + 1) montantes × altura da parede] (${tStud.text("m")}).`, "insumo");
    push(S["MAT-DRYWALL-GUIA"], guideLen, tGuide, `Σ 2 guias (superior e inferior) × comprimento da parede (${tGuide.text("m")}).`, "insumo");
  }

  // ---------------- Revestimentos de argamassa (faces interna x externa) ----------------
  const pl = p.plaster;
  const layers: Array<{ key: "chapisco" | "emboco" | "reboco"; label: string; int: number; ext: number; codeInt: keyof typeof S; codeExt: keyof typeof S }> = [
    { key: "chapisco", label: "chapisco", int: pl.interior.chapiscoM, ext: pl.exterior.chapiscoM, codeInt: "ARG-CHAPISCO-INT", codeExt: "ARG-CHAPISCO-EXT" },
    { key: "emboco", label: "emboço", int: pl.interior.embocoM, ext: pl.exterior.embocoM, codeInt: "ARG-EMBOCO-INT", codeExt: "ARG-EMBOCO-EXT" },
    { key: "reboco", label: "reboco", int: pl.interior.rebocoM, ext: pl.exterior.rebocoM, codeInt: "ARG-REBOCO-INT", codeExt: "ARG-REBOCO-EXT" },
  ];
  for (const ly of layers) {
    for (const side of ["int", "ext"] as const) {
      const t = side === "int" ? tPlasterInt : tPlasterExt;
      const th = side === "int" ? ly.int : ly.ext;
      if (!t.any || !(th > 0)) continue;
      const net = t.total * th;
      const code = S[side === "int" ? ly.codeInt : ly.codeExt];
      push(
        code,
        net * (1 + pl.lossPercent / 100),
        t,
        `Σ área das faces ${side === "int" ? "internas" : "externas"} rebocáveis (${t.text("m²")}) × espessura ${fmt(th * 1000, 1)} mm = ${fmt(net)} m³ × (1 + ${fmt(pl.lossPercent, 2)}% de perda); traço ${mixOf[ly.key].name}. Faces classificadas por wallFaceAreas; mesmo critério de rebocável do takeoff (REVEST-REBOCO).`,
        "informativo",
        { optional: true },
      );
      addUse(`${ly.label} ${side === "int" ? "interno" : "externo"}`, "mortar", ly.key, net, pl.lossPercent, t);
    }
  }

  // ---------------- Ambientes: contrapiso, colante, rejunte, rodapé, azulejo ----------------
  const fl = p.floors;
  const fin = p.finishes;
  const roomOpenings = new Map<string, Array<{ o: Opening; wall: Wall }>>();
  for (const w of ctx.walls) {
    for (const o of ctx.hosted.get(w.id) ?? []) {
      for (const r of openingRooms(ctx, w, o)) roomOpenings.set(r.room.id, [...(roomOpenings.get(r.room.id) ?? []), { o, wall: w }]);
    }
  }
  const wallById = new Map(ctx.walls.map((w) => [w.id, w]));

  const tSub = T();
  const tFloorTile = T();
  const tWallTile = T();
  const tBase = T();
  const tCeilPaint = T();
  let subNet = 0;
  let floorTileArea = 0;
  let wallTileNet = 0;
  let baseLen = 0;
  let paintDeduct = 0;
  let ceilArea = 0;

  const rooms = ctx.rooms;
  if (rooms.length === 0) warnings.push("O projeto não possui ambientes: pisos e forros não foram levantados.");
  for (const { room, shape } of rooms) {
    if (!shape) {
      warnings.push(`Ambiente "${room.name}" não está fechado por paredes; área não computada.`);
      continue;
    }
    const area = shape.area;
    const fm = room.materialId;
    if (!fm.startsWith("concrete") && fm !== "grass") {
      subNet += area * fl.subfloorThicknessM;
      tSub.add(area * fl.subfloorThicknessM, room, room.levelId);
    }
    if (TILED_GROUPS.includes(getMaterial(fm).group)) {
      floorTileArea += area;
      tFloorTile.add(area, room, room.levelId);
    }
    const ceilingPainted = room.ceiling && room.ceilingMaterialId === "gypsum";
    if (ceilingPainted) {
      ceilArea += area;
      tCeilPaint.add(area, room, room.levelId);
    }

    const facing = roomOpenings.get(room.id) ?? [];
    const tileH0 = fin.wallTileHeightM[room.roomType] ?? 0;
    if (tileH0 > 0) {
      const minH = Math.min(...shape.wallIds.map((id) => wallById.get(id)?.height ?? tileH0), tileH0);
      const gross = shape.perimeter * minH;
      let ded = 0;
      for (const { o } of facing) {
        const lo = Math.max(openingSill(o), 0);
        const hi = Math.min(openingSill(o) + o.height, minH);
        ded += o.width * Math.max(0, hi - lo);
      }
      const netTile = Math.max(0, gross - ded);
      wallTileNet += netTile;
      tWallTile.add(netTile, room, room.levelId);
      // Parcela da área azulejada que estava sendo pintada pelo takeoff (por comprimento de eixo das paredes pintáveis).
      const lens = shape.wallIds.map((id) => wallById.get(id)).filter((x): x is Wall => !!x);
      const totalLen = lens.reduce((s, w) => s + wallLength(w), 0);
      const paintLen = lens.filter(isPaintable).reduce((s, w) => s + wallLength(w), 0);
      paintDeduct += totalLen > 0 ? netTile * (paintLen / totalLen) : 0;
    } else {
      const doors = facing.filter(({ o }) => o.type === "door").reduce((s, { o }) => s + o.width, 0);
      const len = Math.max(0, shape.perimeter - doors);
      baseLen += len;
      tBase.add(len, room, room.levelId);
    }
  }
  // Pisos (elementos "floor") com revestimento cerâmico/pedra: também recebem colante e rejunte.
  for (const e of ctx.project.elements) {
    if (e.type !== "floor") continue;
    if (e.materialId.startsWith("concrete") && e.thickness >= SLAB_MIN_THICKNESS) continue;
    if (TILED_GROUPS.includes(getMaterial(e.materialId).group)) {
      floorTileArea += floorArea(e);
      tFloorTile.add(floorArea(e), e, e.levelId);
    }
  }

  if (tSub.any) {
    push(
      S.CONTRAPISO,
      subNet,
      tSub,
      `Σ área útil dos ambientes (${tSub.text("m³", 3)} = área × ${fmt(fl.subfloorThicknessM * 100, 1)} cm de espessura). Com ${fmt(fl.subfloorLossPercent, 2)}% de perda a argamassa (traço ${mixOf.contrapiso.name}) alimenta cimento/areia. Não inclui ambientes com piso de concreto aparente/grama.`,
      "servico",
    );
    addUse("contrapiso", "mortar", "contrapiso", subNet, fl.subfloorLossPercent, tSub);
  }

  const grout = (t: { lengthM: number; widthM: number; thicknessM: number; jointM: number }): number => {
    const A = t.lengthM * 1000;
    const B = t.widthM * 1000;
    // dm³ de rejunte por m² = (A+B)·e·t/(A·B), com A,B,e,t em mm; × densidade.
    return (((A + B) * (t.jointM * 1000) * (t.thicknessM * 1000)) / (A * B)) * fl.groutDensityKgPerDm3 * (1 + fl.groutLossPercent / 100);
  };
  const tileDesc = (t: { lengthM: number; widthM: number; thicknessM: number; jointM: number }) => `peça ${cm(t.lengthM)}×${cm(t.widthM)} cm, esp. ${fmt(t.thicknessM * 1000, 1)} mm, junta ${fmt(t.jointM * 1000, 1)} mm`;
  const groutFloorM2 = grout(fl.floorTile);
  const groutWallM2 = grout(fl.wallTile);
  const adhesiveKg = floorTileArea * fl.floorAdhesiveKgPerM2 + wallTileNet * fl.wallAdhesiveKgPerM2;
  if (adhesiveKg > 0) {
    const t = merge(tFloorTile, tWallTile);
    push(
      S["MAT-ARG-COLANTE"],
      adhesiveKg,
      t,
      `Piso revestido ${fmt(floorTileArea)} m² × ${fmt(fl.floorAdhesiveKgPerM2)} kg/m² + azulejo de parede ${fmt(wallTileNet)} m² × ${fmt(fl.wallAdhesiveKgPerM2)} kg/m² (consumo de referência editável; depende da desempenadeira e do fabricante). Piso: ambientes e pisos com acabamento do grupo Cerâmica/Pedra.`,
      "insumo",
    );
  }
  const groutKg = floorTileArea * groutFloorM2 + wallTileNet * groutWallM2;
  if (groutKg > 0) {
    const t = merge(tFloorTile, tWallTile);
    push(
      S["MAT-REJUNTE"],
      groutKg,
      t,
      `Rejunte = área × (A+B)·e·t/(A·B) [dm³/m²] × ${fmt(fl.groutDensityKgPerDm3)} kg/dm³ × (1 + ${fmt(fl.groutLossPercent, 2)}% de perda). Piso: ${tileDesc(fl.floorTile)} → ${fmt(groutFloorM2, 3)} kg/m² × ${fmt(floorTileArea)} m²; parede: ${tileDesc(fl.wallTile)} → ${fmt(groutWallM2, 3)} kg/m² × ${fmt(wallTileNet)} m².`,
      "insumo",
    );
  }
  if (tWallTile.any) {
    const hs = Object.entries(fin.wallTileHeightM).filter(([, h]) => h > 0).map(([k, h]) => `${k} ${fmt(h)} m`).join(", ");
    push(
      S["REVEST-CERAMICO-PAREDE"],
      wallTileNet * (1 + fin.wallTileLossPercent / 100),
      tWallTile,
      `Σ (perímetro interno × altura do azulejo [${hs}] − aberturas dentro da altura) = ${fmt(wallTileNet)} m² (${tWallTile.text("m²")}) × (1 + ${fmt(fin.wallTileLossPercent, 2)}% de perda).`,
      "servico",
      { details: { netAreaM2: wallTileNet, paintDeductM2: paintDeduct } },
    );
  }
  if (tBase.any) {
    push(S["ACAB-RODAPE"], baseLen, tBase, `Σ (perímetro interno do ambiente − larguras das portas/passagens voltadas ao ambiente) (${tBase.text("m")}); ambientes com azulejo de parede não recebem rodapé.`, "servico");
  }

  // Soleiras e peitoris
  const tSill = T();
  const tPeit = T();
  let sillLen = 0;
  let peitLen = 0;
  for (const w of ctx.walls) {
    for (const o of ctx.hosted.get(w.id) ?? []) {
      if (o.type === "door" && o.style !== "opening") {
        sillLen += o.width;
        tSill.add(o.width, o, w.levelId);
      } else if (o.type === "window") {
        const len = o.width + 2 * fl.sillOverhangM;
        peitLen += len;
        tPeit.add(len, o, w.levelId);
      }
    }
  }
  if (tSill.any) push(S["ACAB-SOLEIRA"], sillLen, tSill, `Σ largura das portas de giro/correr (vãos livres não levam soleira) (${tSill.text("m")}).`, "servico");
  if (tPeit.any) push(S["ACAB-PEITORIL"], peitLen, tPeit, `Σ (largura da janela + 2 × ${fmt(fl.sillOverhangM)} m de transpasse) (${tPeit.text("m")}).`, "servico");

  // ---------------- Pintura e acabamentos internos x externos ----------------
  const intPaint = Math.max(0, tPaintInt.total - paintDeduct);
  const extPaint = tPaintExt.total;
  const pi = fin.interior;
  const pe = fin.exterior;
  const paintBasis = (side: string, area: number, gross: number, deduct: number): string =>
    `área ${side} pintável = ${fmt(gross)} m² (faces classificadas por wallFaceAreas)${deduct > 0 ? ` − ${fmt(deduct)} m² azulejados` : ""} = ${fmt(area)} m²`;
  if (intPaint > 1e-9) {
    if (pi.sealerCoats > 0) push(S["PINT-INT-SELADOR"], (intPaint * pi.sealerCoats) / pi.sealerYieldM2PerL, tPaintInt, `${paintBasis("interna", intPaint, tPaintInt.total, paintDeduct)} × ${pi.sealerCoats} demão(s) ÷ rendimento ${fmt(pi.sealerYieldM2PerL)} m²/L (referência editável).`, "insumo", { details: { areaM2: intPaint } });
    if (pi.massaCoats > 0) push(S["PINT-INT-MASSA"], (intPaint * pi.massaCoats) / pi.massaYieldM2PerKgPerCoat, tPaintInt, `${paintBasis("interna", intPaint, tPaintInt.total, paintDeduct)} × ${pi.massaCoats} demão(s) ÷ rendimento ${fmt(pi.massaYieldM2PerKgPerCoat)} m²/kg por demão (massa corrida; referência editável, conferir ficha técnica).`, "insumo", { details: { areaM2: intPaint } });
  }
  if (extPaint > 1e-9) {
    if (pe.sealerCoats > 0) push(S["PINT-EXT-SELADOR"], (extPaint * pe.sealerCoats) / pe.sealerYieldM2PerL, tPaintExt, `${paintBasis("externa", extPaint, extPaint, 0)} × ${pe.sealerCoats} demão(s) ÷ rendimento ${fmt(pe.sealerYieldM2PerL)} m²/L (referência editável).`, "insumo", { details: { areaM2: extPaint } });
    if (pe.finish === "tinta") {
      if (pe.massaCoats > 0) push(S["PINT-EXT-MASSA"], (extPaint * pe.massaCoats) / pe.massaYieldM2PerKgPerCoat, tPaintExt, `${paintBasis("externa", extPaint, extPaint, 0)} × ${pe.massaCoats} demão(s) ÷ rendimento ${fmt(pe.massaYieldM2PerKgPerCoat)} m²/kg por demão (massa acrílica; referência editável).`, "insumo", { details: { areaM2: extPaint } });
    } else {
      push(S["PINT-EXT-TEXTURA"], extPaint * pe.texturaKgPerM2, tPaintExt, `${paintBasis("externa", extPaint, extPaint, 0)} × ${fmt(pe.texturaKgPerM2)} kg/m² (textura acrílica; referência editável). Fachada em textura: a tinta de fachada do takeoff é descontada em takeoffComplete.`, "insumo", { details: { areaM2: extPaint, paintDeductM2: extPaint } });
    }
  }
  if (tCeilPaint.any) {
    push(S["PINT-FORRO"], ceilArea, tCeilPaint, `Σ área útil dos ambientes com forro de gesso (${tCeilPaint.text("m²")}).`, "servico");
    push(S["PINT-FORRO-TINTA"], (ceilArea * fin.ceiling.coats) / fin.ceiling.yieldM2PerLPerCoat, tCeilPaint, `${fmt(ceilArea)} m² × ${fin.ceiling.coats} demãos ÷ rendimento ${fmt(fin.ceiling.yieldM2PerLPerCoat)} m²/L por demão (referência editável).`, "insumo");
  }

  // ---------------- Estrutura de concreto ----------------
  const st = p.structure;
  const ov = p.structuralOverride;
  const tSlab = T();
  const tCol = T();
  const tBeam = T();
  const tFound = T();
  let vSlab = 0;
  let vCol = 0;
  let vBeam = 0;
  let vFound = 0;
  let foundLen = 0;
  let fSlab = 0;
  let fCol = 0;
  let fBeam = 0;
  let fFound = 0;
  for (const e of ctx.project.elements) {
    if (e.type === "floor" && e.materialId.startsWith("concrete") && e.thickness >= SLAB_MIN_THICKNESS) {
      const v = floorVolume(e);
      vSlab += v;
      fSlab += floorArea(e) + 2 * (e.width + e.depth) * e.thickness;
      tSlab.add(v, e, e.levelId);
    } else if (e.type === "object" && e.materialId.startsWith("concrete")) {
      if (e.kind === "column-rect") {
        const v = e.length * e.width * e.height;
        vCol += v;
        fCol += 2 * (e.length + e.width) * e.height;
        tCol.add(v, e, e.levelId);
      } else if (e.kind === "column-round") {
        const a = e.length / 2;
        const b = e.width / 2;
        const v = Math.PI * a * b * e.height;
        vCol += v;
        fCol += Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b))) * e.height;
        tCol.add(v, e, e.levelId);
      } else if (e.kind === "beam") {
        const v = e.length * e.width * e.height;
        vBeam += v;
        fBeam += e.length * e.width + 2 * e.length * e.height;
        tBeam.add(v, e, e.levelId);
      }
    }
  }
  // Baldrame / fundação CONCEITUAL: eixos das paredes do pavimento mais baixo (exceto drywall e vidro).
  if (ctx.project.levels.length > 0) {
    const ground = ctx.project.levels.reduce((a, b) => (b.elevation < a.elevation ? b : a));
    for (const w of ctx.walls) {
      if (w.levelId !== ground.id || w.core === "drywall" || isGlass(w)) continue;
      const L = wallLength(w);
      const v = L * st.foundation.widthM * st.foundation.heightM;
      vFound += v;
      foundLen += L;
      fFound += 2 * L * st.foundation.heightM;
      tFound.add(v, w, w.levelId);
    }
  }

  const overrideConcrete = ov.concreteM3 !== undefined;
  const sk = st.steelKgPerM3;
  const structSteelModeled = vSlab * sk.slab + vBeam * sk.beam + vCol * sk.column + vFound * sk.foundation;
  const structSteelNet = ov.steelKg ?? structSteelModeled;
  const steelNet = structSteelNet + wallConcreteVol * sk.wall + lintelVol * sk.lintel;
  const structFormModeled = fSlab + fCol + fBeam + fFound;
  const formNet = (ov.formworkM2 ?? structFormModeled) + wallConcreteForm;
  const cl = st.concreteLossPercent;
  const mixC = mixOf.concreto.name;

  if (overrideConcrete) {
    if ((ov.concreteM3 ?? 0) > 0) {
      push(S["EST-CONCRETO-ENG"], ov.concreteM3!, NO_SRC, `Volume líquido informado pelo engenheiro (structuralOverride.concreteM3) — substitui lajes, pilares, vigas e fundação modelados; sem elementos de origem no modelo.`, "servico");
      uses.push({ label: "estrutura (volume informado pelo engenheiro)", kind: "concrete", mixName: mixC, mix: mixOf.concreto.mix, volume: ov.concreteM3! * (1 + cl / 100), ids: [], levelId: null });
    }
    warnings.push("structuralOverride.concreteM3 informado: o concreto de lajes, pilares, vigas e fundação modelados NÃO gera insumos; em takeoffComplete, LAJE-CONCRETO e EST-CONCRETO do takeoff são removidos para não duplicar.");
  } else {
    if (tFound.any) {
      push(
        S["EST-FUNDACAO"],
        vFound,
        tFound,
        `CONCEITUAL — substituir pelo dimensionamento do engenheiro: Σ comprimento dos eixos das paredes do pavimento mais baixo (${fmt(foundLen)} m; ${tFound.text("m³")}) × seção ${cm(st.foundation.widthM)}×${cm(st.foundation.heightM)} cm = ${fmt(vFound)} m³. Não considera sapatas, estacas nem cintas.`,
        "servico",
      );
      warnings.push("Baldrame/fundação CONCEITUAL (perímetro dos eixos × seção padrão): não é dimensionamento; substitua pelos volumes do engenheiro (structuralOverride).");
    }
    addUse("lajes", "concrete", "concreto", vSlab, cl, tSlab);
    addUse("pilares", "concrete", "concreto", vCol, cl, tCol);
    addUse("vigas", "concrete", "concreto", vBeam, cl, tBeam);
    addUse("baldrame/fundação conceitual", "concrete", "concreto", vFound, cl, tFound);
  }
  if (tWallC.any) {
    push(S["EST-CONCRETO-PAREDE"], wallConcreteVol, tWallC, `Σ área líquida × espessura das paredes de concreto (${tWallC.text("m³")}); a área em m² é ALV-CONCRETO (takeoff).`, "informativo", { optional: true });
    addUse("paredes de concreto", "concrete", "concreto", wallConcreteVol, cl, tWallC);
  }
  if (lintelVol > 0) addUse("vergas e contravergas", "concrete", "concreto", lintelVol, cl, merge(tVerga, tContra));

  // ---------------- Insumos consolidados (cimento, cal, areia, brita) ----------------
  const per = uses.map((u) => ({ u, m: mixMaterials(u.volume, u.mix, u.mixName, p.materials) }));
  const sum = (f: (m: MixMaterials) => number): number => per.reduce((s, x) => s + f(x.m), 0);
  const useIds: Src = {
    idList: () => [...new Set(uses.flatMap((u) => u.ids))],
    levelId: () => {
      const ls = new Set(uses.map((u) => u.levelId));
      return ls.size === 1 ? ([...ls][0] ?? null) : null;
    },
  };
  const concreteTotal = uses.filter((u) => u.kind === "concrete").reduce((s, u) => s + u.volume, 0);
  if (concreteTotal > 0) {
    push(
      S["EST-CONCRETO-TOTAL"],
      concreteTotal,
      { idList: () => [...new Set(uses.filter((u) => u.kind === "concrete").flatMap((u) => u.ids))], levelId: () => null },
      `Σ concreto: ${uses.filter((u) => u.kind === "concrete").map((u) => `${u.label} ${fmt(u.volume / (1 + cl / 100))} m³`).join(" + ")} = ${fmt(concreteTotal / (1 + cl / 100))} m³ × (1 + ${fmt(cl, 2)}% de perda); traço ${mixC}. Lajes (LAJE-CONCRETO) e pilares/vigas (EST-CONCRETO) permanecem no takeoff.`,
      "informativo",
      { optional: true },
    );
  }
  const cementKg = sum((m) => m.cementKg);
  if (cementKg > 0) {
    const bag = p.materials.cementBagKg;
    const bags = ceilN(cementKg / bag);
    push(
      S["MAT-CIMENTO"],
      bags,
      useIds,
      `${per.map(({ u, m }) => `${u.label}: ${fmt(u.volume)} m³ × ${fmt(m.cementKgPerM3, 1)} kg/m³ (traço ${u.mixName}) = ${fmt(m.cementKg, 1)} kg`).join("; ")}. Σ = ${fmt(cementKg, 1)} kg ÷ ${fmt(bag)} kg/saco, arredondado para cima. Água ≈ ${fmt(sum((m) => m.waterL), 0)} L (x·C). Traços e resistências são referências editáveis: validar com o engenheiro responsável.`,
      "insumo",
      { details: { cementKg, bagKg: bag, bags, waterL: sum((m) => m.waterL) } },
    );
  }
  const limeKg = sum((m) => m.limeKg);
  if (limeKg > 0) {
    const bag = p.materials.limeBagKg;
    push(S["MAT-CAL"], ceilN(limeKg / bag), useIds, `Σ cal = traço (cal por 1 de cimento) × cimento: ${per.filter(({ m }) => m.limeKg > 0).map(({ u, m }) => `${u.label} ${fmt(m.limeKg, 1)} kg`).join("; ")}. Σ = ${fmt(limeKg, 1)} kg ÷ ${fmt(bag)} kg/saco, arredondado para cima.`, "insumo", { details: { limeKg, bagKg: bag } });
  }
  const sandM3 = sum((m) => m.sandM3);
  if (sandM3 > 0) {
    push(S["MAT-AREIA"], sandM3, useIds, `Σ areia seca (${fmt(sum((m) => m.sandKg), 1)} kg = a·C·V) ÷ ${fmt(p.materials.sandBulkDensity)} kg/m³ (massa unitária) × inchamento ${fmt(p.materials.sandSwelling)} (areia úmida).`, "insumo", { details: { sandKg: sum((m) => m.sandKg) } });
  }
  const gravelM3 = sum((m) => m.gravelM3);
  if (gravelM3 > 0) {
    push(S["MAT-BRITA"], gravelM3, useIds, `Σ brita (${fmt(sum((m) => m.gravelKg), 1)} kg = p·C·V) ÷ ${fmt(p.materials.gravelBulkDensity)} kg/m³ (massa unitária).`, "insumo", { details: { gravelKg: sum((m) => m.gravelKg) } });
  }
  if (uses.length > 0) warnings.push("Traços, fator água/cimento, resistências e dosagens são parâmetros de referência editáveis, não normativos: devem ser validados pelo engenheiro responsável.");

  if (steelNet > 0) {
    push(
      S["MAT-ACO"],
      steelNet * (1 + st.steelLossPercent / 100),
      merge(tSlab, tCol, tBeam, tFound, tWallC, tVerga, tContra),
      `${ov.steelKg !== undefined ? `Aço informado pelo engenheiro (${fmt(ov.steelKg)} kg líquidos)` : `Σ volume × taxa [kg/m³]: lajes ${fmt(vSlab)}×${sk.slab}, vigas ${fmt(vBeam)}×${sk.beam}, pilares ${fmt(vCol)}×${sk.column}, fundação ${fmt(vFound)}×${sk.foundation}`} + paredes de concreto ${fmt(wallConcreteVol)}×${sk.wall} + vergas ${fmt(lintelVol)}×${sk.lintel} = ${fmt(steelNet, 1)} kg × (1 + ${fmt(st.steelLossPercent, 2)}% de perda). Taxas de referência editáveis; bitolas NÃO detalhadas.`,
      "insumo",
    );
  }
  if (formNet > 0) {
    push(
      S["EST-FORMA"],
      formNet,
      merge(tSlab, tCol, tBeam, tFound, tWallC),
      `${ov.formworkM2 !== undefined ? `Fôrma informada pelo engenheiro (${fmt(ov.formworkM2)} m²)` : `Σ áreas de contato: lajes (fundo + bordas) ${fmt(fSlab)} + pilares (perímetro × altura) ${fmt(fCol)} + vigas (fundo + 2 laterais) ${fmt(fBeam)} + baldrame (2 laterais) ${fmt(fFound)}`} + paredes de concreto (2 faces) ${fmt(wallConcreteForm)} = ${fmt(formNet)} m².`,
      "insumo",
    );
  }

  // ---------------- Cobertura ----------------
  const rf = p.roof;
  const tTiles = T();
  const tRidgeTiles = T();
  const tHip = T();
  const tGutter = T();
  const tFlash = T();
  const tStruct = T();
  let tilesRaw = 0;
  let ridgeTilesRaw = 0;
  let hipLen = 0;
  let gutterLen = 0;
  let flashLen = 0;
  let structArea = 0;
  const unknownCover = new Set<string>();
  const flatTile: string[] = [];
  for (const r of ctx.project.elements) {
    if (r.type !== "roof") continue;
    const g = roofGeometry(r);
    const cover = rf.coverings[r.materialId];
    const L = r.width + 2 * r.overhang;
    const D = r.depth + 2 * r.overhang;
    const cos = Math.cos((r.pitch * Math.PI) / 180);
    let hips = 0;
    let eaves = 0;
    let rakes = 0;
    switch (r.roofType) {
      case "hip": {
        const alongX = L >= D;
        const rr = Math.abs(L - D) / 2;
        const dx = alongX ? L / 2 - rr : L / 2;
        const dy = alongX ? D / 2 : D / 2 - rr;
        hips = 4 * Math.sqrt(dx * dx + dy * dy + g.rise * g.rise);
        eaves = 2 * (L + D);
        break;
      }
      case "gable":
        eaves = 2 * L;
        rakes = (2 * D) / cos;
        break;
      case "shed":
        eaves = L;
        rakes = L + (2 * D) / cos;
        break;
      case "flat":
        break;
    }
    if (!cover) unknownCover.add(r.materialId);
    else if (cover.kind === "telha") {
      if (r.roofType === "flat") flatTile.push(r.name);
      else {
        tilesRaw += g.area * cover.unitsPerM2;
        tTiles.add(g.area, r, r.levelId);
        const ridgeLen = g.ridge + hips;
        ridgeTilesRaw += ridgeLen * rf.ridgeTilesPerM;
        tRidgeTiles.add(ridgeLen, r, r.levelId);
      }
    }
    if (hips > 0) {
      hipLen += hips;
      tHip.add(hips, r, r.levelId);
    }
    if (eaves > 0) {
      gutterLen += eaves;
      tGutter.add(eaves, r, r.levelId);
    }
    if (rakes > 0) {
      flashLen += rakes;
      tFlash.add(rakes, r, r.levelId);
    }
    if (r.roofType !== "flat") {
      structArea += g.area;
      tStruct.add(g.area, r, r.levelId);
    }
  }
  if (unknownCover.size > 0) warnings.push(`Cobertura sem parâmetro de telhas por m² (${[...unknownCover].join(", ")}): quantidade de telhas não levantada (m² segue em COB-*).`);
  if (flatTile.length > 0) warnings.push(`Telhado plano com telha cerâmica (${flatTile.join(", ")}): telhas não contabilizadas; considerar laje impermeabilizada.`);
  if (tTiles.any) {
    const covLoss = 1 + rf.tileLossPercent / 100;
    push(S["MAT-TELHA-CERAMICA"], ceilN(tilesRaw * covLoss), tTiles, `Σ área inclinada da cobertura (${tTiles.text("m²")}) × unidades/m² do material (parâmetro roof.coverings) = ${fmt(tilesRaw)} un × (1 + ${fmt(rf.tileLossPercent, 2)}% de perda), arredondado para cima. Telhas em chapa (metálica/fibrocimento) são medidas em m² por COB-* (takeoff).`, "insumo");
    push(S["MAT-TELHA-CUMEEIRA"], ceilN(ridgeTilesRaw * covLoss), tRidgeTiles, `Σ (cumeeira + espigões) = ${fmt(tRidgeTiles.total)} m × ${fmt(rf.ridgeTilesPerM)} un/m × (1 + ${fmt(rf.tileLossPercent, 2)}% de perda). O comprimento de cumeeira é COB-CUMEEIRA (takeoff).`, "insumo");
  }
  if (tHip.any) push(S["COB-ESPIGAO"], hipLen, tHip, `Σ 4 espigões × √(Δx² + Δy² + elevação²), do canto do beiral até a ponta da cumeeira (${tHip.text("m")}); geometria indicativa.`, "servico");
  if (tGutter.any) push(S["COB-CALHA"], gutterLen, tGutter, `Σ comprimento de beirais (caimento): gable 2 × L, shed 1 × L, hip perímetro 2·(L+D); L, D incluem os beirais (${tGutter.text("m")}). Apenas linear: o dimensionamento de calhas é de outro módulo.`, "servico");
  if (tFlash.any) push(S["COB-RUFO"], flashLen, tFlash, `Σ empenas inclinadas (gable: 2·D÷cos; shed: 2·D÷cos + encontro alto L) (${tFlash.text("m")}). Apenas linear, sem dimensionar.`, "servico");
  if (tStruct.any) {
    push(S["COB-ESTRUTURA"], structArea, tStruct, `Σ área inclinada da cobertura (${tStruct.text("m²")}). Madeiramento/estrutura metálica NÃO dimensionados: a dimensionar por profissional habilitado.`, "servico");
    warnings.push(`Estrutura do telhado (a dimensionar): ${fmt(structArea)} m² de cobertura inclinada sem madeiramento/estrutura metálica dimensionado.`);
  }

  // ---------------- Avisos gerais ----------------
  warnings.push("Instalações elétricas, hidráulicas e de gás não modeladas: orçar à parte.");

  return { lines, warnings };
}

// ============================================================================
// Merge sem dupla contagem
// ============================================================================

const detailOf = (l: QuantityLine, key: string): number => (l as Partial<ConstructionLine>).details?.[key] ?? 0;

/**
 * `takeoff()` + `constructionTakeoff()` num só resultado (ver tabela de propriedade no
 * cabeçalho). Aplica apenas os ajustes explícitos documentados lá; códigos são únicos.
 */
export function takeoffComplete(project: Project, takeoffParams: Partial<TakeoffParams> = {}, constructionParams: ConstructionParamsInput = {}): TakeoffResult {
  const t = takeoff(project, takeoffParams);
  const c = constructionTakeoff(project, constructionParams);
  let tl: QuantityLine[] = t.lines;

  if (c.lines.some((l) => l.code === "EST-CONCRETO-ENG")) tl = tl.filter((l) => l.code !== "LAJE-CONCRETO" && l.code !== "EST-CONCRETO");
  else if (resolveConstructionParams(constructionParams).structuralOverride.concreteM3 === 0) tl = tl.filter((l) => l.code !== "LAJE-CONCRETO" && l.code !== "EST-CONCRETO");

  const deduct = c.lines.reduce((s, l) => s + detailOf(l, "paintDeductM2"), 0);
  if (deduct > 0) {
    const paint = tl.find((l) => l.code === "PINT-PAREDE");
    if (paint && paint.quantity > 0) {
      const newQ = Math.max(0, paint.quantity - deduct);
      const k = newQ / paint.quantity;
      const note = ` − ${fmt(deduct)} m² de paredes azulejadas/texturizadas (descontado por takeoffComplete; REVEST-CERAMICO-PAREDE / PINT-EXT-TEXTURA)`;
      tl = tl
        .map((l) => {
          if (l.code === "PINT-PAREDE") return { ...l, quantity: round3(newQ), basis: `${l.basis}${note}` };
          if (l.code === "PINT-TINTA") return { ...l, quantity: round3(l.quantity * k), basis: `${l.basis}; escalonado por ${fmt(k, 4)} (área de pintura reduzida em ${fmt(deduct)} m²)` };
          return l;
        })
        .filter((l) => (l.code === "PINT-PAREDE" || l.code === "PINT-TINTA" ? l.quantity > 0 : true));
    }
  }

  const seen = new Set<string>();
  const warnings: string[] = [];
  const lines: QuantityLine[] = [];
  for (const l of [...tl, ...c.lines]) {
    if (seen.has(l.code)) {
      warnings.push(`Código ${l.code} duplicado entre takeoff e construção; mantida a primeira ocorrência.`);
      continue;
    }
    seen.add(l.code);
    lines.push(l);
  }
  for (const w of [...t.warnings, ...c.warnings]) if (!warnings.includes(w)) warnings.push(w);
  return { lines, warnings };
}

// ============================================================================
// Resumo "Quantidade de materiais"
// ============================================================================

export interface MaterialSummaryItem {
  key: string;
  label: string;
  unit: string;
  quantity: number;
  /** Segunda unidade (ex.: cimento em kg além dos sacos). */
  alt?: { unit: string; quantity: number };
  basis: string;
  elementIds: string[];
  codes: string[];
}

const SUMMARY_ROWS: Array<{ key: string; label: string; unit: string; codes: string[]; alt?: { unit: string; detail: string } }> = [
  { key: "bloco-ceramico", label: "Blocos cerâmicos", unit: "un", codes: ["MAT-BLOCO-CERAMICO"] },
  { key: "bloco-concreto", label: "Blocos de concreto", unit: "un", codes: ["MAT-BLOCO-CONCRETO"] },
  { key: "cimento", label: "Cimento (sacos de 50 kg)", unit: "sc", codes: ["MAT-CIMENTO"], alt: { unit: "kg", detail: "cementKg" } },
  { key: "cal", label: "Cal hidratada (sacos)", unit: "sc", codes: ["MAT-CAL"], alt: { unit: "kg", detail: "limeKg" } },
  { key: "areia", label: "Areia", unit: "m³", codes: ["MAT-AREIA"] },
  { key: "brita", label: "Brita", unit: "m³", codes: ["MAT-BRITA"] },
  { key: "aco", label: "Aço (sem bitolas)", unit: "kg", codes: ["MAT-ACO"] },
  { key: "forma", label: "Fôrma", unit: "m²", codes: ["EST-FORMA"] },
  { key: "arg-colante", label: "Argamassa colante", unit: "kg", codes: ["MAT-ARG-COLANTE"] },
  { key: "rejunte", label: "Rejunte", unit: "kg", codes: ["MAT-REJUNTE"] },
  { key: "drywall-chapa", label: "Chapas de drywall", unit: "m²", codes: ["MAT-DRYWALL-CHAPA"] },
  { key: "drywall-perfil", label: "Perfis de drywall (montantes e guias)", unit: "m", codes: ["MAT-DRYWALL-MONTANTE", "MAT-DRYWALL-GUIA"] },
  { key: "selador", label: "Selador", unit: "L", codes: ["PINT-INT-SELADOR", "PINT-EXT-SELADOR"] },
  { key: "massa", label: "Massa corrida / acrílica", unit: "kg", codes: ["PINT-INT-MASSA", "PINT-EXT-MASSA"] },
  { key: "textura", label: "Textura de fachada", unit: "kg", codes: ["PINT-EXT-TEXTURA"] },
  { key: "tinta-paredes", label: "Tinta de paredes", unit: "L", codes: ["PINT-TINTA"] },
  { key: "tinta-forro", label: "Tinta de forro", unit: "L", codes: ["PINT-FORRO-TINTA"] },
  { key: "telhas", label: "Telhas cerâmicas", unit: "un", codes: ["MAT-TELHA-CERAMICA"] },
  { key: "telhas-cumeeira", label: "Telhas de cumeeira/espigão", unit: "un", codes: ["MAT-TELHA-CUMEEIRA"] },
  { key: "telhas-chapa", label: "Telhas em chapa (metálica/fibrocimento)", unit: "m²", codes: ["COB-ROOF-METAL", "COB-ROOF-FIBER-CEMENT"] },
];

/** Lista consolidada de materiais para a tabela "Quantidade de materiais" (aceita takeoffComplete ou constructionTakeoff). */
export function materialSummary(result: Pick<TakeoffResult, "lines">): MaterialSummaryItem[] {
  const out: MaterialSummaryItem[] = [];
  for (const row of SUMMARY_ROWS) {
    const ls = result.lines.filter((l) => row.codes.includes(l.code) && l.unit === row.unit);
    if (ls.length === 0) continue;
    const quantity = round3(ls.reduce((s, l) => s + l.quantity, 0));
    if (!(quantity > 0)) continue;
    const item: MaterialSummaryItem = {
      key: row.key,
      label: row.label,
      unit: row.unit,
      quantity,
      basis: ls.length === 1 ? ls[0]!.basis : ls.map((l) => `${l.code}: ${l.basis}`).join(" | "),
      elementIds: [...new Set(ls.flatMap((l) => l.elementIds))],
      codes: ls.map((l) => l.code),
    };
    if (row.alt) item.alt = { unit: row.alt.unit, quantity: round3(ls.reduce((s, l) => s + detailOf(l, row.alt!.detail), 0)) };
    out.push(item);
  }
  return out;
}
