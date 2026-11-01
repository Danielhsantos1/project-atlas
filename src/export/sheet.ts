import type { Project } from "../core/model/schema";
import { DxfWriter, estimateTextWidth, toAscii, type DxfLayerDef, type HAlign, type Pt, type TextSpec, type VAlign } from "./dxf-writer";
import { fmtDate } from "./format";

/**
 * Prancha (folha) comum a plantas, fachadas e cortes: moldura, carimbo,
 * quadros (tabelas), legenda, notas e posicionamento do desenho.
 *
 * REGRA DE ESCALA: a geometria do modelo fica 1:1 em METROS. A folha (moldura,
 * carimbo, tabelas) e as anotações são dimensionadas em "milímetros de papel"
 * multiplicados por k = escala/1000 (metros de modelo por mm de papel). Assim,
 * plotando a 1:escala no papel escolhido, o texto de anotação tem 2,5 mm
 * (altura no modelo = 0,0025 · escala) e a moldura tem exatamente o tamanho da folha.
 * Títulos de quadros usam 3,5 mm.
 */

export type PaperSize = "A4" | "A3" | "A2" | "A1";
export const PAPER_SIZES: readonly PaperSize[] = ["A4", "A3", "A2", "A1"];
/** Folhas em paisagem (mm). */
export const PAPER_MM: Record<PaperSize, { w: number; h: number }> = {
  A4: { w: 297, h: 210 },
  A3: { w: 420, h: 297 },
  A2: { w: 594, h: 420 },
  A1: { w: 841, h: 594 },
};
export const PLOT_SCALES = [50, 75, 100, 125, 200] as const;
export type PlotScale = (typeof PLOT_SCALES)[number];

export interface ExportOptions {
  /** Denominador da escala de plotagem. Padrão 100. */
  scale?: PlotScale;
  /** Folha. Padrão "A3". */
  paper?: PaperSize;
  /** Nome da empresa no carimbo. Padrão: vazio ("não informada"). */
  company?: string;
  /** Obra/projeto no carimbo. Padrão: nome do projeto. */
  projectTitle?: string;
  /** "Desenhado por" no carimbo. Padrão: vazio. */
  drawnBy?: string;
  /** Data do carimbo (entrada explícita ⇒ saída determinística). */
  now: Date;
  /** Desenha mobiliário/objetos de decoração na planta. Padrão true. */
  includeFurniture?: boolean;
  /** Desenha cotas na planta. Padrão true. */
  includeDimensions?: boolean;
  /** Número da prancha ("n" em n/N). Padrão 1. */
  sheetNumber?: number;
  /** Total de pranchas ("N" em n/N). Padrão 1. */
  sheetTotal?: number;
  /** Codificação de texto do DXF. Padrão "ascii" (translitera). */
  textEncoding?: "ascii" | "unicode-escape";
}

export interface ResolvedOptions {
  scale: PlotScale;
  paper: PaperSize;
  company: string;
  projectTitle: string;
  drawnBy: string;
  now: Date;
  includeFurniture: boolean;
  includeDimensions: boolean;
  sheetNumber: number;
  sheetTotal: number;
  textEncoding: "ascii" | "unicode-escape";
}

export function resolveOptions(project: Pick<Project, "name">, o: ExportOptions): ResolvedOptions {
  const scale = o.scale ?? 100;
  if (!PLOT_SCALES.includes(scale)) throw new Error(`Escala inválida: ${String(scale)}. Use ${PLOT_SCALES.join(", ")}.`);
  const paper = o.paper ?? "A3";
  if (!PAPER_SIZES.includes(paper)) throw new Error(`Folha inválida: ${String(paper)}.`);
  if (!(o.now instanceof Date) || Number.isNaN(o.now.getTime())) throw new Error("A opção `now` (Date válido) é obrigatória.");
  return {
    scale,
    paper,
    company: o.company ?? "",
    projectTitle: o.projectTitle ?? project.name,
    drawnBy: o.drawnBy ?? "",
    now: o.now,
    includeFurniture: o.includeFurniture ?? true,
    includeDimensions: o.includeDimensions ?? true,
    sheetNumber: o.sheetNumber ?? 1,
    sheetTotal: o.sheetTotal ?? 1,
    textEncoding: o.textEncoding ?? "ascii",
  };
}

export interface DxfResult {
  dxf: string;
  warnings: string[];
  stats: { entities: number; layers: number };
}

