import { describe, expect, it } from "vitest";
import { buildModernHouse } from "@/core/templates/modern-house";
import { buildCollisionWorld } from "./colliders";
import { entranceSpawn } from "./spawn";
import { maxPenetration } from "./controller";
import { hold, walkPath, FORWARD } from "./sobrado.fixture";
import { roomShape, pointInPolygon } from "@/core/geometry/rooms";
import { levelWalls } from "@/core/model/operations";
import type { Room } from "@/core/model/schema";

/**
 * Passeio na RESIDÊNCIA MODERNA demonstrativa (mesmo modelo exibido no editor):
 * entrar pela porta, cozinha, subir a escada, quarto 2, descer, sair pelo gourmet ao jardim.
 */
describe("passeio 3D na residência demonstrativa", () => {
  const project = buildModernHouse(new Date("2026-10-31T12:00:00Z"));
  const allDoors = new Set(project.elements.filter((e) => e.type === "door").map((e) => e.id));
  const world = buildCollisionWorld(project, allDoors);
  const upper = project.levels[1]!;
  const roomByName = (n: string) => project.elements.find((e): e is Room => e.type === "room" && e.name === n)!;
  const inside = (name: string, s: { x: number; y: number }) => {
    const r = roomByName(name);
    const shape = roomShape(levelWalls(project, r.levelId), r.seed)!;
    return pointInPolygon(s, shape.axis);
  };

  it("percurso completo: entrada → escada → quarto → escada → jardim", () => {
    let s = entranceSpawn(project, undefined, world);
    expect(inside("Sala de estar", s)).toBe(false);

    let t = walkPath(world, s, [{ x: 10.2, y: 9.5 }]);
    expect(t.reached).toBe(true);
    s = t.state;
    expect(inside("Sala de estar", s)).toBe(true);

    t = walkPath(world, s, [{ x: 13, y: 12.8 }, { x: 15.2, y: 15 }, { x: 15.2, y: 18.3 }, { x: 16.2, y: 18.4 }, { x: 16.2, y: 19.35 }]);
    expect(t.reached).toBe(true);
    s = t.state;
    expect(inside("Cozinha", s)).toBe(true);
    expect(s.z).toBeCloseTo(0, 2);

    // Subida: z nunca diminui; termina no pavimento superior.
    t = walkPath(world, s, [{ x: 10.6, y: 19.35 }]);
    expect(t.reached).toBe(true);
    for (let i = 1; i < t.frames.length; i++) expect(t.frames[i]!.z).toBeGreaterThanOrEqual(t.frames[i - 1]!.z - 1e-9);
    s = t.state;
    expect(s.z).toBeCloseTo(upper.elevation, 2);
    expect(s.levelId).toBe(upper.id);

    t = walkPath(world, s, [{ x: 12.2, y: 14.2 }, { x: 12.2, y: 11.5 }]);
    expect(t.reached).toBe(true);
    s = t.state;
    expect(inside("Quarto 2", s)).toBe(true);
    expect(s.z).toBeCloseTo(upper.elevation, 2);

    // Descida suave.
    t = walkPath(world, s, [{ x: 12.2, y: 14.2 }, { x: 10.6, y: 19.35 }, { x: 16.3, y: 19.35 }]);
    expect(t.reached).toBe(true);
    s = t.state;
    expect(s.z).toBeCloseTo(0, 2);
    let airborne = 0;
    let worst = 0;
    for (const f of t.frames) {
      airborne = f.onGround ? 0 : airborne + 1;
      worst = Math.max(worst, airborne);
    }
    expect(worst).toBeLessThanOrEqual(3);

    // Sai pela porta de correr para o gourmet e pelo vão livre ao jardim.
    t = walkPath(world, s, [{ x: 16.2, y: 18.4 }, { x: 10.4, y: 18.5 }, { x: 10.4, y: 21.3 }, { x: 10.2, y: 22 }, { x: 7, y: 22 }]);
    expect(t.reached).toBe(true);
    s = t.state;
    const rooms = project.elements.filter((e): e is Room => e.type === "room" && e.levelId === "terreo");
    expect(rooms.some((r) => inside(r.name, s))).toBe(false);
  });

  it("parede externa não é atravessada e porta principal fechada bloqueia", () => {
    const closed = buildCollisionWorld(project, new Set());
    const spawn = entranceSpawn(project, undefined, closed);
    const t = hold(closed, spawn, { ...FORWARD, run: true }, 4);
    expect(t.state.y).toBeLessThan(8);
    expect(maxPenetration(closed, t.state)).toBeLessThan(1e-3);
    // Andando contra a fachada lateral (parede x = 17) por fora.
    const side = hold(world, { ...spawn, x: 18.2, y: 11, yaw: Math.PI }, { ...FORWARD, run: true }, 4);
    expect(side.state.x).toBeGreaterThan(17);
  });
});
