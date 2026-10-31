import { describe, expect, it } from "vitest";
import { GROUND_LEVEL_ID, createObject, createOpening, createProject, createRoof, createRoomWithWalls, createWall } from "../core/model/factory";
import { addElements } from "../core/model/operations";
import type { Element, Project } from "../core/model/schema";
import { buildCollisionWorld, buildGrid, colliderAabb, queryColliders, type Collider } from "./colliders";
import {
  DEFAULT_PLAYER_PARAMS,
  circleObbPenetration,
  distanceToObb,
  eyePosition,
  lookDirection,
  maxPenetration,
  moveVector,
  stepPlayer,
  supportHeight,
  type PlayerState,
} from "./controller";
import { isPositionFree } from "./spawn";
import { findInteractable } from "./interaction";
import { FORWARD, IDLE, WALL_OPTS, buildSobrado, hold, objectSpec, openingSpec } from "./sobrado.fixture";

const box = (over: Partial<Collider> = {}): Collider => ({
  cx: 0, cy: 0, hx: 1, hy: 0.5, angle: 0, zMin: 0, zMax: 2, kind: "wall", elementId: "b", ...over,
});

describe("círculo × OBB", () => {
  it("sem contato retorna null; contato raso empurra pela normal da face", () => {
    expect(circleObbPenetration(0, 1.0, 0.25, box())).toBeNull();
    const p = circleObbPenetration(0, 0.6, 0.25, box())!;
    expect(p.x).toBeCloseTo(0, 9);
    expect(p.y).toBeCloseTo(0.15, 9);
    expect(p.depth).toBeCloseTo(0.15, 9);
  });

  it("canto: empurra na diagonal", () => {
    const p = circleObbPenetration(1.1, 0.6, 0.25, box())!;
    const d = Math.hypot(0.1, 0.1);
    expect(p.depth).toBeCloseTo(0.25 - d, 9);
    expect(p.x).toBeCloseTo(p.y, 9);
  });

  it("centro dentro da caixa: sai pela face mais próxima + raio", () => {
    const p = circleObbPenetration(0.2, 0.4, 0.25, box())!;
    expect(p.x).toBeCloseTo(0, 9);
    expect(p.y).toBeCloseTo(0.1 + 0.25, 9);
    const q = circleObbPenetration(-0.9, 0, 0.25, box())!;
    expect(q.x).toBeCloseTo(-0.35, 9);
  });

  it("caixa girada 90°: o eixo local X vira o Y do plano", () => {
    const b = box({ angle: Math.PI / 2 });
    expect(circleObbPenetration(0.8, 0, 0.25, b)).toBeNull();
    const p = circleObbPenetration(0.6, 0, 0.25, b)!;
    expect(p.x).toBeCloseTo(0.15, 9);
    expect(p.y).toBeCloseTo(0, 9);
    expect(distanceToObb(0, 1.5, b)).toBeCloseTo(0.5, 9);
    expect(colliderAabb(b)).toEqual({ minX: expect.closeTo(-0.5), maxX: expect.closeTo(0.5), minY: expect.closeTo(-1), maxY: expect.closeTo(1) });
  });

  it("caixa girada 45°", () => {
    const b = box({ hx: 1, hy: 1, angle: Math.PI / 4 });
    // Vértice em (√2, 0): ponto em (1.5, 0) está fora a 0,0858.
    const p = circleObbPenetration(1.5, 0, 0.25, b)!;
    expect(p.depth).toBeCloseTo(0.25 - (1.5 - Math.SQRT2), 9);
    expect(p.x).toBeGreaterThan(0);
  });
});

describe("grade espacial", () => {
  it("retorna só colliders próximos, sem duplicatas e em ordem", () => {
    const colliders = [box({ cx: 0.5, hx: 3, elementId: "a" }), box({ cx: 10, cy: 10, elementId: "b" }), box({ cx: 1, cy: -3, elementId: "c" })];
    const world = { colliders, grid: buildGrid(colliders, 2) };
    expect(queryColliders(world, 0, 0, 0.3).map((c) => c.elementId)).toEqual(["a"]);
    expect(queryColliders(world, 10, 10, 0.3).map((c) => c.elementId)).toEqual(["b"]);
    expect(queryColliders(world, 1, -1.5, 1.2).map((c) => c.elementId)).toEqual(["a", "c"]);
    expect(queryColliders(world, 50, 50, 1)).toEqual([]);
    // "a" ocupa várias células mas aparece uma vez.
    expect(queryColliders(world, 0, 0, 3).filter((c) => c.elementId === "a")).toHaveLength(1);
  });

  it("colliders enormes vão para a lista 'large' e continuam sendo encontrados", () => {
    const colliders = [box({ hx: 500, hy: 500, elementId: "terreno" })];
    const grid = buildGrid(colliders, 2);
    expect(grid.large).toEqual([0]);
    expect(queryColliders({ colliders, grid }, 123, -45, 0.3)).toHaveLength(1);
  });

  it("consulta da grade equivale à busca linear no sobrado", () => {
    const { project, allOpen } = buildSobrado();
    const world = buildCollisionWorld(project, allOpen);
    for (const [x, y] of [[2, 0], [8, 1.5], [4.5, 4.8], [-3, -3], [11.9, 5.9]] as const) {
      const r = 0.4;
      const linear = world.colliders.filter((c) => {
        const b = colliderAabb(c);
        return b.maxX >= x - r && b.minX <= x + r && b.maxY >= y - r && b.minY <= y + r;
      });
      expect(queryColliders(world, x, y, r)).toEqual(linear);
    }
  });
});

