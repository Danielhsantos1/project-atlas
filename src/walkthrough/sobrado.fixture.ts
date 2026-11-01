import type { Element, Level, Project, Room, Wall } from "../core/model/schema";
import { GROUND_LEVEL_ID, createFloor, createLevel, createObject, createOpening, createProject, createRoomWithWalls } from "../core/model/factory";
import { addElements, addLevel } from "../core/model/operations";
import { getLibraryItem, type LibrarySpec } from "../core/library/catalog";
import { DEFAULT_PLAYER_PARAMS, stepPlayer, type PlayerInput, type PlayerParams, type PlayerState } from "./controller";
import type { CollisionWorld } from "./colliders";

/**
 * Projeto de teste: SOBRADO (usado só pelos testes do passeio).
 *
 * Térreo (elevação 0, pé-direito de pavimento 3,0 m; paredes 2,80 × 0,15):
 *   sala    (0,0)–(8,6): porta externa (porta-90) na parede sul em x = 2;
 *                         sofá centrado em (5; 2,5); escada reta 4,2 × 1,0 × 3,0
 *                         de x 2,4 a 6,6, y 4,3 a 5,3 (sobe para +X).
 *   cozinha (8,0)–(12,6): porta interna na parede x = 8 em y = 1,5;
 *                         janela 120×120 na parede sul em x = 10.
 *   gramado (-4,-8)–(16,-0,1) fora da casa.
 * Superior (elevação 3,0): laje 0,12 m em 3 retângulos deixando o vão da
 *   escada (x 2,4–6,6, y 4,3–5,3) e o quarto (8,0)–(12,4) com porta na
 *   parede x = 8 em y = 2.
 */

export const WALL_OPTS = { height: 2.8, thickness: 0.15, materialId: "plaster-white" } as const;

type OpeningSpec = Extract<LibrarySpec, { elementType: "door" | "window" }>;
type ObjectSpec = Extract<LibrarySpec, { elementType: "object" }>;

export function openingSpec(id: string): OpeningSpec {
  const spec = getLibraryItem(id)?.spec;
  if (!spec || (spec.elementType !== "door" && spec.elementType !== "window")) throw new Error(`abertura ${id} ausente`);
  return spec;
}

export function objectSpec(id: string): ObjectSpec {
  const spec = getLibraryItem(id)?.spec;
  if (!spec || spec.elementType !== "object") throw new Error(`objeto ${id} ausente`);
  return spec;
}

const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

/** Parede do pavimento cujo eixo liga os dois pontos (em qualquer sentido). */
export function findWallBetween(p: Pick<Project, "elements">, levelId: string, a: { x: number; y: number }, b: { x: number; y: number }): Wall {
  const w = p.elements.find(
    (e): e is Wall =>
      e.type === "wall" &&
      e.levelId === levelId &&
      ((near(e.start.x, a.x) && near(e.start.y, a.y) && near(e.end.x, b.x) && near(e.end.y, b.y)) ||
        (near(e.start.x, b.x) && near(e.start.y, b.y) && near(e.end.x, a.x) && near(e.end.y, a.y))),
  );
  if (!w) throw new Error("parede não encontrada");
  return w;
}

export interface Sobrado {
  project: Project;
  upper: Level;
  sala: Room;
  cozinha: Room;
  quarto: Room;
  exteriorDoorId: string;
  interiorDoorId: string;
  quartoDoorId: string;
  windowId: string;
  stairId: string;
  /** Portas abertas no cenário padrão. */
  allOpen: ReadonlySet<string>;
}

