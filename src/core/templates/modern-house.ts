import type { Element, Project, RoomType, Wall, WallCore } from "../model/schema";
import { createFloor, createLevel, createObject, createOpening, createProject, createRoof, createRoomWithWalls, createWall, GROUND_LEVEL_ID } from "../model/factory";
import { addElements, addLevel, updateElement } from "../model/operations";
import { getLibraryItem, type LibrarySpec } from "../library/catalog";
import { projectOnSegment, type Vec2 } from "../geometry/vec";
import { DomainError } from "../model/errors";

/**
 * Modelo demonstrativo: RESIDÊNCIA MODERNA DE DOIS PAVIMENTOS.
 * Construído inteiramente com a fábrica de elementos — tudo é editável.
 * Dimensões em metros. Frente da casa voltada para o sul (Y menor = rua).
 *
 *  Térreo:   garagem 2 carros, sala + cozinha com ilha (integradas por vão livre),
 *            banheiro, lavanderia, escritório, escada, área gourmet coberta.
 *  Superior: suíte + banheiro da suíte, 2 quartos, banheiro social, circulação
 *            com guarda-corpo de vidro em torno do vão da escada.
 *  Externo:  jardim, calçadas, piscina com deck, árvores, muros de divisa.
 */
export function buildModernHouse(now = new Date()): Project {
  let p = createProject({
    name: "Residência Moderna — 2 pavimentos",
    category: "residencial",
    description: "Modelo demonstrativo do PROJECT ATLAS. Geometria indicativa, sem aprovação técnica.",
    site: { width: 20, depth: 35 },
    defaultWallHeight: 3.0,
    defaultWallThickness: 0.18,
    now,
  });
  const upper = createLevel(p.levels, "Pavimento superior");
  p = addLevel(p, upper);
  const T = GROUND_LEVEL_ID;
  const U = upper.id;

  const wallOpts = (levelId: string, height: number): { height: number; thickness: number; materialId: string; levelId: string; core: WallCore } => ({ height, thickness: 0.18, materialId: "paint-white", levelId, core: "ceramic-brick" });
  const add = (els: Element[]) => {
    p = addElements(p, els);
  };
  const room = (levelId: string, a: Vec2, b: Vec2, type: RoomType, name: string, height: number, patch: Record<string, unknown> = {}) => {
    const { walls, room: r } = createRoomWithWalls(p.elements, a, b, type, wallOpts(levelId, height));
    add([...walls, { ...r, name, ...patch } as Element]);
  };
  const wall = (levelId: string, a: Vec2, b: Vec2, opts: Partial<ReturnType<typeof wallOpts>> & { height: number }) => {
    add([createWall(p.elements, a, b, { ...wallOpts(levelId, opts.height), ...opts })]);
  };
  const wallAt = (levelId: string, at: Vec2): Wall => {
    const w = p.elements.find((e): e is Wall => e.type === "wall" && e.levelId === levelId && projectOnSegment(at, e.start, e.end).distance < 1e-3);
    if (!w) throw new DomainError(`Modelo: nenhuma parede em (${at.x}; ${at.y}).`);
    return w;
  };
  const opening = (levelId: string, at: Vec2, itemId: string, override: Partial<Extract<LibrarySpec, { elementType: "door" | "window" }>> = {}) => {
    const item = getLibraryItem(itemId);
    if (!item || (item.spec.elementType !== "door" && item.spec.elementType !== "window")) throw new DomainError(`Item ${itemId} inválido.`);
    const host = wallAt(levelId, at);
    const spec = { ...item.spec, ...override } as Extract<LibrarySpec, { elementType: "door" | "window" }>;
    add([createOpening(p.elements, host, spec, projectOnSegment(at, host.start, host.end).along)]);
  };
  const obj = (levelId: string, itemId: string, x: number, y: number, rotation = 0, override: Record<string, unknown> = {}) => {
    const item = getLibraryItem(itemId);
    if (!item || item.spec.elementType !== "object") throw new DomainError(`Item ${itemId} inválido.`);
    const o = createObject(p.elements, { ...item.spec, ...override } as Extract<LibrarySpec, { elementType: "object" }>, item.name, { x, y }, levelId);
    add([{ ...o, rotation }]);
  };
  const floor = (levelId: string, a: Vec2, b: Vec2, materialId: string, thickness: number, z = 0) => {
    add([createFloor(p.elements, a, b, { materialId, thickness, elevation: z, levelId })]);
  };

  // ---------------- Térreo (paredes 3,00 m) ----------------
  const H0 = 3.0;
  room(T, { x: 3, y: 8 }, { x: 9, y: 14 }, "garagem", "Garagem", H0);
  room(T, { x: 9, y: 8 }, { x: 17, y: 14 }, "sala", "Sala de estar", H0);
  room(T, { x: 9, y: 14 }, { x: 17, y: 20 }, "cozinha", "Cozinha", H0, { ceiling: false });
  room(T, { x: 3, y: 14 }, { x: 6, y: 17 }, "banheiro", "Banheiro social", H0);
  room(T, { x: 6, y: 14 }, { x: 9, y: 17 }, "lavanderia", "Lavanderia", H0);
  room(T, { x: 3, y: 17 }, { x: 9, y: 20 }, "escritorio", "Escritório", H0);
  room(T, { x: 9, y: 20 }, { x: 17, y: 24 }, "gourmet", "Área gourmet", H0);

  opening(T, { x: 6, y: 8 }, "door-garage");
  opening(T, { x: 10.2, y: 8 }, "door-90", { materialId: "wood-walnut", height: 2.4 });
  opening(T, { x: 14.4, y: 8 }, "window-200x220", { width: 3.6, height: 2.4 });
  opening(T, { x: 17, y: 11 }, "window-150x120");
  opening(T, { x: 17, y: 16.2 }, "window-120x120", { sillHeight: 1.1, height: 1.0 });
  opening(T, { x: 13, y: 14 }, "passage-300", { width: 5.0, height: 2.6 });
  opening(T, { x: 10.4, y: 20 }, "door-sliding-200");
  opening(T, { x: 7.5, y: 14 }, "door-80");
  opening(T, { x: 9, y: 15.5 }, "door-80");
  opening(T, { x: 6, y: 15.5 }, "door-70");
  opening(T, { x: 9, y: 18.6 }, "door-80");
  opening(T, { x: 3, y: 15.5 }, "window-60x60");
  opening(T, { x: 3, y: 18.5 }, "window-150x120");
  opening(T, { x: 9, y: 22 }, "passage-300", { width: 2.6, height: 2.6 });
  opening(T, { x: 13, y: 24 }, "passage-300", { width: 3.2, height: 2.6 });
  opening(T, { x: 17, y: 22 }, "window-150x120");

  // Escada: sobe para oeste ao longo da parede norte da cozinha (altura = piso a piso).
  obj(T, "stair-straight", 13.8, 19.35, 180, { height: 3.2, length: 4.2, width: 1.0 });

  // Mobiliário do térreo
  obj(T, "car", 4.6, 11.1, 90);
  obj(T, "car", 7.4, 11.1, 90);
  obj(T, "tv-panel", 9.15, 11, 90);
  obj(T, "tv-rack", 9.4, 11, 90);
  obj(T, "tv", 9.45, 11, 90);
  obj(T, "sofa-3", 12.4, 11, 270);
  obj(T, "kitchen-island", 13, 16.5, 0);
  obj(T, "cooktop", 13, 16.5, 0, { elevation: 0.92 });
  obj(T, "sink-cabinet", 16.6, 16.2, 90);
  obj(T, "fridge", 16.55, 17.6, 90);
  obj(T, "table-6", 10.9, 16.6, 90);
  obj(T, "toilet", 3.45, 16.4, 270);
  obj(T, "bath-vanity", 4.5, 14.35, 180);
  obj(T, "cabinet-base", 8.6, 16.4, 90);
  obj(T, "desk", 6, 19.55, 180);
  obj(T, "grill", 16.3, 23.5, 180);
  obj(T, "table-6", 12.6, 22, 0);
  obj(T, "chair", 11.9, 21.3, 180);
  obj(T, "chair", 13.3, 21.3, 180);

  // ---------------- Pavimento superior (paredes 2,80 m) ----------------
  const H1 = 2.8;
  // Laje com vão para a escada (x 11,7–15,9; y 18,8–20).
  floor(U, { x: 3, y: 8 }, { x: 17, y: 18.8 }, "concrete", 0.12);
  floor(U, { x: 3, y: 18.8 }, { x: 11.7, y: 20 }, "concrete", 0.12);
  floor(U, { x: 15.9, y: 18.8 }, { x: 17, y: 20 }, "concrete", 0.12);

  room(U, { x: 3, y: 8 }, { x: 9, y: 14 }, "suite", "Suíte", H1);
  room(U, { x: 3, y: 14 }, { x: 6, y: 17 }, "banheiro", "Banheiro da suíte", H1);
  room(U, { x: 3, y: 17 }, { x: 6, y: 20 }, "banheiro", "Banheiro (superior)", H1);
  room(U, { x: 9, y: 8 }, { x: 13, y: 13 }, "quarto", "Quarto 2", H1);
  room(U, { x: 13, y: 8 }, { x: 17, y: 13 }, "quarto", "Quarto 3", H1);
  wall(U, { x: 6, y: 20 }, { x: 17, y: 20 }, { height: H1 });
  wall(U, { x: 17, y: 13 }, { x: 17, y: 20 }, { height: H1 });
  // Guarda-corpo de vidro em volta do vão da escada; passagem no topo da escada.
  const rail = { height: 1.1, thickness: 0.06, materialId: "glass-clear", core: "concrete" as const };
  wall(U, { x: 11.7, y: 18.8 }, { x: 15.9, y: 18.8 }, rail);
  wall(U, { x: 15.9, y: 18.8 }, { x: 15.9, y: 20 }, rail);
  wall(U, { x: 11.7, y: 18.8 }, { x: 11.7, y: 20 }, rail);
  // Vão com a altura total do guarda-corpo (sem verga): nada acima da cabeça ao chegar.
  opening(U, { x: 11.7, y: 19.35 }, "passage-120", { width: 1.0, height: 1.1 });
  const circ = createRoomWithWalls([], { x: 0, y: 0 }, { x: 1, y: 1 }, "circulacao", wallOpts(U, H1)).room;
  add([{ ...circ, name: "Circulação", seed: { x: 10, y: 16 }, levelId: U }]);

  opening(U, { x: 6, y: 8 }, "window-200x220", { width: 3.0, height: 2.2 });
  opening(U, { x: 7.5, y: 14 }, "door-80");
  opening(U, { x: 4.5, y: 14 }, "door-70");
  opening(U, { x: 6, y: 18.5 }, "door-70");
  opening(U, { x: 12.2, y: 13 }, "door-80");
  opening(U, { x: 13.8, y: 13 }, "door-80");
  opening(U, { x: 11, y: 8 }, "window-150x120");
  opening(U, { x: 15, y: 8 }, "window-150x120");
  opening(U, { x: 17, y: 10.5 }, "window-120x120");
  opening(U, { x: 3, y: 15.5 }, "window-60x60");
  opening(U, { x: 3, y: 18.5 }, "window-60x60");
  opening(U, { x: 8, y: 20 }, "window-120x120");

  obj(U, "bed-queen", 6, 12.9, 0);
  obj(U, "nightstand", 4.8, 13.55, 0);
  obj(U, "nightstand", 7.2, 13.55, 0);
  obj(U, "wardrobe", 3.42, 10, 90);
  obj(U, "bath-vanity", 5.6, 15.5, 90);
  obj(U, "toilet", 3.45, 16.4, 270);
  obj(U, "shower", 3.6, 14.65, 0, { length: 0.9, width: 0.9 });
  obj(U, "bath-vanity", 5.6, 19.3, 90);
  obj(U, "toilet", 3.45, 19.4, 270);
  obj(U, "bed-queen", 11, 11.9, 0);
  obj(U, "desk", 10.2, 8.45, 0);
  obj(U, "bed-queen", 15, 11.9, 0);
  obj(U, "wardrobe", 16.6, 9.6, 90);

  // ---------------- Coberturas ----------------
  add([createRoof(p.elements, { x: 3, y: 8 }, { x: 17, y: 20 }, { levelId: U, baseHeight: H1, roofType: "shed", pitch: 8, overhang: 0.6, materialId: "roof-metal" })]);
  add([createRoof(p.elements, { x: 9, y: 20 }, { x: 17, y: 24 }, { levelId: T, baseHeight: H0, roofType: "flat", pitch: 0, overhang: 0.3, materialId: "concrete" })]);

  // ---------------- Área externa ----------------
  floor(T, { x: 0, y: 0 }, { x: 20, y: 35 }, "grass", 0.05, 0);
  floor(T, { x: 3, y: 0 }, { x: 9, y: 8 }, "paving-stone", 0.05, 0.01);
  floor(T, { x: 9.6, y: 0 }, { x: 10.8, y: 8 }, "paving-stone", 0.05, 0.01);
  floor(T, { x: 3, y: 24.5 }, { x: 13, y: 30 }, "deck-wood", 0.05, 0.01);
  obj(T, "pool-8x4", 8, 27.2, 0);
  obj(T, "tree", 1.8, 3, 0);
  obj(T, "tree", 18.2, 3, 0);
  obj(T, "tree", 2.2, 32.5, 0);
  obj(T, "tree", 17.5, 32, 0);
  for (const x of [12.5, 13.6, 14.7, 15.8]) obj(T, "shrub", x, 6.9, 0);
  const fence = { height: 2.0, thickness: 0.15, materialId: "paint-graphite", core: "concrete-block" as const };
  wall(T, { x: 0, y: 0 }, { x: 0, y: 35 }, fence);
  wall(T, { x: 0, y: 35 }, { x: 20, y: 35 }, fence);
  wall(T, { x: 20, y: 35 }, { x: 20, y: 0 }, fence);

  // Ajustes finais de acabamento das fachadas.
  for (const e of p.elements) {
    if (e.type === "wall" && e.levelId === U && e.materialId === "paint-white" && (e.start.y === 8 || e.end.y === 8)) {
      p = updateElement(p, e.id, { materialId: "paint-graphite" });
    }
  }
  return p;
}
