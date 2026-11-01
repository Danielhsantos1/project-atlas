import { describe, expect, it } from "vitest";
import { interpretRequest } from "./interpret";
import { generateHouse } from "./generate";
import { checkProject } from "./check";
import { ProjectSchema } from "@/core/model/schema";
import { roomShape } from "@/core/geometry/rooms";
import { levelWalls, projectStats } from "@/core/model/operations";
import { buildCollisionWorld } from "@/walkthrough/colliders";
import { entranceSpawn } from "@/walkthrough/spawn";

const EXAMPLE = "Quero uma casa térrea de 150 metros quadrados, com três quartos, uma suíte, cozinha integrada, sala ampla, garagem para dois carros e piscina.";

describe("ATLAS AI — interpretação", () => {
  it("entende o pedido de exemplo da missão", () => {
    const { brief } = interpretRequest(EXAMPLE);
    expect(brief).toMatchObject({ floors: 1, targetArea: 150, bedrooms: 2, suites: 1, garageCars: 2, pool: true, integratedKitchen: true, largeLiving: true });
  });

  it("sobrado, banheiros, gourmet e escritório; registra suposições", () => {
    const r = interpretRequest("Sobrado com 4 quartos sendo 2 suítes, 3 banheiros, área gourmet e home office");
    expect(r.brief).toMatchObject({ floors: 2, bedrooms: 2, suites: 2, bathrooms: 1, gourmet: true, office: true });
    expect(interpretRequest("uma casa").assumptions.length).toBeGreaterThan(0);
  });
});

describe("ATLAS AI — geração e verificação", () => {
  it("casa térrea gerada é válida, fechada e próxima da área pedida", () => {
    const p = generateHouse(interpretRequest(EXAMPLE).brief, "Teste", new Date("2026-10-31T12:00:00Z"));
    expect(ProjectSchema.safeParse(p).success).toBe(true);
    for (const r of p.elements) if (r.type === "room") expect(roomShape(levelWalls(p, r.levelId), r.seed), r.name).not.toBeNull();
    const area = projectStats(p).totalRoomArea;
    expect(area).toBeGreaterThan(110);
    expect(area).toBeLessThan(190);
    expect(checkProject(p).filter((f) => f.severity === "erro")).toEqual([]);
  });

  it("sobrado gerado tem escada, laje e é navegável a partir da entrada", () => {
    const p = generateHouse(interpretRequest("sobrado com 3 quartos, 1 suíte, 2 banheiros e garagem para 2 carros").brief);
    expect(p.levels).toHaveLength(2);
    expect(checkProject(p).filter((f) => f.severity === "erro")).toEqual([]);
    const world = buildCollisionWorld(p, new Set(p.elements.filter((e) => e.type === "door").map((e) => e.id)));
    const s = entranceSpawn(p, undefined, world);
    expect(s.z).toBeCloseTo(0, 1);
  });

  it("verificador aponta problemas", () => {
    const p = generateHouse(interpretRequest(EXAMPLE).brief);
    const broken = { ...p, elements: p.elements.filter((e) => e.type !== "door" && e.type !== "roof") };
    const msgs = checkProject(broken).map((f) => f.message).join("\n");
    expect(msgs).toMatch(/sem porta/);
    expect(msgs).toMatch(/cobertura/);
  });
});
