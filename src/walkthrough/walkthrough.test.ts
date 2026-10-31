import { describe, expect, it } from "vitest";
import { GROUND_LEVEL_ID, createOpening } from "../core/model/factory";
import { addElements, levelWalls, moveElement } from "../core/model/operations";
import { pointInPolygon, roomShape } from "../core/geometry/rooms";
import type { Project, Room } from "../core/model/schema";
import { buildCollisionWorld } from "./colliders";
import { DEFAULT_PLAYER_PARAMS, maxPenetration, stepPlayer, type PlayerState } from "./controller";
import { entranceSpawn, levelSpawn } from "./spawn";
import { findInteractable, toggleDoor } from "./interaction";
import { DT, FORWARD, IDLE, buildSobrado, findWallBetween, hold, openingSpec, walkPath, walkTo } from "./sobrado.fixture";

const house = buildSobrado();
const { project, upper } = house;
const world = buildCollisionWorld(project, house.allOpen);

function insideRoom(p: Project, room: Room, s: { x: number; y: number }): boolean {
  const shape = roomShape(levelWalls(p, room.levelId), room.seed);
  if (!shape) throw new Error("ambiente aberto");
  return pointInPolygon(s, shape.inner);
}
const insideAnyRoom = (p: Project, s: { x: number; y: number }) =>
  p.elements.some((e) => e.type === "room" && e.levelId === GROUND_LEVEL_ID && insideRoom(p, e, s));

const at = (x: number, y: number, z = 0, yaw = 0): PlayerState => ({ x, y, z, vz: 0, yaw, pitch: 0, onGround: true, levelId: z >= 2.9 ? upper.id : GROUND_LEVEL_ID });

/** Sobe a escada a partir de dentro da sala e chega à laje superior. */
function climb(from: PlayerState) {
  return walkPath(world, from, [{ x: 1.6, y: 4.8 }, { x: 7.2, y: 4.8 }]);
}