/** Altura do texto de anotação e de títulos de quadro, em mm de papel. */
export const TEXT_MM = 2.5;
export const HEADING_MM = 3.5;
export const ROW_MM = 5;

/** Aviso obrigatório do carimbo (a versão gravada no DXF é a transliterada). */
export const DISCLAIMER = "ESTUDO PRELIMINAR — NÃO VALIDADO POR PROFISSIONAL HABILITADO";
export const DISCLAIMER_2 = "Nao substitui projeto executivo nem aprovacao nos orgaos competentes.";

export const LAYER = {
  PAREDES: "PAREDES",
  PORTAS: "PORTAS",
  JANELAS: "JANELAS",
  PISOS: "PISOS",
  AMBIENTES: "AMBIENTES",
  MOBILIARIO: "MOBILIARIO",
  COTAS: "COTAS",
  TEXTO: "TEXTO",
  EIXOS: "EIXOS",
  ESTRUTURA: "ESTRUTURA",
  TERRENO: "TERRENO",
  CARIMBO: "CARIMBO",
  QUADROS: "QUADROS",
  COBERTURA: "COBERTURA",
  ESCADA: "ESCADA",
  NIVEIS: "NIVEIS",
  HACHURA: "HACHURA",
} as const;

/** Cores ACI pensadas para tabela de plotagem por cor (CTB): R12 não tem espessura por camada. */
export const LAYER_DEFS: DxfLayerDef[] = [
  { name: LAYER.PAREDES, color: 7 },
  { name: LAYER.PORTAS, color: 3 },
  { name: LAYER.JANELAS, color: 5 },
  { name: LAYER.PISOS, color: 8 },
  { name: LAYER.AMBIENTES, color: 4, linetype: "DASHED" },
  { name: LAYER.MOBILIARIO, color: 9 },
  { name: LAYER.COTAS, color: 2 },
  { name: LAYER.TEXTO, color: 7 },
  { name: LAYER.EIXOS, color: 1, linetype: "CENTER" },
  { name: LAYER.ESTRUTURA, color: 6 },
  { name: LAYER.TERRENO, color: 8, linetype: "DASHED" },
  { name: LAYER.CARIMBO, color: 7 },
  { name: LAYER.QUADROS, color: 7 },
  { name: LAYER.COBERTURA, color: 30, linetype: "DASHED" },
  { name: LAYER.ESCADA, color: 6 },
  { name: LAYER.NIVEIS, color: 5, linetype: "DASHED" },
  { name: LAYER.HACHURA, color: 8 },
];

export interface Bounds2 {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Acumula operações de desenho em coordenadas do MODELO; reproduzidas depois no escritor. */
export class Scene {
  private readonly ops: Array<(w: DxfWriter) => void> = [];
  core: Bounds2 | null = null;

  /** Marca pontos como "conteúdo" que determina o enquadramento da prancha. */
  include(...pts: Pt[]): void {
    for (const p of pts) {
      if (!this.core) this.core = { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y };
      else {
        this.core.minX = Math.min(this.core.minX, p.x);
        this.core.minY = Math.min(this.core.minY, p.y);
        this.core.maxX = Math.max(this.core.maxX, p.x);
        this.core.maxY = Math.max(this.core.maxY, p.y);
      }
    }
  }
  line(layer: string, a: Pt, b: Pt, lt?: string): void {
    this.ops.push((w) => w.line(layer, a, b, lt));
  }
  poly(layer: string, pts: readonly Pt[], closed: boolean, lt?: string): void {
    this.ops.push((w) => w.polyline(layer, pts, closed, lt));
  }
  circle(layer: string, c: Pt, r: number, lt?: string): void {
    this.ops.push((w) => w.circle(layer, c, r, lt));
  }
  arc(layer: string, c: Pt, r: number, s: number, e: number, lt?: string): void {
    this.ops.push((w) => w.arc(layer, c, r, s, e, lt));
  }
  text(layer: string, spec: TextSpec): void {
    this.ops.push((w) => w.text(layer, spec));
  }
  solid(layer: string, p1: Pt, p2: Pt, p3: Pt, p4?: Pt): void {
    this.ops.push((w) => w.solid(layer, p1, p2, p3, p4));
  }
  get size(): number {
    return this.ops.length;
  }
  flush(w: DxfWriter): void {
    for (const op of this.ops) op(w);
  }
}

/** Bloco (quadro) do painel lateral. Desenha-se em mm de papel, a partir do canto superior esquerdo. */
export interface BlockSpec {
  id: string;
  heightMm: number;
  draw: (sheet: Sheet, xMm: number, yTopMm: number, widthMm: number) => void;
}

export interface SheetParams {
  project: Pick<Project, "name">;
  opts: ResolvedOptions;
  /** Texto do campo ASSUNTO do carimbo, ex.: "PLANTA BAIXA — TÉRREO". */
  subject: string;
  /** Enquadramento do conteúdo em coordenadas do modelo (null = vazio). */
  core: Bounds2 | null;
  /** Folga reservada para anotações ao redor do conteúdo (mm de papel). */
  pad: { l: number; r: number; t: number; b: number };
  blocks: BlockSpec[];
}

const INNER = { left: 20, right: 10, top: 10, bottom: 10 };
const COL_W = 120;
const GAP = 4;
const TB_ROWS_MM = ROW_MM * 10 + 10;

export class Sheet {
  readonly w: DxfWriter;
  readonly k: number;
  readonly warnings: string[] = [];
  readonly paperW: number;
  readonly paperH: number;
  /** Modelo ↔ papel: ponto do papel (0,0) em coordenadas do modelo. */
  readonly ox: number;
  readonly oy: number;
  /** Área livre para o desenho (mm de papel). */
  readonly draw: { x0: number; y0: number; x1: number; y1: number };
  readonly inner: { x0: number; y0: number; x1: number; y1: number };

