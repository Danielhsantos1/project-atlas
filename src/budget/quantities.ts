import { z } from "zod";
import type { BuildingObject, Element, Floor, Project, Roof, Room, Wall } from "@/core/model/schema";
import { isOpening, isWall } from "@/core/model/schema";
import { getMaterial } from "@/core/model/materials";
import { levelWalls } from "@/core/model/operations";
import { DomainError } from "@/core/model/errors";
import { validateOpening, wallQuantities } from "@/core/geometry/wall";
import { roomShape } from "@/core/geometry/rooms";
import { roofGeometry } from "@/core/geometry/roof";
import { floorArea, floorVolume } from "@/core/geometry/shapes";
import type { BudgetCategory } from "./categories";
import {
  EQUIPMENT_KINDS,
  FIXTURE_KINDS,
  LOOSE_KINDS,
  PLANNED_FURNITURE_KINDS,
  STATIC_SERVICES,
  WALL_CORE_SERVICE,
  ceilingService,
  countertopService,
  equipmentService,
  fixtureService,
  floorFinishService,
  looseItemService,
  openingService,
  passageService,
  plannedFurnitureService,
  roofCoverService,
  structureService,
  type ServiceDefinition,
  type ServiceUnit,
} from "./services";

/**
 * Levantamento de quantitativos (takeoff) a partir da geometria do modelo.
 * TODAS as quantidades vêm das funções do núcleo geométrico (wallQuantities,
 * roomShape, roofGeometry, floorArea/floorVolume); nada é estimado "por fora".
 */

export interface QuantityLine {
  code: string;
  description: string;
  unit: ServiceUnit;
  /** Quantidade arredondada a 3 casas decimais. */
  quantity: number;
  category: BudgetCategory;
  /** Elementos do modelo que originaram a quantidade. */
  elementIds: string[];
  /** Fórmula legível (memória de cálculo). */
  basis: string;
  /** Pavimento, quando todos os elementos estão no mesmo; null = vários. */
  levelId?: string | null;
  /** Item opcional (equipamentos, mobiliário solto): fora do orçamento por padrão. */
  optional?: boolean;
}

export interface TakeoffResult {
  lines: QuantityLine[];
  warnings: string[];
}

/**
 * Parâmetros do levantamento. Os valores padrão são PARÂMETROS DE REFERÊNCIA
 * EDITÁVEIS, NÃO NORMATIVOS — devem ser ajustados pelo profissional responsável
 * conforme o material, o fabricante e o método executivo.
 */
export const TakeoffParamsSchema = z.object({
  /** Perda de piso em % (recortes/quebras). Padrão 10 — referência editável, não normativa. */
  floorLossPercent: z.number().finite().min(0).max(100),
  /** Número de demãos de tinta. Padrão 2 — referência editável, não normativa. */
  paintCoats: z.number().int().min(1).max(10),
  /** Rendimento da tinta em m² por litro por demão. Padrão 10 — referência editável, não normativa. */
  paintYieldM2PerLiterPerCoat: z.number().finite().positive(),
  /** Inclui mobiliário solto/itens avulsos como linhas opcionais. Padrão false. */
  includeLooseFurniture: z.boolean(),
});
export type TakeoffParams = z.infer<typeof TakeoffParamsSchema>;

export const DEFAULT_TAKEOFF_PARAMS: TakeoffParams = {
  floorLossPercent: 10,
  paintCoats: 2,
  paintYieldM2PerLiterPerCoat: 10,
  includeLooseFurniture: false,
};

/** Acabamentos de parede que NÃO recebem pintura (aparentes/revestidos/sem pintura). */
export const UNPAINTED_WALL_MATERIALS: readonly string[] = ["brick", "ceramic-tile-wall", "plaster-raw", "ceramic-brick", "concrete-block", "mortar"];
/** Acabamentos aparentes que dispensam reboco. */
export const UNPLASTERED_WALL_MATERIALS: readonly string[] = ["brick"];
const PAINTABLE_GROUPS: readonly string[] = ["Tinta", "Alvenaria", "Acabamento"];
/** Espessura mínima (m) para um piso de concreto ser tratado como laje estrutural. */
export const SLAB_MIN_THICKNESS = 0.08;

