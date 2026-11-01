import { HEADING_MM, LAYER, Sheet, type BlockSpec } from "./sheet";

/** Símbolos disponíveis para a LEGENDA. */
export type LegendSymbol =
  | "wall-cut"
  | "door-swing"
  | "door-sliding"
  | "door-opening"
  | "window"
  | "room"
  | "furniture"
  | "structure"
  | "roof-plan"
  | "axis"
  | "wall-elev"
  | "opening-elev"
  | "roof-elev"
  | "level"
  | "hatch"
  | "ground";

export const LEGEND_TEXT: Record<LegendSymbol, string> = {
  "wall-cut": "Parede cortada a 1,20 m",
  "door-swing": "Porta de giro (folha e arco)",
  "door-sliding": "Porta de correr",
  "door-opening": "Vão livre (batentes)",
  window: "Janela (3 linhas)",
  room: "Contorno útil do ambiente",
  furniture: "Mobiliário / objetos",
  structure: "Pilares e vigas",
  "roof-plan": "Projeção da cobertura",
  axis: "Eixo de parede",
  "wall-elev": "Parede (vista)",
  "opening-elev": "Esquadria (vista)",
  "roof-elev": "Cobertura (silhueta)",
  level: "Linha de nível",
  hatch: "Elemento cortado (hachura)",
  ground: "Terreno / nível do solo",
};

const LEG_ROW = 5;

function drawSymbol(s: Sheet, sym: LegendSymbol, x: number, yc: number): void {
  const k = s.k;
  const W = 24;
  switch (sym) {
    case "wall-cut":
      s.rect(LAYER.PAREDES, x, yc - 1.5, x + W, yc + 1.5);
      break;
    case "door-swing":
      s.line(LAYER.PORTAS, x + 4, yc - 2, x + 4, yc + 2.5);
      s.w.arc(LAYER.PORTAS, s.P(x + 4, yc - 2), 4.5 * k, 0, 90, "DASHED");
      s.line(LAYER.PORTAS, x, yc - 2, x + W, yc - 2);
      break;
    case "door-sliding":
      s.line(LAYER.PORTAS, x, yc + 0.6, x + 14, yc + 0.6);
      s.line(LAYER.PORTAS, x + 10, yc - 0.6, x + W, yc - 0.6);
      break;
    case "door-opening":
      s.line(LAYER.PORTAS, x + 2, yc - 2, x + 2, yc + 2, "DASHED");
      s.line(LAYER.PORTAS, x + W - 2, yc - 2, x + W - 2, yc + 2, "DASHED");
      break;
    case "window":
      s.rect(LAYER.JANELAS, x, yc - 1.5, x + W, yc + 1.5);
      s.line(LAYER.JANELAS, x, yc, x + W, yc);
      break;
    case "room":
      s.w.polyline(LAYER.AMBIENTES, [s.P(x, yc - 1.5), s.P(x + W, yc - 1.5), s.P(x + W, yc + 1.5), s.P(x, yc + 1.5)], true, "DASHED");
      break;
    case "furniture":
      s.rect(LAYER.MOBILIARIO, x + 4, yc - 1.5, x + W - 4, yc + 1.5);
      break;
    case "structure":
      s.rect(LAYER.ESTRUTURA, x + 8, yc - 2, x + W - 8, yc + 2);
      break;
    case "roof-plan":
      s.line(LAYER.COBERTURA, x, yc, x + W, yc, "DASHED");
      break;
    case "axis":
      s.line(LAYER.EIXOS, x, yc, x + W, yc, "CENTER");
      break;
    case "wall-elev":
      s.rect(LAYER.PAREDES, x + 2, yc - 2, x + W - 2, yc + 2);
      break;
    case "opening-elev":
      s.rect(LAYER.JANELAS, x + 6, yc - 2, x + W - 6, yc + 2);
      s.rect(LAYER.JANELAS, x + 7.5, yc - 1, x + W - 7.5, yc + 1);
      break;
    case "roof-elev":
      s.w.polyline(LAYER.COBERTURA, [s.P(x, yc - 2), s.P(x + W, yc - 2), s.P(x + W - 5, yc + 2), s.P(x + 5, yc + 2)], true);
      break;
    case "level":
      s.line(LAYER.NIVEIS, x, yc, x + W, yc, "DASHED");
      break;
    case "hatch": {
      s.rect(LAYER.PAREDES, x + 4, yc - 2, x + W - 4, yc + 2);
      for (let i = 0; i < 5; i++) s.line(LAYER.HACHURA, x + 4 + i * 3.2, yc - 2, x + 4 + i * 3.2 + 4, yc + 2);
      break;
    }
    case "ground":
      s.line(LAYER.TERRENO, x, yc, x + W, yc);
      break;
  }
}

export function legendBlock(symbols: LegendSymbol[]): BlockSpec {
  const heightMm = 6 + LEG_ROW * symbols.length + 1;
  return {
    id: "LEGENDA",
    heightMm,
    draw: (s, x, yTop, width) => {
      s.rect(LAYER.QUADROS, x, yTop - heightMm, x + width, yTop);
      s.tx(LAYER.QUADROS, x + 1.5, yTop - 3, "LEGENDA", { h: HEADING_MM, valign: "middle" });
      s.line(LAYER.QUADROS, x, yTop - 6, x + width, yTop - 6);
      symbols.forEach((sym, i) => {
        const yc = yTop - 6 - LEG_ROW * (i + 0.5);
        drawSymbol(s, sym, x + 3, yc);
        s.tx(LAYER.QUADROS, x + 31, yc, LEGEND_TEXT[sym], { valign: "middle" });
      });
    },
  };
}

/** Texto padrão do bloco NOTAS GERAIS, comum a todas as pranchas. */
export const COMMON_NOTES = [
  "Todas as medidas em metros (m); areas em metros quadrados (m²).",
  "As medidas devem ser conferidas em obra antes de qualquer execução.",
  "Estudo preliminar gerado pelo PROJECT ATLAS: geometria indicativa, sem responsável técnico; não substitui projeto executivo nem aprovação em órgãos competentes.",
  "Cotas desenhadas como linhas e textos (não são entidades DIMENSION): não acompanham edições feitas no CAD.",
  "Textos sem acentos (DXF ASCII); formato R12 (AC1009) para máxima compatibilidade.",
];

export const notesBlock = (extra: string[]): BlockSpec => Sheet.notes("NOTAS GERAIS", "NOTAS GERAIS", [...extra, ...COMMON_NOTES]);