describe("mundo de colisão derivado do projeto", () => {
  const sob = buildSobrado();
  const kinds = (p: Project, open: ReadonlySet<string>, id: string) =>
    buildCollisionWorld(p, open).colliders.filter((c) => c.elementId === id).map((c) => c.kind);

  it("portas: bloqueador só quando fechadas; janelas sempre bloqueiam", () => {
    expect(kinds(sob.project, new Set(), sob.exteriorDoorId)).toEqual(["door"]);
    expect(kinds(sob.project, sob.allOpen, sob.exteriorDoorId)).toEqual([]);
    expect(kinds(sob.project, sob.allOpen, sob.windowId)).toEqual(["window"]);
    const w = buildCollisionWorld(sob.project, new Set()).colliders.find((c) => c.elementId === sob.exteriorDoorId)!;
    expect(w).toMatchObject({ cx: expect.closeTo(2), cy: expect.closeTo(0), hx: expect.closeTo(0.45), hy: expect.closeTo(0.075), zMin: 0, zMax: expect.closeTo(2.1) });
  });

  it("cotas absolutas: paredes e laje do superior somam a elevação do pavimento", () => {
    const world = buildCollisionWorld(sob.project, sob.allOpen);
    const upperWalls = world.colliders.filter((c) => c.kind === "wall" && c.zMin >= 2.99);
    expect(upperWalls.length).toBeGreaterThan(0);
    for (const c of upperWalls) expect(c.zMax).toBeCloseTo(3 + 2.8, 9);
    const slabs = world.colliders.filter((c) => c.kind === "floor" && c.zMax > 1);
    expect(slabs).toHaveLength(3);
    for (const c of slabs) {
      expect(c.zMax).toBeCloseTo(3, 9);
      expect(c.zMin).toBeCloseTo(2.88, 9);
    }
    // Ambos os pavimentos têm elementos `floor` (gramado / lajes): sem "room-floor".
    expect(world.colliders.filter((c) => c.kind === "room-floor")).toEqual([]);
    expect(world.levels.map((l) => l.elevation)).toEqual([0, 3]);
    expect(world.bounds.maxZ).toBeCloseTo(5.8, 9);
    expect(world.warnings).toEqual([]);
  });

  it("escada vira degraus 'stair' escaláveis; sofá é 'object'", () => {
    const world = buildCollisionWorld(sob.project, sob.allOpen);
    const steps = world.colliders.filter((c) => c.elementId === sob.stairId);
    expect(steps.length).toBeGreaterThanOrEqual(10);
    expect(steps.every((c) => c.kind === "stair")).toBe(true);
    const tops = steps.map((c) => c.zMax);
    expect(Math.max(...tops)).toBeCloseTo(3, 9);
    for (let i = 1; i < tops.length; i++) expect(tops[i]! - tops[i - 1]!).toBeLessThan(DEFAULT_PLAYER_PARAMS.stepHeight);
    expect(world.colliders.some((c) => c.kind === "object")).toBe(true);
  });

  it("room-floor só em pavimentos SEM elementos floor: quarto superior sem laje é caminhável", () => {
    const noSlab = { ...sob.project, elements: sob.project.elements.filter((e) => !(e.type === "floor" && e.levelId === sob.upper.id)) };
    const world = buildCollisionWorld(noSlab, sob.allOpen);
    const rf = world.colliders.filter((c) => c.kind === "room-floor");
    expect(rf.map((c) => c.elementId)).toEqual([sob.quarto.id]); // térreo tem o gramado → sem room-floor
    expect(rf[0]).toMatchObject({ cx: 10, cy: 2, hx: 2, hy: 2, zMin: expect.closeTo(2.95), zMax: 3 });
    const s: PlayerState = { x: 10, y: 2, z: 3, vz: 0, yaw: 0, pitch: 0, onGround: true, levelId: sob.upper.id };
    const r = hold(world, s, IDLE, 1);
    expect(r.state.z).toBe(3);
    expect(r.state.onGround).toBe(true);
  });

  it('porta estilo "opening" (vão livre) nunca bloqueia e não é interativa', () => {
    const door = sob.project.elements.find((e) => e.id === sob.exteriorDoorId)!;
    const passage = { ...door, style: "opening" as const };
    const p: Project = { ...sob.project, elements: sob.project.elements.map((e) => (e.id === door.id ? (passage as Element) : e)) };
    expect(kinds(p, new Set(), sob.exteriorDoorId)).toEqual([]); // fechada pelo doorOpen, mas é vão livre
    const world = buildCollisionWorld(p, new Set());
    const s: PlayerState = { x: 2, y: 1.5, z: 0, vz: 0, yaw: -Math.PI / 2, pitch: 0, onGround: true, levelId: GROUND_LEVEL_ID };
    expect(hold(world, s, FORWARD, 3).state.y).toBeLessThan(-1);
    expect(findInteractable(p, { x: 2, y: 1, z: 0, yaw: -Math.PI / 2 })).toBeNull();
    // Mesma porta como "sliding": segue o doorOpen.
    const sliding = { ...door, style: "sliding" as const };
    const q: Project = { ...sob.project, elements: sob.project.elements.map((e) => (e.id === door.id ? (sliding as Element) : e)) };
    expect(kinds(q, new Set(), sob.exteriorDoorId)).toEqual(["door"]);
    expect(kinds(q, sob.allOpen, sob.exteriorDoorId)).toEqual([]);
    expect(findInteractable(q, { x: 2, y: 1, z: 0, yaw: -Math.PI / 2 })?.elementId).toBe(sob.exteriorDoorId);
  });

  it("janela piso-teto (peitoril 0) também bloqueia", () => {
    let p = sob.project;
    const wall = p.elements.find((e): e is Extract<Element, { type: "wall" }> => e.type === "wall" && e.start.x === 12 && e.end.x === 12 && e.levelId === GROUND_LEVEL_ID)!;
    const glass = createOpening(p.elements, wall, { elementType: "window", width: 1.2, height: 2.4, sillHeight: 0, materialId: "glass-clear" }, 3);
    p = addElements(p, [glass]);
    const world = buildCollisionWorld(p, sob.allOpen);
    const r = hold(world, { x: 10.5, y: 3, z: 0, vz: 0, yaw: 0, pitch: 0, onGround: true, levelId: GROUND_LEVEL_ID }, FORWARD, 3);
    expect(r.state.x).toBeCloseTo(12 - 0.075 - 0.25, 3);
  });

  it("árvore: só o tronco; piscina: água bloqueia ≥ 1 m, borda caminhável; carro sólido; telhado ignorado", () => {
    let p = createProject({ name: "Ext", category: "residencial", site: { width: 40, depth: 40 } });
    const tree = createObject(p.elements, objectSpec("tree"), "Árvore", { x: 0, y: 0 });
    const pool = createObject(p.elements, objectSpec("pool-8x4"), "Piscina", { x: 10, y: 0 });
    const roof = createRoof(p.elements, { x: -5, y: 5 }, { x: 5, y: 15 }, { levelId: GROUND_LEVEL_ID, baseHeight: 2.8 });
    p = addElements(p, [tree, pool, roof]);
    const world = buildCollisionWorld(p);
    const treeParts = world.colliders.filter((c) => c.elementId === tree.id);
    expect(treeParts).toHaveLength(1);
    expect(treeParts[0]!.hx).toBeLessThanOrEqual(0.15 + 1e-9); // tronco (≤ 0,30 m de diâmetro)
    const poolParts = world.colliders.filter((c) => c.elementId === pool.id);
    const water = poolParts.find((c) => c.zMax >= 1)!;
    expect(water.zMin).toBe(0);
    expect(water.zMax).toBeGreaterThanOrEqual(1);
    expect(poolParts.filter((c) => c.zMax <= DEFAULT_PLAYER_PARAMS.stepHeight)).toHaveLength(4); // borda
    expect(world.colliders.some((c) => c.elementId === roof.id)).toBe(false);

    // Andando sob a copa até o tronco: para no tronco.
    const s: PlayerState = { x: -2, y: 0, z: 0, vz: 0, yaw: 0, pitch: 0, onGround: true, levelId: GROUND_LEVEL_ID };
    const r = hold(world, s, FORWARD, 3);
    expect(r.state.x).toBeCloseTo(-0.15 - 0.25, 3);
    // Sobe na borda da piscina (0,3 m) mas não entra na água.
    const towardPool: PlayerState = { ...s, x: 10, y: -4, yaw: Math.PI / 2 };
    const q = hold(world, towardPool, FORWARD, 4);
    expect(q.state.z).toBeCloseTo(0.3, 6);
    expect(q.state.y).toBeLessThan(-2 + 0.3 + 1e-9);
    expect(maxPenetration(world, q.state)).toBeLessThan(1e-3);

    const car = createObject(p.elements, objectSpec("car"), "Carro", { x: 20, y: 0 });
    const withCar = addElements(p, [car]);
    const cw = buildCollisionWorld(withCar);
    expect(isPositionFree(cw, 20, 0, 0)).toBe(false);
    expect(isPositionFree(cw, 20, 5, 0)).toBe(true);
  });

  it("ambiente não retangular: aproxima pela caixa só se ocupar ≥ 90%, senão avisa", () => {
    let p = createProject({ name: "L", category: "residencial", site: { width: 30, depth: 30 } });
    const pts = [[0, 0], [6, 0], [6, 3], [3, 3], [3, 6], [0, 6]] as const;
    const walls: Element[] = [];
    pts.forEach((a, i) => {
      const b = pts[(i + 1) % pts.length]!;
      walls.push(createWall([...p.elements, ...walls], { x: a[0], y: a[1] }, { x: b[0], y: b[1] }, { ...WALL_OPTS }));
    });
    const room = createRoomWithWalls([], { x: 20, y: 20 }, { x: 22, y: 22 }, "sala", { ...WALL_OPTS, levelId: GROUND_LEVEL_ID }).room;
    p = addElements(p, [...walls, { ...room, seed: { x: 1, y: 1 } }]);
    const world = buildCollisionWorld(p);
    expect(world.colliders.some((c) => c.kind === "room-floor")).toBe(false);
    expect(world.warnings).toHaveLength(1);
    expect(world.warnings[0]).toMatch(/não é retangular/);
  });
});

