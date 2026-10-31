import type { BuildingObject, Door, Element, Floor, Level, Opening, Project, ProjectCategory, Roof, RoofType, Room, RoomType, Wall, WallCore, Window } from "./schema";
import { ProjectSchema, isWall } from "./schema";
import type { LibrarySpec } from "../library/catalog";
import { createId } from "./ids";
import { DomainError } from "./errors";
import { clampOpeningOffset, wallLength } from "../geometry/wall";
import { distance, type Vec2 } from "../geometry/vec";
import { uncoveredSegments } from "../geometry/rooms";

/** Id do pavimento térreo criado com todo projeto novo. */
export const GROUND_LEVEL_ID = "terreo";

/** Menor comprimento de parede aceito (m). */
export const MIN_WALL_LENGTH = 0.05;

export interface NewProjectInput {
  name: string;
  category: ProjectCategory;
  description?: string;
  site: { width: number; depth: number };
  defaultWallHeight?: number;
  defaultWallThickness?: number;
  now?: Date;
}

export function createProject(input: NewProjectInput): Project {
  const now = (input.now ?? new Date()).toISOString();
  const project: Project = {
    id: createId(),
    name: input.name.trim(),
    description: input.description?.trim() ?? "",
    category: input.category,
    status: "em-andamento",
    favorite: false,
    createdAt: now,
    updatedAt: now,
    site: { ...input.site },
    settings: {
      displayUnit: "m",
      gridSize: 0.1,
      snapToGrid: true,
      defaultWallHeight: input.defaultWallHeight ?? 2.8,
      defaultWallThickness: input.defaultWallThickness ?? 0.15,
    },
    levels: [{ id: GROUND_LEVEL_ID, name: "Térreo", elevation: 0, height: (input.defaultWallHeight ?? 2.8) + 0.2 }],
    elements: [],
  };
  const parsed = ProjectSchema.safeParse(project);
  if (!parsed.success) throw new DomainError(parsed.error.issues[0]?.message ?? "Projeto inválido.");
  return parsed.data;
}

/** Próximo nome sequencial livre: "Parede 1", "Parede 2"... */
export function nextName(elements: readonly Element[], prefix: string): string {
  const used = new Set(elements.map((e) => e.name));
  let n = elements.filter((e) => e.name.startsWith(prefix)).length + 1;
  while (used.has(`${prefix} ${n}`)) n++;
  return `${prefix} ${n}`;
}

export interface WallOptions {
  height: number;
  thickness: number;
  materialId: string;
  baseElevation?: number;
  levelId?: string;
  core?: WallCore;
}

const defaultCore = (materialId: string): WallCore => (materialId === "gypsum" ? "drywall" : materialId.startsWith("concrete") ? "concrete" : "ceramic-brick");

/** Novo pavimento acima do mais alto existente. */
export function createLevel(levels: readonly Level[], name?: string): Level {
  const top = levels.reduce((a, b) => (b.elevation > a.elevation ? b : a), levels[0]!);
  const n = levels.length;
  return { id: createId(), name: name ?? (n === 1 ? "Pavimento superior" : `Pavimento ${n + 1}`), elevation: Math.round((top.elevation + top.height) * 1000) / 1000, height: top.height };
}

export function createWall(elements: readonly Element[], start: Vec2, end: Vec2, opts: WallOptions): Wall {
  if (distance(start, end) < MIN_WALL_LENGTH) {
    throw new DomainError(`A parede precisa ter ao menos ${MIN_WALL_LENGTH * 100} cm de comprimento.`);
  }
  return {
    id: createId(),
    type: "wall",
    name: nextName(elements, "Parede"),
    levelId: opts.levelId ?? GROUND_LEVEL_ID,
    core: opts.core ?? defaultCore(opts.materialId),
    start: { ...start },
    end: { ...end },
    baseElevation: opts.baseElevation ?? 0,
    height: opts.height,
    thickness: opts.thickness,
    materialId: opts.materialId,
  };
}