  constructor(readonly params: SheetParams) {
    const { opts } = params;
    this.k = opts.scale / 1000;
    const paper = PAPER_MM[opts.paper];
    this.paperW = paper.w;
    this.paperH = paper.h;
    this.w = new DxfWriter({ textEncoding: opts.textEncoding, linetypeUnit: this.k });
    for (const l of LAYER_DEFS) this.w.addLayer(l);

    this.inner = { x0: INNER.left, y0: INNER.bottom, x1: paper.w - INNER.right, y1: paper.h - INNER.top };

    // ---- Distribuição do painel lateral (colunas da direita para a esquerda) ----
    const placed: Array<{ block: BlockSpec; x: number; yTop: number }> = [];
    let col = 0;
    let curTop = this.inner.y1;
    let limit = this.inner.y0 + TB_ROWS_MM + GAP;
    let firstInCol = true;
    for (const b of params.blocks) {
      if (!firstInCol && curTop - b.heightMm < limit) {
        col++;
        curTop = this.inner.y1;
        limit = this.inner.y0;
        firstInCol = true;
      }
      if (curTop - b.heightMm < limit) this.warnings.push(`O quadro "${b.id}" (${b.heightMm.toFixed(0)} mm) nao cabe na altura da folha ${opts.paper}; use folha maior.`);
      placed.push({ block: b, x: this.inner.x1 - (col + 1) * COL_W - col * GAP, yTop: curTop });
      curTop -= b.heightMm + GAP;
      firstInCol = false;
    }
    const cols = col + 1;
    const panelLeft = this.inner.x1 - cols * COL_W - (cols - 1) * GAP;
    this.draw = { x0: this.inner.x0 + GAP, y0: this.inner.y0 + GAP, x1: panelLeft - GAP, y1: this.inner.y1 - GAP };

    // ---- Posicionamento do desenho (centralizado na área livre) ----
    const availW = this.draw.x1 - this.draw.x0;
    const availH = this.draw.y1 - this.draw.y0;
    const core = params.core ?? { minX: 0, minY: 0, maxX: 1, maxY: 1 };
    const needW = (core.maxX - core.minX) / this.k + params.pad.l + params.pad.r;
    const needH = (core.maxY - core.minY) / this.k + params.pad.b + params.pad.t;
    if (availW <= 20) this.warnings.push(`O painel de quadros ocupa quase toda a folha ${opts.paper}; use folha maior.`);
    if (needW > availW + 1e-6 || needH > availH + 1e-6) {
      this.warnings.push(
        `O desenho (${needW.toFixed(0)} x ${needH.toFixed(0)} mm com cotas) nao cabe na area livre da folha ${opts.paper} (${availW.toFixed(0)} x ${availH.toFixed(0)} mm) na escala 1:${opts.scale}; use escala menor ou folha maior.`,
      );
    }
    const px = this.draw.x0 + (availW - needW) / 2 + params.pad.l;
    const py = this.draw.y0 + (availH - needH) / 2 + params.pad.b;
    this.ox = core.minX - px * this.k;
    this.oy = core.minY - py * this.k;

    // ---- Moldura, quadros e carimbo ----
    this.rect(LAYER.CARIMBO, 0, 0, paper.w, paper.h);
    this.rect(LAYER.CARIMBO, this.inner.x0, this.inner.y0, this.inner.x1, this.inner.y1);
    for (const p of placed) p.block.draw(this, p.x, p.yTop, COL_W);
    this.titleBlock(this.inner.x1 - COL_W, this.inner.y0, COL_W);
  }

