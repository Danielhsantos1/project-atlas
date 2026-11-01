/**
 * Escritor DXF ASCII mínimo e determinístico.
 *
 * ESCOLHA DE VERSÃO: AC1009 (AutoCAD R12). Motivos: (1) é o dialeto mais
 * universal (AutoCAD de qualquer época, LibreCAD, QCAD, DraftSight, BricsCAD,
 * Autodesk Viewer, visualizadores web); (2) não exige HANDLEs, CLASSES nem
 * OBJECTS — menos chances de erro estrutural; (3) as entidades de que
 * precisamos (LINE, POLYLINE/VERTEX/SEQEND, CIRCLE, ARC, TEXT, SOLID) existem
 * desde o R12. Custos aceitos: sem LWPOLYLINE, sem espessuras de linha
 * (lineweight) por camada, sem Unicode nativo (ver "Texto" abaixo) e sem
 * HATCH/DIMENSION modernos. A espessura de plotagem deve ser dada por tabela
 * de estilos (CTB) por COR — as cores de camada foram escolhidas para isso.
 *
 * $INSUNITS e $MEASUREMENT: nascem no R13/R14+, portanto NÃO são variáveis
 * oficiais do R12. São gravados mesmo assim porque leitores as ignoram quando
 * desconhecidas e os que as conhecem passam a tratar o desenho como metros
 * métricos. Isto NÃO foi testado no AutoCAD real (apenas dxf-parser + validador
 * estrutural próprio).
 *
 * TEXTO: o R12 não tem Unicode. Duas estratégias existem: a sequência
 * `\U+00E7` (só AutoCAD/ODA a decodificam — outros visualizadores mostram a
 * barra literal) ou TRANSLITERAR para ASCII. Decisão (padrão): transliterar
 * ("Suíte" → "Suite", "m²" → "m2", "—" → "-"), porque é a única forma que
 * qualquer visualizador exibe corretamente. A opção `textEncoding:
 * "unicode-escape"` existe para quem só usa AutoCAD. Em ambos os casos NENHUM
 * byte fora de ASCII imprimível é emitido (garantido por teste).
 *
 * NÚMEROS: sempre 6 casas decimais fixas, nunca notação científica.
 */

export interface Pt {
  x: number;
  y: number;
}

export type TextEncoding = "ascii" | "unicode-escape";
export type HAlign = "left" | "center" | "right";
export type VAlign = "baseline" | "bottom" | "middle" | "top";

export interface DxfWriterOptions {
  textEncoding?: TextEncoding;
  /** Metros de modelo por milímetro de papel — dimensiona os padrões de traço dos tipos de linha. */
  linetypeUnit?: number;
}

export interface DxfLayerDef {
  name: string;
  /** Cor ACI (1–255). */
  color: number;
  linetype?: "CONTINUOUS" | "DASHED" | "CENTER";
}

export interface TextSpec {
  at: Pt;
  height: number;
  text: string;
  rotation?: number;
  halign?: HAlign;
  valign?: VAlign;
  linetype?: string;
}

