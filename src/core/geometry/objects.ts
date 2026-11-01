import type { BuildingObject } from "../model/schema";

/**
 * Decomposição paramétrica dos objetos da biblioteca em primitivas.
 * Coordenadas locais: origem no centro da base, X = comprimento, Y = largura,
 * Z = altura. A MESMA lista alimenta o 3D (volumes) e a planta 2D (projeções).
 * Proporções são indicativas — não substituem detalhamento técnico.
 */
export interface ObjectPart {
  shape: "box" | "cylinder";
  /** Centro da peça. */
  x: number;
  y: number;
  z: number;
  /** Dimensões totais (para cilindro, sx/sy são os diâmetros). */
  sx: number;
  sy: number;
  sz: number;
  /** Material específico da peça; ausente = material do objeto. */
  materialId?: string;
}

type Dims = Pick<BuildingObject, "kind" | "length" | "width" | "height">;

const box = (x: number, y: number, z0: number, sx: number, sy: number, sz: number, materialId?: string): ObjectPart => ({
  shape: "box", x, y, z: z0 + sz / 2, sx, sy, sz, ...(materialId ? { materialId } : {}),
});
const cyl = (x: number, y: number, z0: number, sx: number, sy: number, sz: number, materialId?: string): ObjectPart => ({
  shape: "cylinder", x, y, z: z0 + sz / 2, sx, sy, sz, ...(materialId ? { materialId } : {}),
});

/** Altura de espelho de referência para a escada (geometria indicativa, não normativa). */
export const STAIR_TARGET_RISER = 0.18;

export function stairSteps(height: number): number {
  return Math.max(2, Math.round(height / STAIR_TARGET_RISER));
}

