import { z } from "zod";
import { LENGTH_UNITS } from "../units/units";

// Mensagens de validação em português.
z.config(z.locales.ptBR());

/**
 * Esquemas do modelo de projeto.
 *
 * Os schemas Zod são a FONTE ÚNICA de verdade: deles derivam os tipos
 * TypeScript, a validação de importação/persistência e as checagens das
 * operações de edição. Todas as medidas estão em metros; ângulos em graus.
 */

const finite = z.number().finite();
const positive = finite.positive();
const nonNegative = finite.nonnegative();

export const Vec2Schema = z.object({ x: finite, y: finite });
export const Vec3Schema = z.object({ x: finite, y: finite, z: finite });

export const PROJECT_CATEGORIES = [
  "residencial",
  "comercial",
  "predial",
  "interiores",
  "moveis",
  "marmoraria",
  "vidracaria",
  "engenharia",
  "especiais",
] as const;
export const ProjectCategorySchema = z.enum(PROJECT_CATEGORIES);
export type ProjectCategory = z.infer<typeof ProjectCategorySchema>;

export const PROJECT_STATUSES = ["em-andamento", "concluido", "arquivado"] as const;
export const ProjectStatusSchema = z.enum(PROJECT_STATUSES);
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;

/** Tipos de objetos paramétricos da biblioteca (renderizados proceduralmente). */
export const OBJECT_KINDS = [
  "column-rect",
  "column-round",
  "beam",
  "stair-straight",
  "table",
  "chair",
  "sofa",
  "bed",
  "countertop",
  "cabinet-base",
  "cabinet-wall",
  "wardrobe",
  "toilet",
  "washbasin",
  "shower",
  "kitchen-island",
  "sink-cabinet",
  "cooktop",
  "oven-tower",
  "fridge",
  "tv-rack",
  "tv",
  "tv-panel",
  "nightstand",
  "desk",
  "bath-vanity",
  "pool",
  "tree",
  "shrub",
  "grill",
  "car",
] as const;
export const ObjectKindSchema = z.enum(OBJECT_KINDS);
export type ObjectKind = z.infer<typeof ObjectKindSchema>;

const baseElement = {
  id: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  materialId: z.string().min(1),
};

/** Elementos posicionados num pavimento: cotas Z são RELATIVAS à elevação do pavimento. */
const onLevel = { levelId: z.string().min(1) };

/** Pavimento (nível). `elevation` é a cota absoluta do piso acabado. */
export const LevelSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(60),
  elevation: finite,
  /** Altura de piso a piso (m). */
  height: positive,
});
export type Level = z.infer<typeof LevelSchema>;

/** Núcleo construtivo da parede (alvenaria/vedação) — o acabamento é `materialId`. */
export const WALL_CORES = ["ceramic-brick", "concrete-block", "concrete", "drywall"] as const;
export const WallCoreSchema = z.enum(WALL_CORES);
export type WallCore = z.infer<typeof WallCoreSchema>;

/** Parede reta definida pelo eixo (start → end) no plano XY. */
export const WallSchema = z.object({
  ...baseElement,
  ...onLevel,
  type: z.literal("wall"),
  core: WallCoreSchema,
  start: Vec2Schema,
  end: Vec2Schema,
  /** Cota da base da parede (Z), relativa ao pavimento. */
  baseElevation: finite,
  height: positive,
  thickness: positive,
});

/**
 * Aberturas (portas/janelas) são HOSPEDADAS por uma parede.
 * `offset` = distância do início da parede até o CENTRO da abertura, ao longo do eixo.
 */
const openingBase = {
  ...baseElement,
  hostId: z.string().min(1),
  offset: nonNegative,
  width: positive,
  height: positive,
};

export const DOOR_STYLES = ["swing", "sliding", "opening"] as const;

export const DoorSchema = z.object({
  ...openingBase,
  type: z.literal("door"),
  /** Giro, correr ou vão livre (passagem sem folha, que conecta ambientes). */
  style: z.enum(DOOR_STYLES),
  /** Lado da dobradiça, olhando a partir do início da parede. */
  hinge: z.enum(["left", "right"]),
  /** Para qual face da parede a folha abre. */
  opensTo: z.enum(["left", "right"]),
});

export const WindowSchema = z.object({
  ...openingBase,
  type: z.literal("window"),
  /** Altura do peitoril a partir da base da parede. */
  sillHeight: nonNegative,
});

/** Laje/piso retangular. `position` = centro; `position.z` = cota SUPERIOR. */
export const FloorSchema = z.object({
  ...baseElement,
  ...onLevel,
  type: z.literal("floor"),
  position: Vec3Schema,
  width: positive,
  depth: positive,
  thickness: positive,
  rotation: finite,
});