/**
 * Quatro paredes formando um ambiente retangular entre os cantos `a` e `b`
 * (eixos das paredes nos limites do retângulo), em sentido anti-horário.
 */
export function createRoomWalls(elements: readonly Element[], a: Vec2, b: Vec2, opts: WallOptions): Wall[] {
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  if (maxX - minX < opts.thickness * 2 || maxY - minY < opts.thickness * 2) {
    throw new DomainError("O ambiente é pequeno demais para a espessura de parede escolhida.");
  }
  const corners: Vec2[] = [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];
  const walls: Wall[] = [];
  for (let i = 0; i < 4; i++) {
    walls.push(createWall([...elements, ...walls], corners[i]!, corners[(i + 1) % 4]!, opts));
  }
  return walls;
}

type OpeningSpec = Extract<LibrarySpec, { elementType: "door" | "window" }>;

/** Cria porta/janela hospedada na parede, centralizada o mais perto possível de `desiredOffset`. */
export function createOpening(
  elements: readonly Element[],
  wall: Wall,
  spec: OpeningSpec,
  desiredOffset: number,
): Opening {
  const offset = clampOpeningOffset(wallLength(wall), spec.width, desiredOffset);
  if (offset === null) {
    throw new DomainError(`A abertura (${spec.width.toFixed(2)} m) não cabe na parede "${wall.name}".`);
  }
  const sill = spec.elementType === "window" ? spec.sillHeight : 0;
  if (sill + spec.height > wall.height) {
    throw new DomainError(`A abertura é mais alta que a parede "${wall.name}".`);
  }
  if (spec.elementType === "door") {
    const door: Door = {
      id: createId(),
      type: "door",
      name: nextName(elements, "Porta"),
      hostId: wall.id,
      offset,
      width: spec.width,
      height: spec.height,
      hinge: "left",
      opensTo: "left",
      style: spec.style ?? "swing",
      materialId: spec.materialId,
    };
    return door;
  }
  const win: Window = {
    id: createId(),
    type: "window",
    name: nextName(elements, "Janela"),
    hostId: wall.id,
    offset,
    width: spec.width,
    height: spec.height,
    sillHeight: spec.sillHeight,
    materialId: spec.materialId,
  };
  return win;
}

export function createFloor(
  elements: readonly Element[],
  a: Vec2,
  b: Vec2,
  opts: { thickness: number; materialId: string; elevation?: number; levelId?: string },
): Floor {
  const width = Math.abs(b.x - a.x);
  const depth = Math.abs(b.y - a.y);
  if (width < 0.05 || depth < 0.05) throw new DomainError("O piso precisa ter ao menos 5 cm em cada direção.");
  return {
    id: createId(),
    type: "floor",
    name: nextName(elements, "Piso"),
    levelId: opts.levelId ?? GROUND_LEVEL_ID,
    position: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: opts.elevation ?? 0 },
    width,
    depth,
    thickness: opts.thickness,
    rotation: 0,
    materialId: opts.materialId,
  };
}

type ObjectSpec = Extract<LibrarySpec, { elementType: "object" }>;

export function createObject(elements: readonly Element[], spec: ObjectSpec, name: string, at: Vec2, levelId: string = GROUND_LEVEL_ID): BuildingObject {
  return {
    id: createId(),
    type: "object",
    kind: spec.kind,
    levelId,
    name: nextName(elements, name),
    position: { x: at.x, y: at.y, z: spec.elevation ?? 0 },
    rotation: 0,
    length: spec.length,
    width: spec.width,
    height: spec.height,
    materialId: spec.materialId,
  };
}

export const findWall = (elements: readonly Element[], id: string): Wall | undefined =>
  elements.find((e): e is Wall => isWall(e) && e.id === id);

