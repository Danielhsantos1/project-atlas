import { describe, expect, it } from "vitest";
import { DEFAULT_GARAGE_PARAMS, garageCorners, planGarage } from "./garage";

describe("garagem por número de carros", () => {
  it("2 carros lado a lado: 5,00 + 2×0,30 de largura, 5,00 + 0,60 de profundidade", () => {
    const g = planGarage(2);
    expect(g.width).toBe(5.6);
    expect(g.depth).toBe(5.6);
    expect(g.area).toBeCloseTo(31.36, 2);
    expect(g.bays).toHaveLength(2);
    expect(g.bays[0]).toMatchObject({ x: 1.55, y: 2.8, rotation: 90 });
    expect(g.gates).toEqual([{ x: 2.8, width: 5 }]);
  });

  it("cresce com o número de vagas e 3 carros exigem 2 portões de até 5 m", () => {
    expect(planGarage(1).width).toBe(3.1);
    const g3 = planGarage(3);
    expect(g3.width).toBe(8.1);
    expect(g3.gates).toHaveLength(2);
    expect(g3.gates.every((x) => x.width <= DEFAULT_GARAGE_PARAMS.maxGateWidth)).toBe(true);
  });

  it("em fila é estreita e profunda; 4 carros em duas fileiras têm corredor", () => {
    const fila = planGarage(2, "em-fila");
    expect(fila.width).toBe(3.1);
    expect(fila.depth).toBe(10.9);
    expect(planGarage(3, "em-fila").notes.join(" ")).toMatch(/bloqueado/);
    const duas = planGarage(4, "duas-fileiras");
    expect(duas.width).toBe(5.6);
    expect(duas.depth).toBe(15.6);
    expect(new Set(duas.bays.map((b) => b.rotation))).toEqual(new Set([90, 270]));
  });

  it("parâmetros editáveis e validação de entrada", () => {
    expect(planGarage(2, "lado-a-lado", { bayWidth: 2.7 }).width).toBe(6);
    expect(() => planGarage(0)).toThrow(/1 a 12/);
    expect(() => planGarage(2.5)).toThrow(RangeError);
    expect(garageCorners({ x: 1, y: 2 }, planGarage(1))).toEqual([{ x: 1, y: 2 }, { x: 4.1, y: 7.6 }]);
  });
});
