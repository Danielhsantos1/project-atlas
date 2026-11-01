import type { Vec2 } from "../geometry/vec";

/**
 * Dimensionamento de garagem por número de veículos.
 *
 * Medidas de referência EDITÁVEIS (códigos de obras municipais variam e podem
 * exigir mais): vaga 2,50 × 5,00 m, folga lateral de manobra de portas 0,10 m
 * por lado extra. Resultado é estudo preliminar: conferir o código de obras local.
 */
export interface GarageParams {
  /** Largura útil de cada vaga (m). */
  bayWidth: number;
  /** Comprimento útil de cada vaga (m). */
  bayLength: number;
  /** Folga entre veículo e parede / entre veículos (m), adicionada às extremidades. */
  clearance: number;
  /** Largura máxima do portão de uma abertura (m); acima disso, usa-se mais de um portão. */
  maxGateWidth: number;
  /** Largura de corredor de manobra quando as vagas são em duas fileiras (m). */
  aisleWidth: number;
}

export const DEFAULT_GARAGE_PARAMS: Readonly<GarageParams> = Object.freeze({
  bayWidth: 2.5,
  bayLength: 5.0,
  clearance: 0.3,
  maxGateWidth: 5.0,
  aisleWidth: 5.0,
});

export type GarageLayout = "lado-a-lado" | "em-fila" | "duas-fileiras";

export interface GaragePlan {
  layout: GarageLayout;
  cars: number;
  /** Dimensões internas (eixo X = largura, Y = profundidade), em metros. */
  width: number;
  depth: number;
  area: number;
  /** Centros e rotação (graus) de cada veículo, relativos ao canto inferior esquerdo da garagem. */
  bays: Array<{ x: number; y: number; rotation: number }>;
  /** Portões: centro (x relativo) e largura, na parede frontal (y = 0). */
  gates: Array<{ x: number; width: number }>;
  notes: string[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Planeja a garagem. "lado-a-lado": vagas lado a lado voltadas para a rua (frente em y = 0);
 * "em-fila": vagas uma atrás da outra (garagem estreita e profunda); "duas-fileiras": duas fileiras
 * frente a frente com corredor de manobra (para 4+ veículos).
 */
export function planGarage(cars: number, layout: GarageLayout = "lado-a-lado", params: Partial<GarageParams> = {}): GaragePlan {
  if (!Number.isInteger(cars) || cars < 1 || cars > 12) throw new RangeError("Informe de 1 a 12 veículos.");
  const p = { ...DEFAULT_GARAGE_PARAMS, ...params };
  const notes: string[] = [
    `Vaga de referência ${p.bayWidth.toFixed(2).replace(".", ",")} × ${p.bayLength.toFixed(2).replace(".", ",")} m; conferir exigência do código de obras local.`,
  ];
  const bays: GaragePlan["bays"] = [];
  let width = 0;
  let depth = 0;

  if (layout === "lado-a-lado") {
    width = r2(cars * p.bayWidth + 2 * p.clearance);
    depth = r2(p.bayLength + 2 * p.clearance);
    for (let i = 0; i < cars; i++) bays.push({ x: r2(p.clearance + p.bayWidth * (i + 0.5)), y: r2(depth / 2), rotation: 90 });
  } else if (layout === "em-fila") {
    width = r2(p.bayWidth + 2 * p.clearance);
    depth = r2(cars * p.bayLength + (cars + 1) * p.clearance);
    for (let i = 0; i < cars; i++) bays.push({ x: r2(width / 2), y: r2(p.clearance + p.bayLength * (i + 0.5) + p.clearance * i), rotation: 90 });
    if (cars > 2) notes.push("Mais de 2 veículos em fila: o veículo do fundo fica bloqueado pelos da frente.");
  } else {
    const perRow = Math.ceil(cars / 2);
    width = r2(perRow * p.bayWidth + 2 * p.clearance);
    depth = r2(2 * p.bayLength + p.aisleWidth + 2 * p.clearance);
    for (let i = 0; i < cars; i++) {
      const row = i % 2;
      const col = Math.floor(i / 2);
      bays.push({ x: r2(p.clearance + p.bayWidth * (col + 0.5)), y: r2(row === 0 ? p.clearance + p.bayLength / 2 : depth - p.clearance - p.bayLength / 2), rotation: row === 0 ? 90 : 270 });
    }
    notes.push("Duas fileiras com corredor de manobra de " + p.aisleWidth.toFixed(2).replace(".", ",") + " m.");
  }

  const gateWidthTotal = layout === "em-fila" ? p.bayWidth : width - 2 * p.clearance;
  const gateCount = Math.max(1, Math.ceil(gateWidthTotal / p.maxGateWidth));
  const gw = r2(Math.min(p.maxGateWidth, (gateWidthTotal - 0.1 * (gateCount - 1)) / gateCount));
  const gates = Array.from({ length: gateCount }, (_, i) => ({ x: r2(width / 2 + (i - (gateCount - 1) / 2) * (gw + 0.1)), width: gw }));
  if (gateCount > 1) notes.push(`${gateCount} portões de ${gw.toFixed(2).replace(".", ",")} m (limite por vão de ${p.maxGateWidth.toFixed(2).replace(".", ",")} m).`);

  return { layout, cars, width, depth, area: r2(width * depth), bays, gates, notes };
}

/** Canto oposto da garagem dado o canto de origem e o sentido (+1 = cresce para leste/norte). */
export function garageCorners(origin: Vec2, plan: Pick<GaragePlan, "width" | "depth">): [Vec2, Vec2] {
  return [origin, { x: origin.x + plan.width, y: origin.y + plan.depth }];
}