describe("passeio pelo sobrado (dt = 1/60)", () => {
  it("1. nasce do lado de fora e entra na sala pela porta externa aberta", () => {
    const spawn = entranceSpawn(project, DEFAULT_PLAYER_PARAMS, world);
    expect(insideAnyRoom(project, spawn)).toBe(false);
    expect(spawn.x).toBeCloseTo(2, 6);
    expect(spawn.y).toBeCloseTo(-0.075 - 1.2, 6);
    expect(spawn.yaw).toBeCloseTo(Math.PI / 2, 6); // olhando para a porta (+Y)
    expect(spawn.z).toBeCloseTo(0, 6);
    expect(spawn.levelId).toBe(GROUND_LEVEL_ID);
    const r = hold(world, spawn, FORWARD, 2.5);
    expect(r.state.y).toBeGreaterThan(1.5);
    expect(insideRoom(project, house.sala, r.state)).toBe(true);
    expect(r.state.z).toBeCloseTo(0, 6);
    for (const f of r.frames) expect(maxPenetration(world, f)).toBeLessThan(1e-3);
  });

  it("2. anda em volta da sala", () => {
    const r = walkPath(world, at(1.2, 1.2), [{ x: 7.0, y: 1.2 }, { x: 7.0, y: 3.6 }, { x: 1.2, y: 3.6 }, { x: 1.2, y: 1.2 }]);
    expect(r.reached).toBe(true);
    for (const f of r.frames) {
      expect(insideRoom(project, house.sala, f)).toBe(true);
      expect(f.z).toBeCloseTo(0, 6);
      expect(f.onGround).toBe(true);
    }
  });

  it("3. passa pela porta interna aberta até a cozinha", () => {
    const r = walkPath(world, at(6.5, 1.5), [{ x: 9.5, y: 1.5 }]);
    expect(r.reached).toBe(true);
    expect(insideRoom(project, house.cozinha, r.state)).toBe(true);
  });

  it("4. andar contra a parede por 5 s nunca a atravessa (penetração < 1 mm)", () => {
    // Perpendicular à parede sul da sala (face interna em y = 0,075).
    const r = hold(world, at(5, 1, 0, -Math.PI / 2), FORWARD, 5);
    for (const f of r.frames) {
      expect(f.y).toBeGreaterThan(0.075 + DEFAULT_PLAYER_PARAMS.radius - 1e-3);
      expect(maxPenetration(world, f)).toBeLessThan(1e-3);
    }
    // Em diagonal, correndo contra a parede leste da cozinha (sem aberturas):
    // desliza para o norte ao longo dela, sem atravessar.
    const d = hold(world, at(10.5, 2, 0, 0.6), { ...FORWARD, run: true }, 5);
    for (const f of d.frames) {
      expect(f.x).toBeLessThan(12 - 0.075 - 0.25 + 1e-3);
      expect(maxPenetration(world, f)).toBeLessThan(1e-3);
    }
    expect(d.state.y).toBeGreaterThan(5); // deslizou até o canto norte
  });

  it("5. porta FECHADA bloqueia; aberta deixa passar", () => {
    const closed = buildCollisionWorld(project, new Set([house.interiorDoorId]));
    const start = at(2, 1.5, 0, -Math.PI / 2);
    const blocked = hold(closed, start, FORWARD, 3);
    for (const f of blocked.frames) expect(f.y).toBeGreaterThan(0.325 - 1e-3);
    expect(insideRoom(project, house.sala, blocked.state)).toBe(true);
    const interiorClosed = buildCollisionWorld(project, new Set([house.exteriorDoorId]));
    const r = walkTo(interiorClosed, at(6.5, 1.5), { x: 9.5, y: 1.5 }, 4);
    expect(r.reached).toBe(false);
    expect(r.state.x).toBeLessThan(8 - 0.075 - 0.25 + 1e-3);
    const open = hold(world, start, FORWARD, 3);
    expect(open.state.y).toBeLessThan(-1);
  });

  it("6/7/8. sobe a escada degrau a degrau, anda na laje, entra no quarto e desce suavemente", () => {
    const up = climb(at(1.2, 3.6));
    expect(up.reached).toBe(true);
    // Subida: z nunca diminui e cresce em vários degraus discretos.
    const zs = up.frames.map((f) => f.z);
    for (let i = 1; i < zs.length; i++) expect(zs[i]!).toBeGreaterThanOrEqual(zs[i - 1]! - 1e-9);
    const distinct = new Set(zs.map((z) => z.toFixed(4)));
    expect(distinct.size).toBeGreaterThanOrEqual(12);
    const jumps = zs.slice(1).map((z, i) => z - zs[i]!);
    expect(Math.max(...jumps)).toBeLessThanOrEqual(DEFAULT_PLAYER_PARAMS.stepHeight);
    expect(up.state.z).toBeCloseTo(upper.elevation, 6);
    expect(up.state.onGround).toBe(true);
    expect(up.state.levelId).toBe(upper.id);
    for (const f of up.frames) expect(maxPenetration(world, f)).toBeLessThan(1e-3);

    // 7. Na laje superior: não cai e entra no quarto pela porta aberta.
    const room = walkPath(world, up.state, [{ x: 7.2, y: 2.0 }, { x: 1.0, y: 2.0 }, { x: 1.0, y: 0.8 }, { x: 7.2, y: 0.8 }, { x: 7.2, y: 2.0 }, { x: 10, y: 2.0 }]);
    expect(room.reached).toBe(true);
    for (const f of room.frames) {
      expect(f.z).toBeCloseTo(upper.elevation, 6);
      expect(f.onGround).toBe(true);
    }
    expect(insideRoom(project, house.quarto, room.state)).toBe(true);
    // Parado sobre a laje por 2 s: continua no lugar.
    expect(hold(world, room.state, IDLE, 2).state.z).toBeCloseTo(upper.elevation, 6);

    // 8. Desce: volta a z ≈ 0, sem ficar no ar por mais que poucos quadros seguidos.
    const down = walkPath(world, room.state, [{ x: 7.2, y: 2.0 }, { x: 7.2, y: 4.8 }, { x: 1.6, y: 4.8 }]);
    expect(down.reached).toBe(true);
    let airborne = 0;
    let worst = 0;
    for (const f of down.frames) {
      airborne = f.onGround ? 0 : airborne + 1;
      worst = Math.max(worst, airborne);
    }
    expect(worst).toBeLessThanOrEqual(3);
    const dz = down.frames.slice(1).map((f, i) => down.frames[i]!.z - f.z);
    expect(Math.max(...dz)).toBeLessThanOrEqual(DEFAULT_PLAYER_PARAMS.stepHeight);
    expect(down.state.z).toBeCloseTo(0, 6);
    expect(down.state.levelId).toBe(GROUND_LEVEL_ID);
  });

  it("9. sai pela porta externa para o jardim", () => {
    const r = walkPath(world, at(1.6, 4.0), [{ x: 2, y: 1.5 }, { x: 2, y: -2.5 }]);
    expect(r.reached).toBe(true);
    expect(insideAnyRoom(project, r.state)).toBe(false);
    expect(r.state.z).toBeCloseTo(0, 6);
    expect(r.state.onGround).toBe(true);
  });

  it("10. pulo volta ao piso; a cabeça não atravessa a laje por baixo", () => {
    const start = at(3, 1.5);
    const jump = hold(world, stepPlayer(world, start, { ...IDLE, jump: true }, DT), IDLE, 1.5);
    const peak = Math.max(...jump.frames.map((f) => f.z));
    expect(peak).toBeGreaterThan(0.4);
    expect(jump.state.onGround).toBe(true);
    expect(jump.state.z).toBeCloseTo(0, 6);
    // Pulo "super" (jumpSpeed 9 → apogeu teórico 4,1 m): a cabeça para sob a laje (base 2,88).
    const strong = { ...DEFAULT_PLAYER_PARAMS, jumpSpeed: 9 };
    const s = hold(world, stepPlayer(world, start, { ...IDLE, jump: true }, DT, strong), IDLE, 3, strong);
    const top = Math.max(...s.frames.map((f) => f.z));
    expect(top + strong.height).toBeLessThanOrEqual(upper.elevation - 0.12 + 1e-6);
    expect(top + strong.height).toBeGreaterThan(upper.elevation - 0.12 - 0.2);
    expect(s.state.z).toBeCloseTo(0, 6);
    expect(s.state.levelId).toBe(GROUND_LEVEL_ID);
    // Queda do alto (10 m, velocidade alta) sobre a laje: pousa nela, não a atravessa.
    const fall = hold(world, { ...at(1, 1), z: 13, onGround: false }, IDLE, 3);
    expect(fall.state.z).toBeCloseTo(upper.elevation, 6);
    expect(fall.state.onGround).toBe(true);
  });

  it("11. mover uma parede e reconstruir o mundo move a colisão; inserir porta cria passagem", () => {
    const east = findWallBetween(project, GROUND_LEVEL_ID, { x: 12, y: 0 }, { x: 12, y: 6 });
    const before = walkTo(world, at(10, 3), { x: 14, y: 3 }, 4);
    expect(before.reached).toBe(false);
    expect(before.state.x).toBeCloseTo(12 - 0.075 - 0.25, 3);

    const moved = moveElement(project, east.id, { x: 1, y: 0 });
    const movedWorld = buildCollisionWorld(moved, house.allOpen);
    const after = walkTo(movedWorld, at(10, 3), { x: 14, y: 3 }, 4);
    expect(after.reached).toBe(false);
    expect(after.state.x).toBeCloseTo(13 - 0.075 - 0.25, 3);

    const door = createOpening(project.elements, east, openingSpec("door-90"), 3);
    const withDoor = addElements(project, [door]);
    const closedWorld = buildCollisionWorld(withDoor, house.allOpen);
    expect(walkTo(closedWorld, at(10, 3), { x: 14, y: 3 }, 4).reached).toBe(false);
    const openWorld = buildCollisionWorld(withDoor, toggleDoor(house.allOpen, door.id));
    const through = walkTo(openWorld, at(10, 3), { x: 14, y: 3 }, 6);
    expect(through.reached).toBe(true);
  });
});