  /** Ponto do papel (mm) → coordenadas do modelo. */
  P(xMm: number, yMm: number): Pt {
    return { x: this.ox + xMm * this.k, y: this.oy + yMm * this.k };
  }

  /** Modelo → papel (mm). */
  toPaper(p: Pt): Pt {
    return { x: (p.x - this.ox) / this.k, y: (p.y - this.oy) / this.k };
  }

  line(layer: string, x0: number, y0: number, x1: number, y1: number, lt?: string): void {
    this.w.line(layer, this.P(x0, y0), this.P(x1, y1), lt);
  }

  rect(layer: string, x0: number, y0: number, x1: number, y1: number): void {
    this.w.polyline(layer, [this.P(x0, y0), this.P(x1, y0), this.P(x1, y1), this.P(x0, y1)], true);
  }

  /** Texto em mm de papel (altura em mm de papel; padrão 2,5). */
  tx(layer: string, xMm: number, yMm: number, text: string, o: { h?: number; halign?: HAlign; valign?: VAlign } = {}): void {
    this.w.text(layer, { at: this.P(xMm, yMm), height: (o.h ?? TEXT_MM) * this.k, text, halign: o.halign, valign: o.valign });
  }

  /** Largura estimada (mm de papel) do texto com a altura dada em mm. */
  static textWidthMm(text: string, hMm = TEXT_MM): number {
    return estimateTextWidth(text, hMm);
  }

  private fit(text: string, widthMm: number, what: string): string {
    const t = toAscii(text);
    const max = Math.max(1, Math.floor(widthMm / (TEXT_MM * 0.7)));
    if (t.length <= max) return t;
    this.warnings.push(`Texto truncado no carimbo/quadro (${what}): "${t}".`);
    return t.slice(0, Math.max(1, max - 1)) + ".";
  }

  /** Texto de célula/linha com truncamento avisado. */
  cell(text: string, widthMm: number, what: string): string {
    return this.fit(text, widthMm, what);
  }

  private titleBlock(x: number, y0: number, width: number): void {
    const o = this.params.opts;
    const L = LAYER.CARIMBO;
    const top = y0 + TB_ROWS_MM;
    this.rect(L, x, y0, x + width, top);
    let y = top;
    const row = (label: string, value: string, h = ROW_MM) => {
      y -= h;
      this.line(L, x, y, x + width, y);
      const avail = width - 3;
      this.tx(L, x + 1.5, y + h / 2, this.fit(`${label}${value}`, avail, label.trim()), { valign: "middle" });
    };
    row("EMPRESA: ", o.company || "(nao informada)");
    row("OBRA / PROJETO: ", o.projectTitle);
    row("ASSUNTO: ", this.params.subject);
    // ESCALA | DATA | PRANCHA
    y -= ROW_MM;
    this.line(L, x, y, x + width, y);
    const third = width / 3;
    this.line(L, x + third, y, x + third, y + ROW_MM);
    this.line(L, x + 2 * third, y, x + 2 * third, y + ROW_MM);
    this.tx(L, x + 1.5, y + ROW_MM / 2, `ESCALA: 1:${o.scale}`, { valign: "middle" });
    this.tx(L, x + third + 1.5, y + ROW_MM / 2, `DATA: ${fmtDate(o.now)}`, { valign: "middle" });
    this.tx(L, x + 2 * third + 1.5, y + ROW_MM / 2, `PRANCHA: ${o.sheetNumber}/${o.sheetTotal}`, { valign: "middle" });
    row("DESENHADO POR: ", o.drawnBy);
    // Aviso obrigatório (2 linhas).
    y -= ROW_MM;
    this.line(L, x, y, x + width, y);
    this.tx(L, x + 1.5, y + ROW_MM / 2, DISCLAIMER, { valign: "middle" });
    y -= ROW_MM;
    this.line(L, x, y, x + width, y);
    this.tx(L, x + 1.5, y + ROW_MM / 2, DISCLAIMER_2, { valign: "middle" });
    // Campos de responsabilidade técnica: SEMPRE em branco (rótulo + linha para preenchimento manual).
    const blank = (label: string, h = ROW_MM) => {
      y -= h;
      this.line(L, x, y, x + width, y);
      this.tx(L, x + 1.5, y + h / 2, label, { valign: "middle" });
      const startX = x + 1.5 + Sheet.textWidthMm(label) + 2;
      this.line(L, startX, y + 1.2, x + width - 2, y + 1.2);
    };
    blank("Responsável técnico:");
    blank("CREA/CAU:");
    blank("ART/RRT nº:");
    blank("Assinatura:", 10);
  }

