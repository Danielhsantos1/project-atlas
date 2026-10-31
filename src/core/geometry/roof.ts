import type { Roof } from "../model/schema";
import { degToRad } from "../units/units";

/** Ponto local do telhado: x ao longo da largura, y da profundidade, z a partir do beiral. */
export type P3 = [number, number, number];

export interface RoofGeometry {
  /** Triângulos da superfície de cobertura (coordenadas locais). */
  surface: Array<[P3, P3, P3]>;
  /** Triângulos de oitão/empena (fechamento vertical sob a cobertura). */
  gables: Array<[P3, P3, P3]>;
  /** Área inclinada da cobertura (m²). */
  area: number;
  /** Área de projeção horizontal com beirais (m²). */
  footprint: number;
  /** Comprimento de cumeeira (m). */
  ridge: number;
  /** Altura da cumeeira acima do beiral (m). */
  rise: number;
}

const quad = (a: P3, b: P3, c: P3, d: P3): Array<[P3, P3, P3]> => [
  [a, b, c],
  [a, c, d],
];

/**
 * Geometria paramétrica do telhado. Inclinações iguais em todas as águas.
 * Geometria indicativa: não substitui projeto de estrutura de cobertura.
 */
export function roofGeometry(roof: Pick<Roof, "roofType" | "width" | "depth" | "pitch" | "overhang">): RoofGeometry {
  const L = roof.width + roof.overhang * 2;
  const D = roof.depth + roof.overhang * 2;
  const hx = L / 2;
  const hy = D / 2;
  const tan = Math.tan(degToRad(roof.pitch));
  const cos = Math.cos(degToRad(roof.pitch));
  const footprint = L * D;

  switch (roof.roofType) {
    case "flat":
      return { surface: quad([-hx, -hy, 0], [hx, -hy, 0], [hx, hy, 0], [-hx, hy, 0]), gables: [], area: footprint, footprint, ridge: 0, rise: 0 };
    case "shed": {
      const rise = D * tan;
      return {
        surface: quad([-hx, -hy, 0], [hx, -hy, 0], [hx, hy, rise], [-hx, hy, rise]),
        gables: [
          [[-hx, -hy, 0], [-hx, hy, rise], [-hx, hy, 0]],
          [[hx, -hy, 0], [hx, hy, 0], [hx, hy, rise]],
        ],
        area: footprint / cos,
        footprint,
        ridge: L,
        rise,
      };
    }
    case "gable": {
      const rise = hy * tan;
      return {
        surface: [...quad([-hx, -hy, 0], [hx, -hy, 0], [hx, 0, rise], [-hx, 0, rise]), ...quad([hx, hy, 0], [-hx, hy, 0], [-hx, 0, rise], [hx, 0, rise])],
        gables: [
          [[-hx, -hy, 0], [-hx, 0, rise], [-hx, hy, 0]],
          [[hx, -hy, 0], [hx, hy, 0], [hx, 0, rise]],
        ],
        area: footprint / cos,
        footprint,
        ridge: L,
        rise,
      };
    }
    case "hip": {
      // Cumeeira paralela ao lado maior.
      const alongX = L >= D;
      const half = (alongX ? D : L) / 2;
      const rise = half * tan;
      const r = Math.abs(L - D) / 2;
      const surface: Array<[P3, P3, P3]> = alongX
        ? [
            ...quad([-hx, -hy, 0], [hx, -hy, 0], [r, 0, rise], [-r, 0, rise]),
            ...quad([hx, hy, 0], [-hx, hy, 0], [-r, 0, rise], [r, 0, rise]),
            [[hx, -hy, 0], [hx, hy, 0], [r, 0, rise]],
            [[-hx, hy, 0], [-hx, -hy, 0], [-r, 0, rise]],
          ]
        : [
            ...quad([hx, -hy, 0], [hx, hy, 0], [0, r, rise], [0, -r, rise]),
            ...quad([-hx, hy, 0], [-hx, -hy, 0], [0, -r, rise], [0, r, rise]),
            [[-hx, -hy, 0], [hx, -hy, 0], [0, -r, rise]],
            [[hx, hy, 0], [-hx, hy, 0], [0, r, rise]],
          ];
      return { surface, gables: [], area: footprint / cos, footprint, ridge: 2 * r, rise };
    }
  }
}