export const round3 = (n: number): number => Math.round(n * 1000) / 1000;
const fmt = (n: number, dp = 3): string => round3(n).toLocaleString("pt-BR", { maximumFractionDigits: dp });

interface Acc {
  def: ServiceDefinition;
  raw: number;
  ids: string[];
  levels: Set<string | null>;
  parts: Map<string, number>;
  factor: number;
  factorLabel: string | null;
  optional: boolean;
  basisOverride: ((raw: number) => string) | null;
}

class Accumulator {
  private map = new Map<string, Acc>();

  add(
    def: ServiceDefinition,
    value: number,
    el: { id: string } | readonly { id: string }[],
    levelId: string | null,
    part: string,
    opts: { factor?: number; factorLabel?: string; optional?: boolean; basis?: (raw: number) => string } = {},
  ): void {
    let acc = this.map.get(def.code);
    if (!acc) {
      acc = {
        def,
        raw: 0,
        ids: [],
        levels: new Set(),
        parts: new Map(),
        factor: opts.factor ?? 1,
        factorLabel: opts.factorLabel ?? null,
        optional: opts.optional ?? false,
        basisOverride: opts.basis ?? null,
      };
      this.map.set(def.code, acc);
    }
    acc.raw += value;
    for (const e of Array.isArray(el) ? el : [el as { id: string }]) if (!acc.ids.includes(e.id)) acc.ids.push(e.id);
    acc.levels.add(levelId);
    acc.parts.set(part, (acc.parts.get(part) ?? 0) + value);
  }

  lines(): QuantityLine[] {
    return [...this.map.values()].map((a) => {
      const unit = a.def.unit;
      const partsText = [...a.parts.entries()].map(([label, v]) => `${label} (${fmt(v)} ${unit})`).join(" + ");
      const basis = a.basisOverride
        ? a.basisOverride(a.raw)
        : a.factorLabel
          ? `[${partsText}] ${a.factorLabel}`
          : partsText;
      const levels = [...a.levels];
      const line: QuantityLine = {
        code: a.def.code,
        description: a.def.description,
        unit,
        quantity: round3(a.raw * a.factor),
        category: a.def.category,
        elementIds: a.ids,
        basis,
        levelId: levels.length === 1 ? (levels[0] ?? null) : null,
      };
      if (a.optional) line.optional = true;
      return line;
    });
  }
}