  /** Quadros genéricos: tabela com título, cabeçalho, linhas e rodapé opcional. */
  static table(
    id: string,
    title: string,
    cols: Array<{ header: string; widthMm: number; align?: "left" | "right" | "center" }>,
    rows: string[][],
    footer: string[][] = [],
  ): BlockSpec {
    const heightMm = 6 + ROW_MM * (1 + rows.length + footer.length);
    return {
      id,
      heightMm,
      draw: (s, x, yTop, width) => {
        const L = LAYER.QUADROS;
        const total = cols.reduce((a, c) => a + c.widthMm, 0);
        const sc = total > width ? width / total : 1; // nunca ultrapassa o painel
        if (sc < 1) s.warnings.push(`Colunas do quadro "${title}" comprimidas para caber no painel.`);
        const widths = cols.map((c) => c.widthMm * sc);
        s.rect(L, x, yTop - heightMm, x + Math.min(total, width), yTop);
        s.tx(L, x + 1.5, yTop - 3, title, { h: HEADING_MM, valign: "middle" });
        const all = [cols.map((c) => c.header), ...rows, ...footer];
        let y = yTop - 6;
        all.forEach((r) => {
          s.line(L, x, y, x + Math.min(total, width), y);
          let cx = x;
          r.forEach((txt, ci) => {
            const cw = widths[ci] ?? 0;
            const col = cols[ci]!;
            const t = s.cell(txt, cw - 3, `${title}/${col.header}`);
            const align = col.align ?? "left";
            const tx = align === "left" ? cx + 1.5 : align === "right" ? cx + cw - 1.5 : cx + cw / 2;
            s.tx(L, tx, y - ROW_MM / 2, t, { valign: "middle", halign: align });
            cx += cw;
          });
          y -= ROW_MM;
        });
        let vx = x;
        for (let i = 0; i < widths.length - 1; i++) {
          vx += widths[i]!;
          s.line(L, vx, yTop - 6, vx, yTop - heightMm);
        }
      },
    };
  }

  /** Quadro de texto corrido (notas): linhas já quebradas. */
  static notes(id: string, title: string, items: string[]): BlockSpec {
    const maxChars = Math.floor((COL_W - 6) / (TEXT_MM * 0.7));
    const lines: string[] = [];
    items.forEach((raw, i) => {
      let cur = `${i + 1}.`;
      for (const wd of toAscii(raw).split(" ")) {
        if (cur.length + 1 + wd.length > maxChars) {
          lines.push(cur);
          cur = `   ${wd}`;
        } else cur += ` ${wd}`;
      }
      lines.push(cur);
    });
    const heightMm = 6 + ROW_MM * lines.length + 1;
    return {
      id,
      heightMm,
      draw: (s, x, yTop, width) => {
        s.rect(LAYER.QUADROS, x, yTop - heightMm, x + width, yTop);
        s.tx(LAYER.QUADROS, x + 1.5, yTop - 3, title, { h: HEADING_MM, valign: "middle" });
        s.line(LAYER.QUADROS, x, yTop - 6, x + width, yTop - 6);
        lines.forEach((l, i) => s.tx(LAYER.QUADROS, x + 1.5, yTop - 6 - ROW_MM * (i + 0.5) - 0.5, l, { valign: "middle" }));
      },
    };
  }

  /** Finaliza: reproduz a cena no escritor e devolve o resultado. */
  finish(scene: Scene, extraWarnings: string[] = []): DxfResult {
    scene.flush(this.w);
    return {
      dxf: this.w.toString(),
      warnings: [...this.warnings, ...extraWarnings],
      stats: { entities: this.w.entityCount, layers: this.w.layerNames.length },
    };
  }
}