/** Objeto paramétrico. `position` = centro da projeção; `position.z` = cota da base. */
export const ObjectSchema = z.object({
  ...baseElement,
  ...onLevel,
  type: z.literal("object"),
  kind: ObjectKindSchema,
  position: Vec3Schema,
  rotation: finite,
  /** Dimensão ao longo do eixo X local. */
  length: positive,
  /** Dimensão ao longo do eixo Y local. */
  width: positive,
  height: positive,
});

export const ROOM_TYPES = [
  "sala",
  "cozinha",
  "quarto",
  "suite",
  "banheiro",
  "lavabo",
  "garagem",
  "gourmet",
  "lavanderia",
  "escritorio",
  "circulacao",
  "varanda",
  "outro",
] as const;
export const RoomTypeSchema = z.enum(ROOM_TYPES);
export type RoomType = z.infer<typeof RoomTypeSchema>;

/**
 * Ambiente (cômodo). NÃO guarda contorno próprio: o contorno é DERIVADO das
 * paredes do pavimento a partir do ponto `seed` (como "Room" em ferramentas BIM).
 * Assim, mover uma parede atualiza automaticamente todos os ambientes vizinhos.
 * `materialId` = acabamento de piso.
 */
export const RoomSchema = z.object({
  ...baseElement,
  ...onLevel,
  type: z.literal("room"),
  roomType: RoomTypeSchema,
  seed: Vec2Schema,
  ceiling: z.boolean(),
  ceilingHeight: positive,
  ceilingMaterialId: z.string().min(1),
});

export const ROOF_TYPES = ["gable", "hip", "shed", "flat"] as const;
export const RoofTypeSchema = z.enum(ROOF_TYPES);

/** Telhado paramétrico sobre um retângulo (centro, largura X, profundidade Y). */
export const RoofSchema = z.object({
  ...baseElement,
  ...onLevel,
  type: z.literal("roof"),
  roofType: RoofTypeSchema,
  position: Vec2Schema,
  width: positive,
  depth: positive,
  rotation: finite,
  /** Inclinação em graus (ignorada para laje plana). */
  pitch: finite.min(0).max(60),
  overhang: nonNegative,
  /** Cota do beiral relativa ao pavimento. */
  baseHeight: finite,
  thickness: positive,
});

export const ElementSchema = z.discriminatedUnion("type", [
  WallSchema,
  RoomSchema,
  RoofSchema,
  DoorSchema,
  WindowSchema,
  FloorSchema,
  ObjectSchema,
]);

export const ProjectSettingsSchema = z.object({
  displayUnit: z.enum(LENGTH_UNITS as unknown as ["m", "cm", "mm"]),
  gridSize: positive.max(10),
  snapToGrid: z.boolean(),
  defaultWallHeight: positive,
  defaultWallThickness: positive,
});

export const ProjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1, "O projeto precisa de um nome.").max(120),
  description: z.string().max(2000),
  category: ProjectCategorySchema,
  status: ProjectStatusSchema,
  favorite: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  /** Dimensões do terreno/área de trabalho (m). */
  site: z.object({ width: positive, depth: positive }),
  settings: ProjectSettingsSchema,
  levels: z.array(LevelSchema).min(1, "O projeto precisa de ao menos um pavimento."),
  elements: z.array(ElementSchema),
});

export type Wall = z.infer<typeof WallSchema>;
export type Door = z.infer<typeof DoorSchema>;
export type Window = z.infer<typeof WindowSchema>;
export type Opening = Door | Window;
export type Floor = z.infer<typeof FloorSchema>;
export type BuildingObject = z.infer<typeof ObjectSchema>;
export type Room = z.infer<typeof RoomSchema>;
export type Roof = z.infer<typeof RoofSchema>;
export type RoofType = z.infer<typeof RoofTypeSchema>;
export type Element = z.infer<typeof ElementSchema>;
export type ElementType = Element["type"];
export type ProjectSettings = z.infer<typeof ProjectSettingsSchema>;
export type Project = z.infer<typeof ProjectSchema>;

export const isWall = (e: Element): e is Wall => e.type === "wall";
export const isOpening = (e: Element): e is Opening => e.type === "door" || e.type === "window";
export const isFloor = (e: Element): e is Floor => e.type === "floor";
export const isObject = (e: Element): e is BuildingObject => e.type === "object";
export const isRoom = (e: Element): e is Room => e.type === "room";
export const isRoof = (e: Element): e is Roof => e.type === "roof";

/** Pavimento do elemento (aberturas herdam o da parede hospedeira). */
export function elementLevelId(e: Element, elements: readonly Element[]): string | null {
  if (e.type === "door" || e.type === "window") {
    const host = elements.find((h) => h.id === e.hostId);
    return host && host.type === "wall" ? host.levelId : null;
  }
  return e.levelId;
}

export const ELEMENT_TYPE_LABEL: Record<ElementType, string> = {
  wall: "Parede",
  door: "Porta",
  window: "Janela",
  floor: "Piso / Laje",
  object: "Objeto",
  room: "Ambiente",
  roof: "Telhado",
};
