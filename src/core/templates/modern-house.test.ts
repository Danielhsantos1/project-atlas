import { describe, expect, it } from "vitest";
import { buildModernHouse } from "./modern-house";
import { roomShape } from "../geometry/rooms";
import { validateOpening } from "../geometry/wall";
import { levelWalls, projectStats } from "../model/operations";
import { ProjectSchema, isOpening, type Wall } from "../model/schema";

describe("modelo demonstrativo — residência moderna 2 pavimentos", () => {
  const p = buildModernHouse(new Date("2026-10-31T12:00:00Z"));

  it("é um projeto válido com dois pavimentos", () => {
    expect(ProjectSchema.safeParse(p).success).toBe(true);
    expect(p.levels.map((l) => [l.name, l.elevation])).toEqual([["Térreo", 0], ["Pavimento superior", 3.2]]);
  });

  it("todos os ambientes estão fechados por paredes", () => {
    const rooms = p.elements.filter((e) => e.type === "room");
    expect(rooms.map((r) => r.name)).toEqual(
      expect.arrayContaining(["Garagem", "Sala de estar", "Cozinha", "Área gourmet", "Suíte", "Quarto 2", "Quarto 3", "Banheiro da suíte", "Circulação"]),
    );
    for (const r of rooms) {
      if (r.type !== "room") continue;
      expect(roomShape(levelWalls(p, r.levelId), r.seed), r.name).not.toBeNull();
    }
  });

  it("três quartos (suíte incluída) e dois banheiros nos dormitórios + social", () => {
    const types = p.elements.flatMap((e) => (e.type === "room" ? [e.roomType] : []));
    expect(types.filter((t) => t === "quarto" || t === "suite")).toHaveLength(3);
    expect(types.filter((t) => t === "banheiro").length).toBeGreaterThanOrEqual(2);
  });

  it("nenhuma abertura com problema geométrico", () => {
    const openings = p.elements.filter(isOpening);
    for (const o of openings) {
      const host = p.elements.find((e) => e.id === o.hostId) as Wall;
      expect(validateOpening(host, o, openings), o.name).toEqual([]);
    }
  });

  it("escada vence exatamente o piso a piso", () => {
    const stair = p.elements.find((e) => e.type === "object" && e.kind === "stair-straight");
    expect(stair && stair.type === "object" && stair.height).toBe(3.2);
  });

  it("é totalmente editável: alterar dimensões e materiais atualiza ambientes e quantitativos", async () => {
    const { resizeRoom, updateElement, deleteElements } = await import("../model/operations");
    const { takeoff } = await import("../../budget");
    const base = takeoff(p);
    const cozinha = p.elements.find((e) => e.type === "room" && e.name === "Cozinha")!;
    const wider = resizeRoom(p, cozinha.id, "y", 7);
    expect(projectStats(wider).totalRoomArea).toBeGreaterThan(projectStats(p).totalRoomArea);
    const floorLine = (t: ReturnType<typeof takeoff>) => t.lines.filter((l) => l.code.startsWith("PISO-")).reduce((s, l) => s + l.quantity, 0);
    expect(floorLine(takeoff(wider))).toBeGreaterThan(floorLine(base));
    const painted = updateElement(p, p.elements.find((e) => e.type === "wall" && e.levelId === "terreo")!.id, { materialId: "brick" });
    expect(takeoff(painted).lines.some((l) => l.code === "PINT-TINTA")).toBe(true);
    const wall = p.elements.find((e) => e.type === "wall" && p.elements.some((o) => o.type === "door" && o.hostId === e.id))!;
    const { project: removed, removed: ids } = deleteElements(p, [wall.id]);
    expect(ids.length).toBeGreaterThan(1); // parede + aberturas hospedadas
    expect(removed.elements.length).toBe(p.elements.length - ids.length);
  });

  it("quantitativos disponíveis", () => {
    const s = projectStats(p);
    expect(s.levels).toBe(2);
    expect(s.rooms).toBeGreaterThanOrEqual(12);
    expect(s.roofs).toBe(2);
    expect(s.totalRoomArea).toBeGreaterThan(200);
    expect(s.doors).toBeGreaterThan(10);
  });
});