export function objectParts(o: Dims): ObjectPart[] {
  const L = o.length;
  const W = o.width;
  const H = o.height;
  const hl = L / 2;
  const hw = W / 2;
  const leg = Math.min(0.06, L / 6, W / 6);

  switch (o.kind) {
    case "column-rect":
      return [box(0, 0, 0, L, W, H)];
    case "column-round":
      return [cyl(0, 0, 0, L, W, H)];
    case "beam":
      return [box(0, 0, 0, L, W, H)];
    case "stair-straight": {
      const n = stairSteps(H);
      const run = L / n;
      const rise = H / n;
      return Array.from({ length: n }, (_, i) => box(-hl + run * (i + 0.5), 0, 0, run, W, rise * (i + 1)));
    }
    case "table": {
      const top = Math.min(0.04, H / 4);
      const legs = [-1, 1].flatMap((sx) => [-1, 1].map((sy) => box(sx * (hl - leg), sy * (hw - leg), 0, leg, leg, H - top)));
      return [box(0, 0, H - top, L, W, top), ...legs];
    }
    case "chair": {
      const seatZ = Math.min(0.45, H * 0.5);
      const seat = 0.05;
      const legs = [-1, 1].flatMap((sx) => [-1, 1].map((sy) => box(sx * (hl - 0.03), sy * (hw - 0.03), 0, 0.035, 0.035, seatZ)));
      return [box(0, 0, seatZ, L, W, seat), box(0, hw - 0.025, seatZ + seat, L, 0.05, H - seatZ - seat), ...legs];
    }
    case "sofa": {
      const arm = Math.min(0.18, L / 6);
      const back = Math.min(0.2, W / 3);
      const seatH = Math.min(0.42, H * 0.5);
      return [
        box(0, -back / 2, 0, L - arm * 2, W - back, seatH),
        box(0, hw - back / 2, 0, L, back, H),
        box(-hl + arm / 2, -back / 2, 0, arm, W - back, Math.min(0.62, H)),
        box(hl - arm / 2, -back / 2, 0, arm, W - back, Math.min(0.62, H)),
      ];
    }
    case "bed": {
      const base = Math.min(0.3, H * 0.55);
      const head = 0.06;
      return [
        box(0, -head / 2, 0, L, W - head, base, "wood-walnut"),
        box(0, -head / 2, base, L - 0.04, W - head - 0.04, Math.max(H - base, 0.05)),
        box(0, hw - head / 2, 0, L, head, Math.max(1.0, H), "wood-walnut"),
        box(-L / 4, hw - head - 0.25, H, L / 2 - 0.08, 0.35, 0.1, "fabric-gray"),
        box(L / 4, hw - head - 0.25, H, L / 2 - 0.08, 0.35, 0.1, "fabric-gray"),
      ];
    }
    case "countertop": {
      const top = 0.03;
      const plinth = 0.1;
      return [
        box(0, 0.025, plinth, L, W - 0.05, H - top - plinth, "mdf-white"),
        box(0, 0.05, 0, L, W - 0.1, plinth, "mdf-graphite"),
        box(0, 0, H - top, L, W, top),
      ];
    }
    case "cabinet-base": {
      const plinth = 0.1;
      return [
        box(0, 0.03, 0, L, W - 0.06, plinth, "mdf-graphite"),
        box(0, 0.01, plinth, L, W - 0.02, H - plinth),
        box(-0.05, -hw + 0.01, H - 0.12, 0.02, 0.02, 0.08, "steel-inox"),
        box(0.05, -hw + 0.01, H - 0.12, 0.02, 0.02, 0.08, "steel-inox"),
      ];
    }
    case "cabinet-wall":
      return [
        box(0, 0.01, 0, L, W - 0.02, H),
        box(-0.05, -hw + 0.01, 0.04, 0.02, 0.02, 0.08, "steel-inox"),
        box(0.05, -hw + 0.01, 0.04, 0.02, 0.02, 0.08, "steel-inox"),
      ];
    case "wardrobe": {
      const doors = 3;
      const handles = Array.from({ length: doors - 1 }, (_, i) => -hl + (L / doors) * (i + 1)).map((x) =>
        box(x, -hw + 0.01, H * 0.45, 0.02, 0.02, 0.25, "steel-inox"),
      );
      return [box(0, 0.01, 0, L, W - 0.02, H), ...handles];
    }
    case "toilet": {
      const tankD = Math.min(0.18, W * 0.3);
      return [
        cyl(0, -tankD / 2 + 0.02, 0, L * 0.95, W - tankD, Math.min(0.4, H * 0.52)),
        box(0, hw - tankD / 2, 0, L, tankD, H),
      ];
    }
    case "washbasin":
      return [
        cyl(0, 0.04, 0, Math.min(0.2, L / 2), Math.min(0.2, W / 2), H - 0.16),
        cyl(0, 0, H - 0.16, L, W, 0.16),
      ];
    case "shower": {
      const glass = 0.01;
      return [
        box(0, 0, 0, L, W, 0.05, "ceramic-white"),
        box(0, -hw + glass / 2, 0.05, L, glass, H - 0.05),
        box(hl - glass / 2, 0, 0.05, glass, W, H - 0.05),
        cyl(-hl + 0.15, hw - 0.15, H - 0.12, 0.2, 0.2, 0.02, "steel-inox"),
      ];
    }
    case "kitchen-island": {
      const top = 0.04;
      return [box(0, 0, 0.1, L - 0.1, W - 0.1, H - top - 0.1, "mdf-white"), box(0, 0, 0, L - 0.2, W - 0.2, 0.1, "mdf-graphite"), box(0, 0, H - top, L, W, top)];
    }
    case "sink-cabinet": {
      const top = 0.03;
      return [
        box(0, 0.01, 0.1, L, W - 0.02, H - top - 0.1, "mdf-white"),
        box(0, 0.03, 0, L, W - 0.06, 0.1, "mdf-graphite"),
        box(0, 0, H - top, L, W, top),
        box(0, 0, H - 0.2, Math.min(0.5, L * 0.6), Math.min(0.4, W * 0.7), 0.18, "steel-inox"),
      ];
    }
    case "cooktop":
      return [
        box(0, 0, 0, L, W, Math.min(0.06, H)),
        ...[-1, 1].flatMap((sx) => [-1, 1].map((sy) => cyl((sx * L) / 4, (sy * W) / 4, Math.min(0.06, H), 0.12, 0.12, 0.01, "steel-inox"))),
      ];
    case "oven-tower":
      return [box(0, 0, 0, L, W, H, "mdf-white"), box(0, -hw + 0.01, H * 0.45, L - 0.1, 0.02, 0.5, "glass-smoked")];
    case "fridge":
      return [box(0, 0.01, 0, L, W - 0.02, H), box(hl - 0.06, -hw + 0.01, H * 0.5, 0.02, 0.02, 0.4, "aluminum")];
    case "tv-rack":
      return [box(0, 0, 0.15, L, W, H - 0.15), ...[-1, 1].map((sx) => box(sx * (hl - 0.05), 0, 0, 0.04, W - 0.06, 0.15, "steel"))];
    case "tv":
      return [box(0, 0, 0, Math.min(0.3, L / 4), Math.min(0.2, W), 0.05, "steel"), box(0, 0, 0.05, 0.05, 0.03, Math.max(H * 0.15, 0.02), "steel"), box(0, 0, H * 0.18, L, Math.min(0.05, W), H * 0.82, "glass-smoked")];
    case "tv-panel":
      return [box(0, 0, 0, L, W, H)];
    case "nightstand":
      return [box(0, 0, 0.08, L, W, H - 0.08), ...[-1, 1].flatMap((sx) => [-1, 1].map((sy) => box(sx * (hl - 0.03), sy * (hw - 0.03), 0, 0.03, 0.03, 0.08, "steel")))];
    case "desk": {
      const top = 0.03;
      return [box(0, 0, H - top, L, W, top), box(-hl + 0.02, 0, 0, 0.04, W, H - top, "steel"), box(hl - 0.02, 0, 0, 0.04, W, H - top, "steel")];
    }
    case "bath-vanity": {
      const top = 0.03;
      return [box(0, 0.01, 0.25, L, W - 0.02, H - top - 0.25), box(0, 0, H - top, L, W, top, "marble-white"), cyl(0, 0, H - 0.01, Math.min(0.4, L * 0.6), Math.min(0.32, W * 0.7), 0.01, "ceramic-white")];
    }
    case "pool": {
      const coping = Math.min(0.3, L / 6, W / 6);
      return [
        box(0, -hw + coping / 2, 0, L, coping, H, "paving-stone"),
        box(0, hw - coping / 2, 0, L, coping, H, "paving-stone"),
        box(-hl + coping / 2, 0, 0, coping, W - coping * 2, H, "paving-stone"),
        box(hl - coping / 2, 0, 0, coping, W - coping * 2, H, "paving-stone"),
        box(0, 0, 0, L - coping * 2, W - coping * 2, H * 0.6, "water"),
      ];
    }
    case "tree":
      return [cyl(0, 0, 0, Math.min(0.3, L / 4), Math.min(0.3, W / 4), H * 0.45, "wood-walnut"), cyl(0, 0, H * 0.35, L, W, H * 0.65, "foliage")];
    case "shrub":
      return [cyl(0, 0, 0, L, W, H, "foliage")];
    case "grill":
      return [box(0, 0, 0, L, W, H * 0.45, "ceramic-brick"), box(0, 0, H * 0.45, L, W, 0.04, "granite-black"), box(0, 0.05, H * 0.45 + 0.04, L * 0.6, W * 0.6, H * 0.55 - 0.04, "ceramic-brick")];
    case "car":
      return [box(0, 0, 0.15, L, W, H * 0.45), box(-L * 0.05, 0, 0.15 + H * 0.45, L * 0.55, W * 0.9, H * 0.4, "glass-smoked"), ...[-1, 1].flatMap((sx) => [-1, 1].map((sy) => cyl(sx * L * 0.32, sy * (hw - 0.12), 0, 0.6, 0.22, 0.6, "granite-black")))];
  }
}
