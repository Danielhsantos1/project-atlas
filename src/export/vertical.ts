import type { Project } from "../core/model/schema";
import type { Pt } from "./dxf-writer";
import { estimateTextWidth } from "./dxf-writer";
import { dimension, scaleBar } from "./annotations";
import { legendBlock, notesBlock, type LegendSymbol } from "./blocks";
import { fmtLevel } from "./format";
import { HEADING_MM, LAYER, Scene, Sheet, TEXT_MM, type DxfResult, type ResolvedOptions } from "./sheet";

/** Cota de referência (±0,00): piso do pavimento mais baixo. */
export const referenceElevation = (project: Pick<Project, "levels">): number => Math.min(...project.levels.map((l) => l.elevation));

const levelLabel = (project: Pick<Project, "levels">, i: number): string => {
  const ref = referenceElevation(project);
  const l = project.levels[i]!;
  return `${fmtLevel(l.elevation - ref)}  ${l.name}`;
};

/**
 * Acabamento comum de fachadas e cortes: terreno, linhas de nível com cotas
 * (±0,00 no pavimento mais baixo), cadeia vertical de alturas, cota geral
 * horizontal, título, escala gráfica, quadros (legenda e notas) e a prancha.
 *
 * Nesta vista o eixo X do DXF é o eixo horizontal da vista e o eixo Y é a
 * cota Z (metros, absoluta).
 */
export function finishView(args: {
  project: Project;
  o: ResolvedOptions;
  scene: Scene;
  subject: string;
  /** Extensão horizontal do edifício na vista e cota do ponto mais alto. */
  x0: number;
  x1: number;
  zTop: number;
  legend: LegendSymbol[];
  notes: string[];
  warnings: string[];
}): DxfResult {
  const { project, o, scene, x0, x1 } = args;
  const k = o.scale / 1000;
  const th = TEXT_MM * k;
  const ref = referenceElevation(project);
  const A = (x: number, y: number): Pt => ({ x, y });

  // Terreno (nível do solo) e enquadramento.
  scene.line(LAYER.TERRENO, A(x0 - 1.5, ref), A(x1 + 1.5, ref));
  scene.include(A(x0 - 1.5, ref), A(x1 + 1.5, ref), A(x0, args.zTop));

  // Linhas de nível com cotas.
  project.levels.forEach((l, i) => {
    scene.line(LAYER.NIVEIS, A(x0 - 6 * k, l.elevation), A(x1 + 12 * k, l.elevation));
    scene.text(LAYER.NIVEIS, { at: A(x1 + 14 * k, l.elevation), height: th, text: levelLabel(project, i), halign: "left", valign: "middle" });
  });

  // Cadeia vertical (entre níveis até o topo) e total.
  const zs = [...new Set([ref, ...project.levels.map((l) => l.elevation), args.zTop].map((z) => Math.round(z * 1000) / 1000))].filter((z) => z <= args.zTop + 1e-9).sort((a, b) => a - b);
  for (let i = 0; i < zs.length - 1; i++) {
    if (zs[i + 1]! - zs[i]! >= 0.05) dimension(scene, k, A(x0, zs[i]!), A(x0, zs[i + 1]!), { x: -1, y: 0 }, 10 * k);
  }
  dimension(scene, k, A(x0, ref), A(x0, args.zTop), { x: -1, y: 0 }, 18 * k);
  const core = scene.core!;
  dimension(scene, k, A(x0, core.minY), A(x1, core.minY), { x: 0, y: -1 }, 6 * k);

  const labelMm = Math.max(...project.levels.map((_, i) => estimateTextWidth(levelLabel(project, i), TEXT_MM)));
  const blocks = [legendBlock(args.legend), notesBlock(args.notes)];
  const sheet = new Sheet({ project, opts: o, subject: args.subject, core, pad: { l: 30, r: 16 + labelMm, t: 14, b: 42 }, blocks });

  const midX = (x0 + x1) / 2;
  scene.text(LAYER.TEXTO, { at: A(midX, core.minY - 16 * k), height: HEADING_MM * k, text: args.subject, halign: "center", valign: "middle" });
  scene.text(LAYER.TEXTO, { at: A(midX, core.minY - 21.5 * k), height: th, text: `ESCALA 1:${o.scale}`, halign: "center", valign: "middle" });
  scaleBar(scene, k, o.scale, A(core.minX, core.minY - 30 * k));
  return sheet.finish(scene, args.warnings);
}