export interface Extents {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Largura média de um caractere em relação à altura do texto (estimativa conservadora para fontes de CAD). */
export const CHAR_WIDTH_FACTOR = 0.7;

export const estimateTextWidth = (text: string, height: number): number => toAscii(text).length * height * CHAR_WIDTH_FACTOR;

const SPECIAL_MAP: Record<string, string> = {
  "²": "2",
  "³": "3",
  "¹": "1",
  "º": "o",
  "ª": "a",
  "°": "o",
  "×": "x",
  "—": "-",
  "–": "-",
  "−": "-",
  "±": "+/-",
  "·": "-",
  "•": "-",
  "≈": "~",
  "≤": "<=",
  "≥": ">=",
  "“": '"',
  "”": '"',
  "‘": "'",
  "’": "'",
  "…": "...",
  "ø": "o",
  "Ø": "O",
  "ß": "ss",
  "æ": "ae",
  "Æ": "AE",
  "œ": "oe",
  "Œ": "OE",
  "→": "->",
  "←": "<-",
  " ": " ",
};

/** Transliteração para ASCII imprimível (32–126). Controles viram espaço; desconhecidos viram "?". */
export function toAscii(input: string): string {
  let out = "";
  for (const ch of input.normalize("NFC")) {
    const mapped = SPECIAL_MAP[ch];
    if (mapped !== undefined) {
      out += mapped;
      continue;
    }
    const code = ch.codePointAt(0)!;
    if (code >= 32 && code <= 126) {
      out += ch;
      continue;
    }
    if (code < 32 || code === 127) {
      out += " ";
      continue;
    }
    const base = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
    out += /^[\x20-\x7e]+$/.test(base) ? base : "?";
  }
  return out;
}

function escapeUnicode(input: string): string {
  let out = "";
  for (const ch of input.normalize("NFC")) {
    const code = ch.codePointAt(0)!;
    if (code >= 32 && code <= 126) out += ch;
    else if (code < 32 || code === 127) out += " ";
    else if (code > 0xffff) {
      const s = String.fromCodePoint(code);
      for (let i = 0; i < s.length; i++) out += `\\U+${s.charCodeAt(i).toString(16).toUpperCase().padStart(4, "0")}`;
    } else out += `\\U+${code.toString(16).toUpperCase().padStart(4, "0")}`;
  }
  return out;
}

/** Número DXF: 6 casas fixas, sem notação científica e sem "-0". */
export function dxfNum(v: number): string {
  if (!Number.isFinite(v)) throw new Error(`Coordenada DXF não finita: ${v}`);
  const s = v.toFixed(6);
  return s === "-0.000000" ? "0.000000" : s;
}

const H_CODE: Record<HAlign, number> = { left: 0, center: 1, right: 2 };
const V_CODE: Record<VAlign, number> = { baseline: 0, bottom: 1, middle: 2, top: 3 };

const normDeg = (a: number): number => {
  const r = a % 360;
  return r < 0 ? r + 360 : r;
};

export class DxfWriter {
  private readonly layers = new Map<string, DxfLayerDef>();
  private readonly body: string[] = [];
  private count = 0;
  private ext: Extents | null = null;
  private readonly encoding: TextEncoding;
  private readonly ltUnit: number;

  constructor(opts: DxfWriterOptions = {}) {
    this.encoding = opts.textEncoding ?? "ascii";
    this.ltUnit = opts.linetypeUnit ?? 0.001;
    this.layers.set("0", { name: "0", color: 7, linetype: "CONTINUOUS" });
  }

  addLayer(def: DxfLayerDef): void {
    const name = DxfWriter.layerName(def.name);
    this.layers.set(name, { ...def, name });
  }

  static layerName(name: string): string {
    return toAscii(name).toUpperCase().replace(/[^A-Z0-9_$-]/g, "_");
  }

  get entityCount(): number {
    return this.count;
  }

  get layerNames(): string[] {
    return [...this.layers.keys()];
  }

  get extents(): Extents | null {
    return this.ext ? { ...this.ext } : null;
  }

  private grow(x: number, y: number): void {
    if (!this.ext) this.ext = { minX: x, minY: y, maxX: x, maxY: y };
    else {
      this.ext.minX = Math.min(this.ext.minX, x);
      this.ext.minY = Math.min(this.ext.minY, y);
      this.ext.maxX = Math.max(this.ext.maxX, x);
      this.ext.maxY = Math.max(this.ext.maxY, y);
    }
  }

  private head(type: string, layer: string, linetype?: string): string[] {
    const name = DxfWriter.layerName(layer);
    if (!this.layers.has(name)) throw new Error(`Camada DXF não declarada: ${name}`);
    this.count++;
    const g = ["0", type, "8", name];
    if (linetype) g.push("6", linetype);
    return g;
  }

  private push(group: string[]): void {
    this.body.push(group.join("\n"));
  }

  line(layer: string, a: Pt, b: Pt, linetype?: string): void {
    const g = this.head("LINE", layer, linetype);
    g.push("10", dxfNum(a.x), "20", dxfNum(a.y), "30", "0.000000", "11", dxfNum(b.x), "21", dxfNum(b.y), "31", "0.000000");
    this.grow(a.x, a.y);
    this.grow(b.x, b.y);
    this.push(g);
  }

