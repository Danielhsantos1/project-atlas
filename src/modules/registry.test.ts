import { describe, expect, it } from "vitest";
import { MODULES, architectureQuantities } from "./registry";
import { createProject, createRoomWalls, createOpening } from "@/core/model/factory";
import { addElements } from "@/core/model/operations";

describe("registro de módulos", () => {
  it("dependências apontam para módulos existentes", () => {
    const ids = new Set(MODULES.map((m) => m.id));
    for (const m of MODULES) for (const d of m.dependsOn) expect(ids.has(d), `${m.id} → ${d}`).toBe(true);
  });

  it("quantitativos de arquitetura descontam aberturas", () => {
    let p = createProject({ name: "Q", category: "residencial", site: { width: 10, depth: 10 } });
    const walls = createRoomWalls([], { x: 0, y: 0 }, { x: 4, y: 3 }, { height: 2.5, thickness: 0.1, materialId: "brick" });
    p = addElements(p, walls);
    p = addElements(p, [createOpening(p.elements, walls[0]!, { elementType: "door", width: 1, height: 2, materialId: "wood-oak" }, 2)]);
    const lines = architectureQuantities.quantities(p);
    const first = lines.find((l) => l.code === `${walls[0]!.id}:area`)!;
    expect(first.quantity).toBe(4 * 2.5 - 2);
    expect(first.unit).toBe("m²");
    expect(lines.filter((l) => l.unit === "un")).toHaveLength(1);
  });
});
