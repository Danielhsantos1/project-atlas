import type { Project } from "../core/model/schema";
import { isRoom, isWall } from "../core/model/schema";
import { roomShape } from "../core/geometry/rooms";
import { buildElevationDxf, VIEWS, type ElevationSide } from "./elevation-dxf";
import { fmtNum } from "./format";
import { buildPlanDxf } from "./plan-dxf";
import { buildSectionDxf } from "./section-dxf";
import { PAPER_SIZES, type DxfResult, type ExportOptions, type PaperSize } from "./sheet";
import { toAscii } from "./dxf-writer";

export interface SheetSetOptions extends Omit<ExportOptions, "paper" | "sheetNumber" | "sheetTotal"> {
  /** Folha única para todo o conjunto; "auto" (padrão) escolhe a MENOR folha em que tudo cabe. */
  paper?: PaperSize | "auto";
}

export interface SheetOutput {
  name: string;
  filename: string;
  dxf: string;
  warnings: string[];
}

const slug = (s: string): string =>
  toAscii(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "pavimento";

/** Centro (X, Y) da caixa dos ambientes fechados; se não houver ambientes, das paredes; senão do terreno. */
export function buildingCentre(project: Project): { x: number; y: number } {
  const pts: Array<{ x: number; y: number }> = [];
  for (const level of project.levels) {
    const walls = project.elements.filter(isWall).filter((w) => w.levelId === level.id);
    for (const r of project.elements.filter(isRoom)) {
      if (r.levelId !== level.id) continue;
      const s = roomShape(walls, r.seed);
      if (s) pts.push(...s.axis);
    }
  }
  if (pts.length === 0) for (const w of project.elements.filter(isWall)) pts.push(w.start, w.end);
  if (pts.length === 0) return { x: project.site.width / 2, y: project.site.depth / 2 };
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
}

type Job = { name: string; file: string; run: (o: ExportOptions) => DxfResult };

const overflow = (r: DxfResult): boolean => r.warnings.some((w) => /nao cabe|ocupa quase toda/.test(w));

/**
 * Conjunto de pranchas: planta de cada pavimento (do mais baixo ao mais alto),
 * 4 fachadas, corte longitudinal (plano Y no centro da edificação) e corte
 * transversal (plano X no centro), numerados "n/N".
 */
export function buildSheetSet(project: Project, options: SheetSetOptions): SheetOutput[] {
  const levels = [...project.levels].sort((a, b) => a.elevation - b.elevation);
  const c = buildingCentre(project);
  const jobs: Job[] = [
    ...levels.map((l): Job => ({ name: `Planta baixa — ${l.name}`, file: `planta-${slug(l.name)}`, run: (o) => buildPlanDxf(project, l.id, o) })),
    ...(["front", "back", "left", "right"] as ElevationSide[]).map(
      (s): Job => ({ name: VIEWS[s].title.charAt(0) + VIEWS[s].title.slice(1).toLowerCase(), file: `fachada-${{ front: "frontal", back: "posterior", left: "lateral-esquerda", right: "lateral-direita" }[s]}`, run: (o) => buildElevationDxf(project, s, o) }),
    ),
    { name: `Corte longitudinal — Y = ${fmtNum(c.y)} m`, file: "corte-longitudinal", run: (o) => buildSectionDxf(project, "y", c.y, o) },
    { name: `Corte transversal — X = ${fmtNum(c.x)} m`, file: "corte-transversal", run: (o) => buildSectionDxf(project, "x", c.x, o) },
  ];
  const total = jobs.length;
  const base = (i: number, paper: PaperSize): ExportOptions => ({ ...options, paper, sheetNumber: i + 1, sheetTotal: total });

  let paper: PaperSize;
  if (options.paper && options.paper !== "auto") paper = options.paper;
  else {
    let idx = 0;
    jobs.forEach((j, i) => {
      let p = idx;
      while (p < PAPER_SIZES.length - 1 && overflow(j.run(base(i, PAPER_SIZES[p]!)))) p++;
      idx = Math.max(idx, p);
    });
    paper = PAPER_SIZES[idx]!;
  }

  return jobs.map((j, i) => {
    const r = j.run(base(i, paper));
    return { name: j.name, filename: `${String(i + 1).padStart(2, "0")}-${j.file}.dxf`, dxf: r.dxf, warnings: r.warnings };
  });
}