  /** POLYLINE 2D com VERTEX/SEQEND; `closed` liga o bit 1 do código 70. */
  polyline(layer: string, pts: readonly Pt[], closed: boolean, linetype?: string): void {
    if (pts.length < 2) return;
    const g = this.head("POLYLINE", layer, linetype);
    g.push("66", "1", "10", "0.000000", "20", "0.000000", "30", "0.000000", "70", closed ? "1" : "0");
    const name = DxfWriter.layerName(layer);
    for (const p of pts) {
      g.push("0", "VERTEX", "8", name, "10", dxfNum(p.x), "20", dxfNum(p.y), "30", "0.000000");
      this.grow(p.x, p.y);
    }
    g.push("0", "SEQEND", "8", name);
    this.push(g);
  }

  circle(layer: string, c: Pt, r: number, linetype?: string): void {
    const g = this.head("CIRCLE", layer, linetype);
    g.push("10", dxfNum(c.x), "20", dxfNum(c.y), "30", "0.000000", "40", dxfNum(r));
    this.grow(c.x - r, c.y - r);
    this.grow(c.x + r, c.y + r);
    this.push(g);
  }

  /** Arco anti-horário de `startDeg` a `endDeg`. */
  arc(layer: string, c: Pt, r: number, startDeg: number, endDeg: number, linetype?: string): void {
    const s = normDeg(startDeg);
    const e = normDeg(endDeg);
    const g = this.head("ARC", layer, linetype);
    g.push("10", dxfNum(c.x), "20", dxfNum(c.y), "30", "0.000000", "40", dxfNum(r), "50", dxfNum(s), "51", dxfNum(e));
    const pointAt = (deg: number) => this.grow(c.x + r * Math.cos((deg * Math.PI) / 180), c.y + r * Math.sin((deg * Math.PI) / 180));
    pointAt(s);
    pointAt(e);
    const sweep = normDeg(e - s) || 360;
    for (const card of [0, 90, 180, 270]) if (normDeg(card - s) <= sweep) pointAt(card);
    this.push(g);
  }

  /** SOLID (triângulo/quadrilátero preenchido). Ordem DXF dos vértices: 1, 2, 4, 3. */
  solid(layer: string, p1: Pt, p2: Pt, p3: Pt, p4?: Pt): void {
    // O chamador informa os vértices em ordem de perímetro; o DXF espera 1, 2, 4, 3.
    const third = p4 ?? p3;
    const fourth = p3;
    const g = this.head("SOLID", layer);
    g.push(
      "10", dxfNum(p1.x), "20", dxfNum(p1.y), "30", "0.000000",
      "11", dxfNum(p2.x), "21", dxfNum(p2.y), "31", "0.000000",
      "12", dxfNum(third.x), "22", dxfNum(third.y), "32", "0.000000",
      "13", dxfNum(fourth.x), "23", dxfNum(fourth.y), "33", "0.000000",
    );
    for (const p of [p1, p2, p3, third]) this.grow(p.x, p.y);
    this.push(g);
  }

  encodeText(text: string): string {
    const t = this.encoding === "ascii" ? toAscii(text) : escapeUnicode(text);
    // "%%" é prefixo de códigos de controle do AutoCAD (%%d, %%p, %%c, %%u...).
    return t.replace(/%%/g, "% %").slice(0, 250);
  }