export function takeoff(project: Project, params: Partial<TakeoffParams> = {}): TakeoffResult {
  const parsed = TakeoffParamsSchema.safeParse({ ...DEFAULT_TAKEOFF_PARAMS, ...params });
  if (!parsed.success) throw new DomainError(`Parâmetros de levantamento inválidos: ${parsed.error.issues[0]?.message ?? ""}`);
  const p = parsed.data;
  const warnings: string[] = [];
  const acc = new Accumulator();
  const elements = project.elements;
  const openings = elements.filter(isOpening);
  const wallById = new Map(elements.filter(isWall).map((w) => [w.id, w]));

  // ---------- Paredes ----------
  let paintArea = 0;
  const paintIds: Element[] = [];
  const paintLevels = new Set<string | null>();
  for (const wall of wallById.values()) {
    const hosted = openings.filter((o) => o.hostId === wall.id);
    const q = wallQuantities(wall, hosted);
    acc.add(STATIC_SERVICES[WALL_CORE_SERVICE[wall.core]], q.netArea, wall, wall.levelId, "Σ área líquida 1 face (comprimento pelo eixo × altura - aberturas)");
    if (wall.core !== "drywall" && !UNPLASTERED_WALL_MATERIALS.includes(wall.materialId)) {
      acc.add(STATIC_SERVICES["REVEST-REBOCO"], 2 * q.netArea, wall, wall.levelId, "Σ área líquida 1 face × 2 faces");
    }
    if (isPaintable(wall)) {
      acc.add(STATIC_SERVICES["PINT-PAREDE"], 2 * q.netArea, wall, wall.levelId, "Σ área líquida 1 face × 2 faces");
      paintArea += 2 * q.netArea;
      paintIds.push(wall);
      paintLevels.add(wall.levelId);
    }
  }
  if (paintArea > 0) {
    const liters = (paintArea * p.paintCoats) / p.paintYieldM2PerLiterPerCoat;
    acc.add(STATIC_SERVICES["PINT-TINTA"], liters, paintIds, paintLevels.size === 1 ? [...paintLevels][0]! : null, "tinta", {
      basis: () =>
        `área de pintura (${fmt(paintArea)} m²) × ${p.paintCoats} demãos ÷ rendimento ${fmt(p.paintYieldM2PerLiterPerCoat)} m²/L por demão (parâmetros de referência editáveis)`,
    });
  }

  // ---------- Ambientes ----------
  const rooms = elements.filter((e): e is Room => e.type === "room");
  if (rooms.length === 0) warnings.push("O projeto não possui ambientes: pisos e forros não foram levantados.");
  const lossFactor = 1 + p.floorLossPercent / 100;
  const lossLabel = `× (1 + ${fmt(p.floorLossPercent, 2)}% de perda)`;
  for (const room of rooms) {
    const shape = roomShape(levelWalls(project, room.levelId), room.seed);
    if (!shape) {
      warnings.push(`Ambiente "${room.name}" não está fechado por paredes; área não computada.`);
      continue;
    }
    acc.add(floorFinishService(room.materialId), shape.area, room, room.levelId, "Σ área útil dos ambientes (descontada meia espessura das paredes)", {
      factor: lossFactor,
      factorLabel: lossLabel,
    });
    if (room.ceiling) {
      acc.add(ceilingService(room.ceilingMaterialId), shape.area, room, room.levelId, "Σ área útil dos ambientes com forro");
    }
    const roomWalls = new Set(shape.wallIds);
    // Qualquer porta (inclusive vão livre) dá acesso ao ambiente.
    if (!openings.some((o) => o.type === "door" && roomWalls.has(o.hostId))) {
      warnings.push(`Ambiente "${room.name}" não possui porta em nenhuma de suas paredes.`);
    }
  }

  // ---------- Pisos e lajes ----------
  for (const f of elements.filter((e): e is Floor => e.type === "floor")) {
    if (f.materialId.startsWith("concrete") && f.thickness >= SLAB_MIN_THICKNESS) {
      acc.add(STATIC_SERVICES["LAJE-CONCRETO"], floorVolume(f), f, f.levelId, "Σ largura × profundidade × espessura das lajes");
    } else if (f.materialId === "grass") {
      acc.add(STATIC_SERVICES["PAISAGISMO-GRAMA"], floorArea(f), f, f.levelId, "Σ largura × profundidade das áreas de grama");
    } else {
      acc.add(floorFinishService(f.materialId), floorArea(f), f, f.levelId, "Σ largura × profundidade dos pisos", { factor: lossFactor, factorLabel: lossLabel });
    }
  }

  // ---------- Aberturas ----------
  for (const o of openings) {
    const host = wallById.get(o.hostId);
    if (!host) {
      warnings.push(`Abertura "${o.name}" sem parede hospedeira válida; não computada.`);
      continue;
    }
    for (const issue of validateOpening(host, o, openings)) {
      warnings.push(`Abertura "${o.name}" (parede "${host.name}"): ${issue.message}`);
    }
    if (o.type === "door" && o.style === "opening") {
      // Vão livre: sem esquadria/folha (a área já é descontada da parede); listado em "servicos" para acabamento do vão.
      acc.add(passageService(o.width, o.height), 1, o, host.levelId, "contagem de vãos livres da mesma dimensão");
      continue;
    }
    const style = o.type === "door" && o.style === "sliding" ? "sliding" : "swing";
    acc.add(openingService(o.type, o.width, o.height, o.materialId, style), 1, o, host.levelId, "contagem de aberturas do mesmo tipo, dimensão e material");
  }

  // ---------- Telhados ----------
  for (const r of elements.filter((e): e is Roof => e.type === "roof")) {
    const g = roofGeometry(r);
    acc.add(roofCoverService(r.materialId), g.area, r, r.levelId, "Σ área inclinada da cobertura (projeção com beirais ÷ cos da inclinação)");
    if (g.ridge > 0) acc.add(STATIC_SERVICES["COB-CUMEEIRA"], g.ridge, r, r.levelId, "Σ comprimento de cumeeira");
  }
  if (elements.length > 0 && project.levels.length > 0) {
    const top = project.levels.reduce((a, b) => (b.elevation > a.elevation ? b : a));
    if (!elements.some((e) => e.type === "roof" && e.levelId === top.id)) {
      warnings.push(`O pavimento mais alto ("${top.name}") não possui telhado/cobertura.`);
    }
  }

  // ---------- Objetos ----------
  let hasStair = false;
  for (const o of elements.filter((e): e is BuildingObject => e.type === "object")) {
    addObject(acc, o, p);
    if (o.kind === "stair-straight") hasStair = true;
  }
  if (hasStair) warnings.push("Escadas são contadas apenas como unidade: devem ser detalhadas e orçadas por profissional habilitado.");

  return { lines: acc.lines(), warnings };
}