describe("spawn e interação", () => {
  it("levelSpawn: centro de um ambiente livre do pavimento, pés no piso", () => {
    const s = levelSpawn(project, upper.id, DEFAULT_PLAYER_PARAMS, world)!;
    expect(s).not.toBeNull();
    expect(s.x).toBeCloseTo(10, 6);
    expect(s.y).toBeCloseTo(2, 6);
    expect(s.z).toBeCloseTo(upper.elevation, 6);
    expect(s.levelId).toBe(upper.id);
    expect(hold(world, s, IDLE, 1).state.z).toBeCloseTo(upper.elevation, 6);
    const g = levelSpawn(project, GROUND_LEVEL_ID, DEFAULT_PLAYER_PARAMS, world)!;
    expect(g.z).toBeCloseTo(0, 6);
    expect(levelSpawn(project, "inexistente")).toBeNull();
  });

  it("entranceSpawn sem portas: fora da caixa do modelo, olhando para o centro", () => {
    const noDoors = { ...project, elements: project.elements.filter((e) => e.type !== "door") };
    const w = buildCollisionWorld(noDoors);
    const s = entranceSpawn(noDoors, DEFAULT_PLAYER_PARAMS, w);
    expect(s.y).toBeLessThan(w.bounds.minY);
    const cx = (w.bounds.minX + w.bounds.maxX) / 2;
    const cy = (w.bounds.minY + w.bounds.maxY) / 2;
    expect(s.yaw).toBeCloseTo(Math.atan2(cy - s.y, cx - s.x), 9);
  });

  it("findInteractable: porta à frente, no mesmo nível, dentro do cone", () => {
    const front = { x: 2, y: 1.0, z: 0, yaw: -Math.PI / 2 };
    const i = findInteractable(project, front)!;
    expect(i).toMatchObject({ kind: "door", elementId: house.exteriorDoorId, label: "Abrir porta" });
    expect(i.distance).toBeCloseTo(1.0, 6);
    expect(findInteractable(project, front, 1.6, house.allOpen)?.label).toBe("Fechar porta");
    expect(findInteractable(project, { ...front, yaw: Math.PI / 2 })).toBeNull(); // de costas
    expect(findInteractable(project, front, 0.5)).toBeNull(); // longe demais
    expect(findInteractable(project, { ...front, z: upper.elevation })).toBeNull(); // outro pavimento
    // No andar de cima, a porta do quarto.
    expect(findInteractable(project, { x: 7.2, y: 2, z: upper.elevation, yaw: 0 })?.elementId).toBe(house.quartoDoorId);
  });

  it("toggleDoor é imutável", () => {
    const a = new Set<string>(["x"]);
    const b = toggleDoor(a, "y");
    const c = toggleDoor(b, "x");
    expect([...a]).toEqual(["x"]);
    expect([...b].sort()).toEqual(["x", "y"]);
    expect([...c]).toEqual(["y"]);
  });
});
