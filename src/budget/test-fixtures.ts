/** Projeto de referência para os testes do módulo de orçamento. */
import { createFloor, createObject, createOpening, createProject, createRoof, createRoomWithWalls } from "@/core/model/factory";
import { addElements } from "@/core/model/operations";
import type { ObjectKind, Project, Wall } from "@/core/model/schema";

export const WALL_OPTS = { height: 2.8, thickness: 0.2, materialId: "plaster-white", levelId: "terreo" } as const;

export function obj(p: Project, kind: ObjectKind, dims: { length: number; width: number; height: number }, materialId: string, at = { x: 20, y: 20 }) {
  return createObject(p.elements, { elementType: "object", kind, ...dims, materialId }, kind, at);
}

/**
 * Sala (0,0)-(4,3) + Quarto (4,0)-(7,3) compartilhando a parede x = 4.
 * Porta 80x210 na parede compartilhada; janela 120x120 na parede inferior da sala.
 * Laje 7x3x0,12, grama 10x5, telhado de duas águas, pilares, armários, bancada, piscina, árvore, geladeira, sofá.
 */
export function buildReferenceProject(): { project: Project; shared: Wall } {
  let p = createProject({ name: "Casa Teste", category: "residencial", site: { width: 30, depth: 30 }, now: new Date("2026-01-10T12:00:00Z") });
  const a = createRoomWithWalls(p.elements, { x: 0, y: 0 }, { x: 4, y: 3 }, "sala", { ...WALL_OPTS });
  p = addElements(p, [...a.walls, a.room]);
  const b = createRoomWithWalls(p.elements, { x: 4, y: 0 }, { x: 7, y: 3 }, "quarto", { ...WALL_OPTS });
  p = addElements(p, [...b.walls, b.room]);
  const shared = a.walls.find((w) => w.start.x === 4 && w.end.x === 4)!;
  const bottomA = a.walls.find((w) => w.start.y === 0 && w.end.y === 0)!;
  p = addElements(p, [createOpening(p.elements, shared, { elementType: "door", width: 0.8, height: 2.1, materialId: "wood-oak" }, 1.5)]);
  p = addElements(p, [createOpening(p.elements, bottomA, { elementType: "window", width: 1.2, height: 1.2, sillHeight: 1.0, materialId: "aluminum" }, 2)]);
  p = addElements(p, [createFloor(p.elements, { x: 0, y: 0 }, { x: 7, y: 3 }, { thickness: 0.12, materialId: "concrete" })]);
  p = addElements(p, [createFloor(p.elements, { x: 0, y: 4 }, { x: 10, y: 9 }, { thickness: 0.02, materialId: "grass" })]);
  p = addElements(p, [createRoof(p.elements, { x: 0, y: 0 }, { x: 7, y: 3 }, { levelId: "terreo", baseHeight: 2.8, roofType: "gable", pitch: 30, overhang: 0.5 })]);
  p = addElements(p, [obj(p, "column-rect", { length: 0.2, width: 0.4, height: 2.8 }, "concrete")]);
  p = addElements(p, [obj(p, "column-round", { length: 0.3, width: 0.3, height: 2.8 }, "concrete")]);
  p = addElements(p, [obj(p, "cabinet-base", { length: 0.8, width: 0.55, height: 0.85 }, "mdf-white")]);
  p = addElements(p, [obj(p, "cabinet-base", { length: 0.8, width: 0.55, height: 0.85 }, "mdf-white")]);
  p = addElements(p, [obj(p, "countertop", { length: 2.4, width: 0.6, height: 0.9 }, "granite-black")]);
  p = addElements(p, [obj(p, "pool", { length: 8, width: 4, height: 0.3 }, "water")]);
  p = addElements(p, [obj(p, "tree", { length: 2, width: 2, height: 4 }, "foliage")]);
  p = addElements(p, [obj(p, "fridge", { length: 0.7, width: 0.7, height: 1.8 }, "steel-inox")]);
  p = addElements(p, [obj(p, "sofa", { length: 2, width: 0.9, height: 0.8 }, "fabric-gray")]);
  return { project: p, shared };
}
