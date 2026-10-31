import { z } from "zod";
import { ProjectCategorySchema, ProjectStatusSchema, type Project } from "@/core/model/schema";
import { floorCorners, objectCorners, projectBounds } from "@/core/geometry/shapes";

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Resumo de projeto mantido no índice: permite listar e desenhar miniaturas
 * de planta sem carregar todos os projetos. A miniatura é DERIVADA da
 * geometria (não é uma imagem armazenada).
 */
export const ProjectSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  category: ProjectCategorySchema,
  status: ProjectStatusSchema,
  favorite: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  site: z.object({ width: z.number(), depth: z.number() }),
  elementCount: z.number().int().nonnegative(),
  preview: z.object({
    bounds: z.object({ minX: z.number(), minY: z.number(), maxX: z.number(), maxY: z.number() }).nullable(),
    /** [x1, y1, x2, y2, espessura] */
    walls: z.array(z.array(z.number())),
    /** Polígonos achatados [x1, y1, x2, y2, ...] */
    floors: z.array(z.array(z.number())),
    objects: z.array(z.array(z.number())),
  }),
});
export type ProjectSummary = z.infer<typeof ProjectSummarySchema>;

export function buildSummary(project: Project): ProjectSummary {
  const b = projectBounds(project);
  const flat = (pts: Array<{ x: number; y: number }>) => pts.flatMap((p) => [r2(p.x), r2(p.y)]);
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    category: project.category,
    status: project.status,
    favorite: project.favorite,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    site: project.site,
    elementCount: project.elements.length,
    preview: {
      bounds: b ? { minX: r2(b.min.x), minY: r2(b.min.y), maxX: r2(b.max.x), maxY: r2(b.max.y) } : null,
      walls: project.elements.flatMap((e) =>
        e.type === "wall" ? [[r2(e.start.x), r2(e.start.y), r2(e.end.x), r2(e.end.y), r2(e.thickness)]] : [],
      ),
      floors: project.elements.flatMap((e) => (e.type === "floor" ? [flat(floorCorners(e))] : [])),
      objects: project.elements.flatMap((e) => (e.type === "object" ? [flat(objectCorners(e))] : [])),
    },
  };
}
