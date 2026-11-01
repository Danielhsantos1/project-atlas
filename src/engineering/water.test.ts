import { describe, expect, it } from "vitest";
import { buildModernHouse } from "../core/templates/modern-house";
import { projectOnSegment } from "../core/geometry/vec";
import { roomShape } from "../core/geometry/rooms";
import { levelWalls } from "../core/model/operations";
import type { Wall } from "../core/model/schema";
import { designWaterSystem, FIXTURE_OUTLET_HEIGHT_M } from "./water";
import { allFinite, emptyProject, withObject, withRoom } from "./test-fixtures";

function bathHouse() {
  let p = emptyProject();
  p = withRoom(p, [0, 0], [4, 4], "quarto");
  p = withRoom(p, [4, 0], [8, 4], "quarto");
  p = withRoom(p, [8, 0], [12, 4], "suite");
  p = withRoom(p, [0, 4], [3, 7], "banheiro");
  p = withObject(p, "toilet", 0.6, 6, "terreo");
  p = withObject(p, "washbasin", 1.5, 4.6, "terreo");
  p = withObject(p, "shower", 2.4, 6.4, "terreo");
  return p;
}

describe("reservatório", () => {
  it("3 dormitórios ⇒ 6 pessoas × 150 L × 2 d = 1800 L ⇒ 2000 L comercial (arredonda para cima)", () => {
    const w = designWaterSystem(bathHouse());
    expect(w.bedrooms).toBe(3);
    expect(w.occupants).toBe(6);
    expect(w.volume.requiredL).toBe(1800);
    expect(w.volume.tanks).toEqual([2000]);
    expect(w.volume.totalCapacityL).toBe(2000);
    const origin = (id: string) => w.assumptions.find((a) => a.id === id)?.origin;
    expect(origin("people.perBedroom")).toBe("referencia");
    expect(origin("water.perCapita")).toBe("referencia");
    expect(origin("water.reserveDays")).toBe("adotado");
    expect(w.status).toBe("pre-dimensionamento");
  });

  it("parâmetros sobrescrevem e viram 'informado'; volume acima do maior comercial é dividido; N reservatórios", () => {
    const p = bathHouse();
    const a = designWaterSystem(p, { peoplePerBedroom: 4, perCapitaLPerDay: 200, reserveDays: 3 }); // 3·4·200·3 = 7200
    expect(a.volume.requiredL).toBe(7200);
    expect(a.volume.tanks).toEqual([5000, 5000]);
    expect(a.assumptions.find((x) => x.id === "water.perCapita")?.origin).toBe("informado");
    const b = designWaterSystem(p, { tankCount: 3 }); // 1800/3 = 600 → 750
    expect(b.volume.tanks).toEqual([750, 750, 750]);
    const c = designWaterSystem(p, { commercialVolumesL: [1800, 2500] });
    expect(c.volume.tanks).toEqual([1800]);
  });

  it("sem dormitórios: ocupação mínima de 1 pessoa com aviso", () => {
    let p = emptyProject();
    p = withRoom(p, [0, 0], [4, 4], "sala");
    const w = designWaterSystem(p);
    expect(w.occupants).toBe(1);
    expect(w.volume.requiredL).toBe(300);
    expect(w.volume.tanks).toEqual([500]);
    expect(w.warnings.some((x) => x.includes("ocupação mínima"))).toBe(true);
    expect(w.fixtures).toEqual([]);
    expect(w.location).toBeNull();
  });

  it("carga do reservatório cheio = 9,81 kN/m³ × volume", () => {
    const w = designWaterSystem(bathHouse());
    expect(w.tankLoad.totalKN).toBeCloseTo(9.81 * 2, 9);
    expect(w.warnings.some((x) => x.includes("estrutura de apoio"))).toBe(true);
  });
});

