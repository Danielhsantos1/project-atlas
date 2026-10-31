import { describe, expect, it } from "vitest";
import { PLANS, PlanSchema, can, canAccessProject, checkLimit, hasFeature } from "./model";

describe("base SaaS", () => {
  it("planos válidos e sem valores comerciais inventados", () => {
    for (const p of PLANS) expect(PlanSchema.safeParse(p).success).toBe(true);
    for (const p of PLANS) expect(Object.keys(p).sort()).toEqual(["features", "id", "limits", "name"]);
  });

  it("permissões por papel", () => {
    expect(can("owner", "billing.manage")).toBe(true);
    expect(can("admin", "billing.manage")).toBe(false);
    expect(can("editor", "project.edit")).toBe(true);
    expect(can("viewer", "project.edit")).toBe(false);
    expect(can("client", "budget.view")).toBe(false);
  });

  it("isolamento: sem associação à organização, sem acesso", () => {
    const ms = [{ userId: "u1", organizationId: "o1", role: "editor" as const }];
    expect(canAccessProject(ms, "u1", { organizationId: "o1" }, "project.edit")).toBe(true);
    expect(canAccessProject(ms, "u1", { organizationId: "o2" }, "project.view")).toBe(false);
    expect(canAccessProject(ms, "u2", { organizationId: "o1" }, "project.view")).toBe(false);
  });

  it("limites e recursos", () => {
    const free = PLANS[0]!;
    const usage = { projects: 3, members: 1, aiGenerationsPerMonth: 0, proposalsPerMonth: 0, storageMb: 10 };
    expect(checkLimit(free, usage, "projects")).toMatchObject({ allowed: false });
    expect(checkLimit(free, usage, "aiGenerationsPerMonth").allowed).toBe(true);
    expect(checkLimit(PLANS[2]!, usage, "projects", 1000).allowed).toBe(true);
    expect(hasFeature(free, "pdf-proposal")).toBe(false);
  });
});