function isPaintable(wall: Wall): boolean {
  if (UNPAINTED_WALL_MATERIALS.includes(wall.materialId)) return false;
  return PAINTABLE_GROUPS.includes(getMaterial(wall.materialId).group);
}

const includes = <T extends string>(list: readonly T[], v: string): v is T => (list as readonly string[]).includes(v);

/** Coping (borda) da piscina — mesma fórmula de `objectParts` (core/geometry/objects.ts). */
export const poolCoping = (length: number, width: number): number => Math.min(0.3, length / 6, width / 6);

function addObject(acc: Accumulator, o: BuildingObject, p: TakeoffParams): void {
  const lvl = o.levelId;
  switch (o.kind) {
    case "column-rect":
    case "beam":
      acc.add(structureService(o.materialId), o.length * o.width * o.height, o, lvl, "Σ comprimento × largura × altura (pilares retangulares e vigas)");
      return;
    case "column-round":
      acc.add(structureService(o.materialId), Math.PI * (o.length / 2) * (o.width / 2) * o.height, o, lvl, "Σ π × (D1/2) × (D2/2) × altura (pilares circulares)");
      return;
    case "countertop":
      acc.add(countertopService(o.materialId), o.length * o.width, o, lvl, "Σ comprimento × largura dos tampos");
      return;
    case "pool": {
      const c = poolCoping(o.length, o.width);
      acc.add(STATIC_SERVICES.PISCINA, (o.length - 2 * c) * (o.width - 2 * c), o, lvl, "Σ (comprimento - 2 × borda) × (largura - 2 × borda), borda = mín(0,30; C/6; L/6)");
      acc.add(STATIC_SERVICES["PISCINA-UN"], 1, o, lvl, "contagem de piscinas");
      return;
    }
    case "tree":
      acc.add(STATIC_SERVICES["PAISAGISMO-ARVORE"], 1, o, lvl, "contagem de árvores");
      return;
    case "shrub":
      acc.add(STATIC_SERVICES["PAISAGISMO-ARBUSTO"], 1, o, lvl, "contagem de arbustos");
      return;
    case "grill":
      acc.add(STATIC_SERVICES.CHURRASQUEIRA, 1, o, lvl, "contagem de churrasqueiras");
      return;
    case "stair-straight":
      acc.add(STATIC_SERVICES["ESCADA-RETA"], 1, o, lvl, "contagem de escadas");
      return;
  }
  if (includes(PLANNED_FURNITURE_KINDS, o.kind)) {
    acc.add(plannedFurnitureService(o.kind), 1, o, lvl, "contagem de móveis planejados");
  } else if (includes(FIXTURE_KINDS, o.kind)) {
    acc.add(fixtureService(o.kind), 1, o, lvl, "contagem de louças/metais");
  } else if (includes(EQUIPMENT_KINDS, o.kind)) {
    acc.add(equipmentService(o.kind), 1, o, lvl, "contagem de equipamentos", { optional: true });
  } else if (includes(LOOSE_KINDS, o.kind)) {
    if (p.includeLooseFurniture) acc.add(looseItemService(o.kind), 1, o, lvl, "contagem de itens avulsos", { optional: true });
  }
}
