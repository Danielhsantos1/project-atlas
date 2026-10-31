import { describe, expect, it } from "vitest";
import { OBJECT_KINDS } from "../model/schema";
import { LIBRARY } from "../library/catalog";
import { isKnownMaterial } from "../model/materials";
import { objectParts, stairSteps } from "./objects";

describe("objetos paramétricos", () => {
  it("cada tipo gera peças contidas na caixa envolvente", () => {
    for (const item of LIBRARY) {
      if (item.spec.elementType !== "object") continue;
      const { length: L, width: W, height: H, kind } = item.spec;
      const parts = objectParts({ kind, length: L, width: W, height: H });
      expect(parts.length, kind).toBeGreaterThan(0);
      for (const p of parts) {
        expect(p.sx > 0 && p.sy > 0 && p.sz > 0, kind).toBe(true);
        expect(Math.abs(p.x) + p.sx / 2, kind).toBeLessThanOrEqual(L / 2 + 1e-9);
        expect(Math.abs(p.y) + p.sy / 2, kind).toBeLessThanOrEqual(W / 2 + 1e-9);
        expect(p.z - p.sz / 2, kind).toBeGreaterThanOrEqual(-1e-9);
        if (p.materialId) expect(isKnownMaterial(p.materialId)).toBe(true);
      }
    }
  });

  it("todos os tipos de objeto têm item na biblioteca", () => {
    const kinds = new Set(LIBRARY.flatMap((i) => (i.spec.elementType === "object" ? [i.spec.kind] : [])));
    for (const k of OBJECT_KINDS) expect(kinds.has(k), k).toBe(true);
  });

  it("escada: degraus distribuem altura e comprimento", () => {
    const parts = objectParts({ kind: "stair-straight", length: 4.2, width: 1, height: 2.88 });
    expect(parts).toHaveLength(stairSteps(2.88));
    expect(parts).toHaveLength(16);
    expect(parts.at(-1)!.sz).toBeCloseTo(2.88);
    expect(parts.reduce((s, p) => s + p.sx, 0)).toBeCloseTo(4.2);
  });
});
