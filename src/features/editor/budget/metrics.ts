import type { Project, Wall } from "@/core/model/schema";
import { isOpening } from "@/core/model/schema";
import { roomShape, polygonSignedArea } from "@/core/geometry/rooms";
import { wallQuantities, wallLength } from "@/core/geometry/wall";
import { roofGeometry } from "@/core/geometry/roof";
import { levelWalls } from "@/core/model/operations";

export interface BuildingMetrics {
  builtArea: number;
  usefulArea: number;
  wallNetArea: number;
  externalPerimeter: number;
  rooms: number;
  doors: number;
  windows: number;
  roofArea: number;
  openRooms: string[];
}

/**
 * Indicadores do painel de quantitativos, calculados da geometria.
 * Área construída = soma das áreas dos ambientes pelos EIXOS das paredes (inclui meia parede).
 * Perímetro externo = paredes de altura plena que delimitam apenas um ambiente no pavimento.
 */
export function buildingMetrics(project: Project): BuildingMetrics {
  const openings = project.elements.filter(isOpening);
  let builtArea = 0;
  let usefulArea = 0;
  let externalPerimeter = 0;
  const openRooms: string[] = [];
  for (const level of project.levels) {
    const walls = levelWalls(project, level.id);
    const count = new Map<string, number>();
    for (const r of project.elements) {
      if (r.type !== "room" || r.levelId !== level.id) continue;
      const s = roomShape(walls, r.seed);
      if (!s) {
        openRooms.push(r.name);
        continue;
      }
      builtArea += Math.abs(polygonSignedArea(s.axis));
      usefulArea += s.area;
      for (const id of s.wallIds) count.set(id, (count.get(id) ?? 0) + 1);
    }
    for (const w of walls) if (count.get(w.id) === 1 && w.height >= 2) externalPerimeter += wallLength(w);
  }
  const walls = project.elements.filter((e): e is Wall => e.type === "wall");
  return {
    builtArea,
    usefulArea,
    wallNetArea: walls.reduce((s, w) => s + wallQuantities(w, openings).netArea, 0),
    externalPerimeter,
    rooms: project.elements.filter((e) => e.type === "room").length,
    doors: openings.filter((o) => o.type === "door").length,
    windows: openings.filter((o) => o.type === "window").length,
    roofArea: project.elements.reduce((s, e) => s + (e.type === "roof" ? roofGeometry(e).area : 0), 0),
    openRooms,
  };
}
