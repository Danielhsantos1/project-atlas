import { describe, expect, it } from "vitest";
import { convertLength, formatLength, fromMeters, normalizeDegrees, parseLength, toMeters } from "./units";

describe("conversão de unidades", () => {
  it("converte entre m, cm e mm sem erro de ponto flutuante", () => {
    expect(toMeters(250, "cm")).toBe(2.5);
    expect(toMeters(15, "mm")).toBe(0.015);
    expect(fromMeters(0.15, "cm")).toBe(15);
    expect(fromMeters(2.8, "mm")).toBe(2800);
    expect(convertLength(1.1, "m", "cm")).toBe(110);
    expect(convertLength(30, "cm", "mm")).toBe(300);
    expect(toMeters(0.1 + 0.2, "m")).toBe(0.3);
  });

  it("formata no padrão brasileiro", () => {
    expect(formatLength(2.5, "m")).toBe("2,50 m");
    expect(formatLength(0.15, "cm")).toBe("15,0 cm");
    expect(formatLength(2.8, "mm")).toBe("2.800 mm");
    expect(formatLength(3, "m", { withUnit: false })).toBe("3,00");
  });

  it("valor formatado sem agrupamento volta ao mesmo número (ida e volta)", () => {
    for (const unit of ["m", "cm", "mm"] as const) {
      for (const meters of [2.8, 0.15, 12.345, 1500]) {
        const text = formatLength(meters, unit, { withUnit: false, grouping: false, decimals: 3 });
        const back = parseLength(text, unit);
        expect(back.ok && back.meters, `${meters} ${unit}`).toBeCloseTo(meters, 6);
      }
    }
  });
});

describe("parseLength", () => {
  it("aceita vírgula, ponto e sufixos de unidade", () => {
    expect(parseLength("2,5", "m")).toEqual({ ok: true, meters: 2.5 });
    expect(parseLength("2.5", "m")).toEqual({ ok: true, meters: 2.5 });
    expect(parseLength("250cm", "m")).toEqual({ ok: true, meters: 2.5 });
    expect(parseLength("  2500 mm ", "m")).toEqual({ ok: true, meters: 2.5 });
    expect(parseLength("15", "cm")).toEqual({ ok: true, meters: 0.15 });
    expect(parseLength(",5", "m")).toEqual({ ok: true, meters: 0.5 });
  });

  it("rejeita entradas inválidas com mensagem", () => {
    for (const bad of ["", "abc", "2,5,1", "3 km", "1e3"]) {
      const r = parseLength(bad, "m");
      expect(r.ok).toBe(false);
    }
  });

  it("normaliza ângulos", () => {
    expect(normalizeDegrees(370)).toBe(10);
    expect(normalizeDegrees(-90)).toBe(270);
  });
});