export const ROOM_TYPE_INFO: Record<RoomType, { label: string; floor: string; color: string }> = {
  sala: { label: "Sala", floor: "porcelain-tile", color: "#3b6fb6" },
  cozinha: { label: "Cozinha", floor: "porcelain-tile", color: "#c98a2b" },
  quarto: { label: "Quarto", floor: "wood-oak", color: "#7a5bc0" },
  suite: { label: "Suíte", floor: "wood-oak", color: "#9b59b6" },
  banheiro: { label: "Banheiro", floor: "ceramic-floor", color: "#2a9d8f" },
  lavabo: { label: "Lavabo", floor: "ceramic-floor", color: "#2a9d8f" },
  garagem: { label: "Garagem", floor: "concrete-polished", color: "#6c7584" },
  gourmet: { label: "Área gourmet", floor: "ceramic-floor", color: "#d9643a" },
  lavanderia: { label: "Lavanderia", floor: "ceramic-floor", color: "#4b9cd3" },
  escritorio: { label: "Escritório", floor: "wood-oak", color: "#5b8c5a" },
  circulacao: { label: "Circulação", floor: "porcelain-tile", color: "#8d97a6" },
  varanda: { label: "Varanda", floor: "deck-wood", color: "#b08c5a" },
  outro: { label: "Ambiente", floor: "porcelain-tile", color: "#8d97a6" },
};

export function createRoom(elements: readonly Element[], seed: Vec2, roomType: RoomType, levelId: string = GROUND_LEVEL_ID, ceilingHeight = 2.7): Room {
  const info = ROOM_TYPE_INFO[roomType];
  return {
    id: createId(),
    type: "room",
    name: nextName(elements, info.label),
    levelId,
    roomType,
    seed: { ...seed },
    materialId: info.floor,
    ceiling: roomType !== "varanda" && roomType !== "gourmet",
    ceilingHeight,
    ceilingMaterialId: "gypsum",
  };
}

/**
 * Cômodo retangular entre `a` e `b`: cria só as paredes que ainda não existem
 * (lados encostados em cômodos vizinhos reaproveitam a parede existente) e o ambiente.
 */
export function createRoomWithWalls(
  elements: readonly Element[],
  a: Vec2,
  b: Vec2,
  roomType: RoomType,
  opts: WallOptions & { levelId: string },
): { walls: Wall[]; room: Room } {
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  if (maxX - minX < 0.6 || maxY - minY < 0.6) throw new DomainError("O cômodo precisa ter ao menos 60 cm em cada direção.");
  const corners: Vec2[] = [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];
  const existing = elements.filter((e): e is Wall => e.type === "wall" && e.levelId === opts.levelId);
  const walls: Wall[] = [];
  for (let i = 0; i < 4; i++) {
    for (const [s, e] of uncoveredSegments(corners[i]!, corners[(i + 1) % 4]!, existing)) {
      walls.push(createWall([...elements, ...walls], s, e, opts));
    }
  }
  const room = createRoom([...elements, ...walls], { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }, roomType, opts.levelId, Math.min(opts.height, 2.7));
  return { walls, room };
}

export function createRoof(
  elements: readonly Element[],
  a: Vec2,
  b: Vec2,
  opts: { levelId: string; baseHeight: number; roofType?: RoofType; pitch?: number; overhang?: number; materialId?: string },
): Roof {
  const width = Math.abs(b.x - a.x);
  const depth = Math.abs(b.y - a.y);
  if (width < 0.5 || depth < 0.5) throw new DomainError("O telhado precisa ter ao menos 50 cm em cada direção.");
  return {
    id: createId(),
    type: "roof",
    name: nextName(elements, "Telhado"),
    levelId: opts.levelId,
    roofType: opts.roofType ?? "hip",
    position: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    width,
    depth,
    rotation: 0,
    pitch: opts.pitch ?? 20,
    overhang: opts.overhang ?? 0.5,
    baseHeight: opts.baseHeight,
    thickness: 0.12,
    materialId: opts.materialId ?? "roof-tile-ceramic",
  };
}