  /**
   * TEXT. Justificação ≠ esquerda/linha-base usa 72/73 e o 2º ponto de alinhamento (11/21/31),
   * que é o ponto realmente usado pelos leitores nesses casos.
   */
  text(layer: string, spec: TextSpec): void {
    const raw = spec.text;
    if (raw.trim() === "") return;
    const enc = this.encodeText(raw);
    const h = spec.height;
    const ha = spec.halign ?? "left";
    const va = spec.valign ?? "baseline";
    const rot = spec.rotation ?? 0;
    const g = this.head("TEXT", layer, spec.linetype);
    g.push("10", dxfNum(spec.at.x), "20", dxfNum(spec.at.y), "30", "0.000000", "40", dxfNum(h), "1", enc);
    if (rot !== 0) g.push("50", dxfNum(normDeg(rot)));
    g.push("7", "STANDARD");
    if (ha !== "left" || va !== "baseline") {
      g.push("72", String(H_CODE[ha]), "11", dxfNum(spec.at.x), "21", dxfNum(spec.at.y), "31", "0.000000", "73", String(V_CODE[va]));
    }
    // Extensão estimada da caixa do texto (largura conservadora).
    const w = estimateTextWidth(raw, h);
    const x0 = ha === "left" ? 0 : ha === "center" ? -w / 2 : -w;
    const y0 = va === "baseline" || va === "bottom" ? 0 : va === "middle" ? -h / 2 : -h;
    const r = (rot * Math.PI) / 180;
    const c = Math.cos(r);
    const s = Math.sin(r);
    for (const [lx, ly] of [
      [x0, y0],
      [x0 + w, y0],
      [x0 + w, y0 + h],
      [x0, y0 + h],
    ] as const) {
      this.grow(spec.at.x + lx * c - ly * s, spec.at.y + lx * s + ly * c);
    }
    this.push(g);
  }

  /** Texto completo do arquivo DXF. */
  toString(): string {
    const ext = this.ext ?? { minX: 0, minY: 0, maxX: 1, maxY: 1 };
    const u = this.ltUnit;
    const out: string[] = [];
    const sec = (name: string, content: string[]) => out.push("0", "SECTION", "2", name, ...content, "0", "ENDSEC");

    sec("HEADER", [
      "9", "$ACADVER", "1", "AC1009",
      "9", "$DWGCODEPAGE", "3", "ANSI_1252",
      "9", "$INSBASE", "10", "0.000000", "20", "0.000000", "30", "0.000000",
      "9", "$EXTMIN", "10", dxfNum(ext.minX), "20", dxfNum(ext.minY), "30", "0.000000",
      "9", "$EXTMAX", "10", dxfNum(ext.maxX), "20", dxfNum(ext.maxY), "30", "0.000000",
      "9", "$LIMMIN", "10", dxfNum(ext.minX), "20", dxfNum(ext.minY),
      "9", "$LIMMAX", "10", dxfNum(ext.maxX), "20", dxfNum(ext.maxY),
      "9", "$LTSCALE", "40", "1.000000",
      "9", "$MEASUREMENT", "70", "1",
      "9", "$INSUNITS", "70", "6",
    ]);

    // Padrões de traço proporcionais ao papel: traço 6 mm / vazio 3 mm etc. no papel.
    const dash = (mm: number) => dxfNum(mm * u);
    const ltype = (name: string, desc: string, elements: number[]) => [
      "0", "LTYPE", "2", name, "70", "0", "3", desc, "72", "65", "73", String(elements.length),
      "40", dash(elements.reduce((s, e) => s + Math.abs(e), 0)),
      ...elements.flatMap((e) => ["49", dash(e)]),
    ];
    const layerRecs = [...this.layers.values()].flatMap((l) => ["0", "LAYER", "2", l.name, "70", "0", "62", String(l.color), "6", l.linetype ?? "CONTINUOUS"]);
    sec("TABLES", [
      "0", "TABLE", "2", "LTYPE", "70", "3",
      ...ltype("CONTINUOUS", "Solid line", []),
      ...ltype("DASHED", "Dashed", [6, -3]),
      ...ltype("CENTER", "Center", [20, -3, 3, -3]),
      "0", "ENDTAB",
      "0", "TABLE", "2", "LAYER", "70", String(this.layers.size),
      ...layerRecs,
      "0", "ENDTAB",
      "0", "TABLE", "2", "STYLE", "70", "1",
      "0", "STYLE", "2", "STANDARD", "70", "0", "40", "0.000000", "41", "1.000000", "50", "0.000000", "71", "0", "42", "2.500000", "3", "txt",
      "0", "ENDTAB",
    ]);
    sec("BLOCKS", []);
    sec("ENTITIES", this.body.flatMap((b) => b.split("\n")));
    out.push("0", "EOF");
    return out.join("\n") + "\n";
  }
}
