import type { BuildingObject, Door, Element, Floor, Opening, Project, ProjectCategory, Wall, Window } from "./schema";
import { ProjectSchema, isWall } from "./schema";
import type { LibrarySpec } from "../library/catalog";
import { createId } from "./ids";
import { DomainError } from "./errors";
import { clampOpeningOffset, wallLength } from "../geometry/wall";
import { distance, type Vec2 } from "../geometry/vec";

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
}

export function createWall(elements: readonly Element[], start: Vec2, end: Vec2, opts: WallOptions): Wall {
  if (distance(start, end) < MIN_WALL_LENGTH) {
    throw new DomainError(`A parede precisa ter ao menos ${MIN_WALL_LENGTH * 100} cm de comprimento.`);
  }
  return {
    id: createId(),
    type: "wall",
    name: nextName(elements, "Parede"),
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
  opts: { thickness: number; materialId: string; elevation?: number },
): Floor {
  const width = Math.abs(b.x - a.x);
  const depth = Math.abs(b.y - a.y);
  if (width < 0.05 || depth < 0.05) throw new DomainError("O piso precisa ter ao menos 5 cm em cada direção.");
  return {
    id: createId(),
    type: "floor",
    name: nextName(elements, "Piso"),
    position: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: opts.elevation ?? 0 },
    width,
    depth,
    thickness: opts.thickness,
    rotation: 0,
    materialId: opts.materialId,
  };
}

type ObjectSpec = Extract<LibrarySpec, { elementType: "object" }>;

export function createObject(elements: readonly Element[], spec: ObjectSpec, name: string, at: Vec2): BuildingObject {
  return {
    id: createId(),
    type: "object",
    kind: spec.kind,
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
