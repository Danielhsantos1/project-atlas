import type { BuildingObject, Element, Floor, Opening, Project, Wall } from "../model/schema";
import { isOpening, isWall } from "../model/schema";
import { degToRad } from "../units/units";
import { add, rotate, type Vec2 } from "./vec";

/** Cantos de um retângulo centrado e rotacionado (graus), em ordem anti-horária. */
export function rectCorners(center: Vec2, width: number, depth: number, rotationDeg: number): Vec2[] {
  const hw = width / 2;
  const hd = depth / 2;
  const r = degToRad(rotationDeg);
  return [
    { x: -hw, y: -hd },
    { x: hw, y: -hd },
    { x: hw, y: hd },
    { x: -hw, y: hd },
  ].map((p) => add(center, rotate(p, r)));
}

export const floorCorners = (f: Floor): Vec2[] => rectCorners(f.position, f.width, f.depth, f.rotation);
export const floorArea = (f: Floor): number => f.width * f.depth;
export const floorVolume = (f: Floor): number => f.width * f.depth * f.thickness;
export const objectCorners = (o: BuildingObject): Vec2[] => rectCorners(o.position, o.length, o.width, o.rotation);

export interface Bounds {
  min: Vec2;
  max: Vec2;
  maxZ: number;
}

/** Caixa envolvente do modelo no plano (para enquadrar a câmera). Null se vazio. */
export function projectBounds(project: Pick<Project, "elements"> & { levels?: Project["levels"] }): Bounds | null {
  const pts: Vec2[] = [];
  let maxZ = 0;
  const elev = new Map((project.levels ?? []).map((l) => [l.id, l.elevation]));
  for (const e of project.elements) {
    const base = "levelId" in e ? (elev.get(e.levelId) ?? 0) : 0;
    switch (e.type) {
      case "wall":
        pts.push(e.start, e.end);
        maxZ = Math.max(maxZ, base + e.baseElevation + e.height);
        break;
      case "floor":
        pts.push(...floorCorners(e));
        maxZ = Math.max(maxZ, base + e.position.z);
        break;
      case "object":
        pts.push(...objectCorners(e));
        maxZ = Math.max(maxZ, base + e.position.z + e.height);
        break;
      case "roof": {
        const hw = e.width / 2 + e.overhang;
        const hd = e.depth / 2 + e.overhang;
        pts.push({ x: e.position.x - hw, y: e.position.y - hd }, { x: e.position.x + hw, y: e.position.y + hd });
        maxZ = Math.max(maxZ, base + e.baseHeight + 3);
        break;
      }
      default:
        break; // aberturas estão contidas nas paredes
    }
  }
  if (pts.length === 0) return null;
  return {
    min: { x: Math.min(...pts.map((p) => p.x)), y: Math.min(...pts.map((p) => p.y)) },
    max: { x: Math.max(...pts.map((p) => p.x)), y: Math.max(...pts.map((p) => p.y)) },
    maxZ,
  };
}

export const wallsOf = (elements: readonly Element[]): Wall[] => elements.filter(isWall);
export const openingsOf = (elements: readonly Element[]): Opening[] => elements.filter(isOpening);