describe("controlador: helpers", () => {
  it("moveVector, lookDirection e eyePosition no referencial do domínio", () => {
    const f = moveVector(0, { forward: 1, right: 0 });
    expect(f.x).toBeCloseTo(1, 9);
    expect(f.y).toBeCloseTo(0, 9);
    const r = moveVector(0, { forward: 0, right: 1 }); // olhando +X, direita = −Y (sul)
    expect(r.x).toBeCloseTo(0, 9);
    expect(r.y).toBeCloseTo(-1, 9);
    const n = moveVector(Math.PI / 2, { forward: 1, right: 1 });
    expect(Math.hypot(n.x, n.y)).toBeCloseTo(1, 9);
    expect(n.x).toBeCloseTo(Math.SQRT1_2, 9);
    const d = lookDirection(Math.PI / 2, Math.PI / 6);
    expect(d.x).toBeCloseTo(0, 9);
    expect(d.y).toBeCloseTo(Math.cos(Math.PI / 6), 9);
    expect(d.z).toBeCloseTo(0.5, 9);
    expect(eyePosition({ x: 1, y: 2, z: 3 })).toEqual({ x: 1, y: 2, z: 3 + 1.65 });
    expect(eyePosition({ x: 1, y: 2, z: 3 }, { eyeHeight: 1.5 }).z).toBe(4.5);
  });

  it("terreno implícito em z = 0 e pulo só no chão", () => {
    const world = buildCollisionWorld(createProject({ name: "V", category: "residencial", site: { width: 10, depth: 10 } }));
    expect(supportHeight(world, 0, 0, 0.25, 0.35)).toBe(0);
    let s: PlayerState = { x: 0, y: 0, z: 2, vz: 0, yaw: 0, pitch: 0, onGround: false, levelId: GROUND_LEVEL_ID };
    s = stepPlayer(world, s, { forward: 0, right: 0, run: false, jump: true }, 1 / 60);
    expect(s.vz).toBeLessThan(0); // no ar: pulo ignorado
    s = hold(world, s, { forward: 0, right: 0, run: false, jump: false }, 2).state;
    expect(s.z).toBe(0);
    expect(s.onGround).toBe(true);
  });

  it("dt enorme é limitado e não atravessa paredes", () => {
    const { project, allOpen } = buildSobrado();
    const world = buildCollisionWorld(project, allOpen);
    const s: PlayerState = { x: 5, y: 1, z: 0, vz: 0, yaw: -Math.PI / 2, pitch: 0, onGround: true, levelId: GROUND_LEVEL_ID };
    const r = stepPlayer(world, s, { forward: 1, right: 0, run: true, jump: false }, 5);
    expect(r.y).toBeGreaterThan(0.325 - 1e-3);
  });
});
