import type { Project, RoomType } from "../core/model/schema";
import { createObject, createProject, createRoof, createRoomWithWalls, GROUND_LEVEL_ID } from "../core/model/factory";
import { addElements } from "../core/model/operations";
import { getLibraryItem } from "../core/library/catalog";

/** Utilitários APENAS para testes do módulo de engenharia. */
export function emptyProject(): Project {
  return createProject({ name: "Teste", category: "residencial", site: { width: 30, depth: 30 }, defaultWallHeight: 3.0, defaultWallThickness: 0.15 });
}

export function withRoom(p: Project, a: [number, number], b: [number, number], type: RoomType, levelId = GROUND_LEVEL_ID, thickness = 0.15): Project {
  const { walls, room } = createRoomWithWalls(p.elements, { x: a[0], y: a[1] }, { x: b[0], y: b[1] }, type, { height: 3.0, thickness, materialId: "paint-white", levelId, core: "ceramic-brick" });
  return addElements(p, [...walls, room]);
}

export function withFlatRoof(p: Project, a: [number, number], b: [number, number], levelId = GROUND_LEVEL_ID): Project {
  return addElements(p, [createRoof(p.elements, { x: a[0], y: a[1] }, { x: b[0], y: b[1] }, { levelId, baseHeight: 3.0, roofType: "flat", pitch: 0, overhang: 0.3, materialId: "concrete" })]);
}

export function withObject(p: Project, itemId: string, x: number, y: number, levelId = GROUND_LEVEL_ID): Project {
  const item = getLibraryItem(itemId);
  if (!item || item.spec.elementType !== "object") throw new Error(`item ${itemId}`);
  return addElements(p, [createObject(p.elements, item.spec, item.name, { x, y }, levelId)]);
}

/** Casa retangular 10 × 4 m com 2 ambientes (quarto 5 × 4 e sala 5 × 4) e laje plana de cobertura. */
export function simpleHouse(): Project {
  let p = emptyProject();
  p = withRoom(p, [0, 0], [5, 4], "quarto");
  p = withRoom(p, [5, 0], [10, 4], "sala");
  return withFlatRoof(p, [0, 0], [10, 4]);
}

/** Percorre recursivamente e devolve true se todo número é finito. */
export function allFinite(v: unknown): boolean {
  if (typeof v === "number") return Number.isFinite(v);
  if (Array.isArray(v)) return v.every(allFinite);
  if (v && typeof v === "object") return Object.values(v).every(allFinite);
  return true;
}