describe("pressões", () => {
  it("pressão estática = cota da base − cota do ponto (exata) e dinâmica desconta a perda", () => {
    const w = designWaterSystem(bathHouse(), { tankBaseElevation: 10, headLossMca: 0.7 });
    expect(w.pressure.tankBaseSource).toBe("informado");
    const toilet = w.fixtures.find((f) => f.kind === "toilet")!;
    expect(toilet.outletElevation).toBeCloseTo(0 + 0 + FIXTURE_OUTLET_HEIGHT_M.toilet, 12);
    expect(toilet.staticMca).toBeCloseTo(10 - 0.3, 12);
    expect(toilet.dynamicMca).toBeCloseTo(10 - 0.3 - 0.7, 12);
    const shower = w.fixtures.find((f) => f.kind === "shower")!;
    expect(shower.staticMca).toBeCloseTo(10 - 2.1, 12);
  });

  it("cota sugerida = máx(saída + pressão mínima + perda) e recomendação de pedestal", () => {
    const p = bathHouse(); // laje de cobertura em 3,2 m
    const w = designWaterSystem(p, { minPressureMca: 0.5, headLossMca: 0.5 });
    expect(w.pressure.suggestedTankBase).toBeCloseTo(2.1 + 0.5 + 0.5, 9);
    expect(w.pressure.topSlabElevation).toBeCloseTo(3.2, 9);
    expect(w.pressure.topSlabProvides).toBe(true);
    expect(w.pressure.pedestalRiseM).toBeNull();
    // base mais alta que a laje ⇒ usa a laje (tanque sobre a laje)
    expect(w.pressure.tankBaseElevation).toBeCloseTo(3.2, 9);
    expect(w.fixtures.every((f) => f.status === "ok")).toBe(true);
  });

  it("laje que não fornece pressão ⇒ elevar pedestal ou pressurizador; limites mín/máx sinalizados", () => {
    const p = bathHouse();
    const w = designWaterSystem(p, { minPressureMca: 2, headLossMca: 1.5 }); // sugerida = 2,1+2+1,5 = 5,6 > 3,2
    expect(w.pressure.topSlabProvides).toBe(false);
    expect(w.pressure.pedestalRiseM).toBeCloseTo(5.6 - 3.2, 9);
    expect(w.pressure.recommendation).toContain("Elevar pedestal em 2.40 m");
    expect(w.pressure.recommendation).toContain("pressurizador");
    const low = designWaterSystem(p, { tankBaseElevation: 2.5 });
    expect(low.fixtures.find((f) => f.kind === "shower")!.status).toBe("baixa");
    const high = designWaterSystem(p, { tankBaseElevation: 60 });
    expect(high.fixtures.every((f) => f.status === "alta")).toBe(true);
    expect(high.warnings.some((x) => x.includes("redutora"))).toBe(true);
  });
});

describe("melhor localização do reservatório", () => {
  it("fica sobre o eixo de uma parede do pavimento mais alto e evita paredes de dormitório", () => {
    const p = bathHouse();
    const w = designWaterSystem(p);
    const loc = w.location!;
    expect(loc).not.toBeNull();
    const wall = p.elements.find((e): e is Wall => e.type === "wall" && e.id === loc.wallId)!;
    expect(projectOnSegment({ x: loc.x, y: loc.y }, wall.start, wall.end).distance).toBeLessThan(1e-9);
    const walls = levelWalls(p, "terreo");
    const bedWalls = new Set<string>();
    for (const r of p.elements) if (r.type === "room" && (r.roomType === "quarto" || r.roomType === "suite")) roomShape(walls, r.seed)!.wallIds.forEach((id) => bedWalls.add(id));
    expect(bedWalls.has(loc.wallId)).toBe(false);
    expect(loc.onBedroomWall).toBe(false);
    expect(loc.totalPipeLengthEstimate).toBeGreaterThan(0);
    expect(loc.reason).toContain("Heurística");
  });

  it("casa modelo: pontos coletados, localização no pavimento superior fora de parede de quarto, números finitos", () => {
    const p = buildModernHouse();
    const w = designWaterSystem(p);
    const top = p.levels.reduce((a, b) => (b.elevation > a.elevation ? b : a));
    expect(w.occupants).toBe(6);
    expect(w.volume.tanks).toEqual([2000]);
    expect(w.fixtures.length).toBe(8); // conforme o modelo: 3 bacias, 3 gabinetes/cubas, 1 chuveiro, 1 pia de cozinha
    expect(w.location!.levelId).toBe(top.id);
    const wall = p.elements.find((e): e is Wall => e.type === "wall" && e.id === w.location!.wallId)!;
    expect(wall.levelId).toBe(top.id);
    expect(projectOnSegment({ x: w.location!.x, y: w.location!.y }, wall.start, wall.end).distance).toBeLessThan(1e-9);
    expect(w.location!.onBedroomWall).toBe(false);
    expect(allFinite(w)).toBe(true);
    // chuveiro do pavimento superior (cota 3,2 + 2,1) exige base ≥ 5,3 + 1 + 0,5 = 6,8 > laje 6,4
    expect(w.pressure.suggestedTankBase).toBeCloseTo(6.8, 9);
    expect(w.pressure.pedestalRiseM).toBeCloseTo(0.4, 9);
  });
});