export function buildSobrado(): Sobrado {
  let p = createProject({ name: "Sobrado", category: "residencial", site: { width: 30, depth: 30 }, now: new Date("2026-01-01T00:00:00Z") });
  const ground = { ...WALL_OPTS, levelId: GROUND_LEVEL_ID };
  const add = (els: Element[]) => {
    p = addElements(p, els);
  };

  const s = createRoomWithWalls(p.elements, { x: 0, y: 0 }, { x: 8, y: 6 }, "sala", ground);
  add([...s.walls, s.room]);
  const c = createRoomWithWalls(p.elements, { x: 8, y: 0 }, { x: 12, y: 6 }, "cozinha", ground);
  add([...c.walls, c.room]);

  const south = findWallBetween(p, GROUND_LEVEL_ID, { x: 0, y: 0 }, { x: 8, y: 0 });
  const exterior = createOpening(p.elements, south, openingSpec("door-90"), 2);
  add([exterior]);
  const shared = findWallBetween(p, GROUND_LEVEL_ID, { x: 8, y: 0 }, { x: 8, y: 6 });
  const interior = createOpening(p.elements, shared, openingSpec("door-90"), Math.abs(1.5 - shared.start.y));
  add([interior]);
  const kitchenSouth = findWallBetween(p, GROUND_LEVEL_ID, { x: 8, y: 0 }, { x: 12, y: 0 });
  const win = createOpening(p.elements, kitchenSouth, openingSpec("window-120x120"), Math.abs(10 - kitchenSouth.start.x));
  add([win]);

  const sofa = createObject(p.elements, objectSpec("sofa-3"), "Sofá", { x: 5, y: 2.5 });
  add([sofa]);
  const stair = createObject(p.elements, { ...objectSpec("stair-straight"), length: 4.2, width: 1.0, height: 3.0 }, "Escada", { x: 4.5, y: 4.8 });
  add([stair]);
  add([createFloor(p.elements, { x: -4, y: -8 }, { x: 16, y: -0.1 }, { thickness: 0.05, materialId: "grass", levelId: GROUND_LEVEL_ID })]);

  const upper = createLevel(p.levels);
  p = addLevel(p, upper);
  const slab = { thickness: 0.12, materialId: "concrete", elevation: 0, levelId: upper.id };
  add([createFloor(p.elements, { x: -0.1, y: -0.1 }, { x: 12.1, y: 4.3 }, slab)]);
  add([createFloor(p.elements, { x: -0.1, y: 5.3 }, { x: 12.1, y: 6.1 }, slab)]);
  add([createFloor(p.elements, { x: 6.6, y: 4.3 }, { x: 12.1, y: 5.3 }, slab)]);

  const q = createRoomWithWalls(p.elements, { x: 8, y: 0 }, { x: 12, y: 4 }, "quarto", { ...WALL_OPTS, levelId: upper.id });
  add([...q.walls, q.room]);
  const qWest = findWallBetween(p, upper.id, { x: 8, y: 0 }, { x: 8, y: 4 });
  const qDoor = createOpening(p.elements, qWest, openingSpec("door-90"), Math.abs(2 - qWest.start.y));
  add([qDoor]);

  return {
    project: p,
    upper,
    sala: s.room,
    cozinha: c.room,
    quarto: q.room,
    exteriorDoorId: exterior.id,
    interiorDoorId: interior.id,
    quartoDoorId: qDoor.id,
    windowId: win.id,
    stairId: stair.id,
    allOpen: new Set([exterior.id, interior.id, qDoor.id]),
  };
}

export const DT = 1 / 60;
export const IDLE: PlayerInput = { forward: 0, right: 0, run: false, jump: false };
export const FORWARD: PlayerInput = { forward: 1, right: 0, run: false, jump: false };

export interface Trace {
  state: PlayerState;
  frames: PlayerState[];
  reached: boolean;
}

/** Simula `seconds` segundos com uma entrada fixa. */
export function hold(world: CollisionWorld, start: PlayerState, input: PlayerInput, seconds: number, params: PlayerParams = DEFAULT_PLAYER_PARAMS): Trace {
  let state = start;
  const frames: PlayerState[] = [];
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    state = stepPlayer(world, state, input, DT, params);
    frames.push(state);
  }
  return { state, frames, reached: true };
}

/** "Piloto automático": gira para o alvo e anda para frente até chegar (ou estourar o tempo). */
export function walkTo(
  world: CollisionWorld,
  start: PlayerState,
  target: { x: number; y: number },
  maxSeconds = 20,
  params: PlayerParams = DEFAULT_PLAYER_PARAMS,
): Trace {
  let state = start;
  const frames: PlayerState[] = [];
  for (let i = 0; i < Math.round(maxSeconds / DT); i++) {
    const dx = target.x - state.x;
    const dy = target.y - state.y;
    if (Math.hypot(dx, dy) < 0.03) return { state, frames, reached: true };
    const yaw = Math.atan2(dy, dx);
    const stepLen = params.walkSpeed * DT;
    const forward = Math.min(1, Math.hypot(dx, dy) / stepLen);
    state = stepPlayer(world, { ...state, yaw }, { ...FORWARD, forward }, DT, params);
    frames.push(state);
  }
  return { state, frames, reached: false };
}

/** Percorre uma sequência de pontos. */
export function walkPath(world: CollisionWorld, start: PlayerState, path: ReadonlyArray<{ x: number; y: number }>, params: PlayerParams = DEFAULT_PLAYER_PARAMS): Trace {
  let state = start;
  const frames: PlayerState[] = [];
  let reached = true;
  for (const t of path) {
    const r = walkTo(world, state, t, 20, params);
    frames.push(...r.frames);
    state = r.state;
    reached = reached && r.reached;
  }
  return { state, frames, reached };
}
