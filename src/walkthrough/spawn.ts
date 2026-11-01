import type { Project, Wall } from "../core/model/schema";
import { isWall } from "../core/model/schema";
import { roomShape, pointInPolygon } from "../core/geometry/rooms";
import { wallFrame, wallLocalToPlan } from "../core/geometry/wall";
import type { Vec2 } from "../core/geometry/vec";
import { buildCollisionWorld, queryColliders, type CollisionWorld } from "./colliders";
import { DEFAULT_PLAYER_PARAMS, distanceToObb, levelAt, supportHeight, type PlayerParams, type PlayerState } from "./controller";

/** Distância da face da parede ao ponto de entrada, do lado de fora (m). */
export const ENTRANCE_DISTANCE = 1.2;
/** Largura mínima preferida para a porta principal (m). */
const MAIN_DOOR_MIN_WIDTH = 0.85;

/**
 * O cilindro do jogador com pés em `z` está livre de colliders?
 * Considera toda a faixa (z, z + height) — apoio exatamente sob os pés não conta.
 */
export function isPositionFree(world: CollisionWorld, x: number, y: number, z: number, params: PlayerParams = DEFAULT_PLAYER_PARAMS): boolean {
  for (const c of queryColliders(world, x, y, params.radius)) {
    if (c.zMax <= z + 1e-3 || c.zMin >= z + params.height) continue;
    if (distanceToObb(x, y, c) < params.radius) return false;
  }
  return true;
}

function makeState(world: CollisionWorld, x: number, y: number, z: number, yaw: number): PlayerState {
  return { x, y, z, vz: 0, yaw, pitch: 0, onGround: true, levelId: levelAt(world, z) };
}

/** Polígonos (pelos eixos) dos ambientes fechados de um pavimento. */
function roomPolygons(project: Pick<Project, "elements">, levelId: string): Vec2[][] {
  const walls = project.elements.filter((e): e is Wall => isWall(e) && e.levelId === levelId);
  const polys: Vec2[][] = [];
  for (const e of project.elements) {
    if (e.type !== "room" || e.levelId !== levelId) continue;
    const s = roomShape(walls, e.seed);
    if (s) polys.push(s.axis);
  }
  return polys;
}

/**
 * Posição inicial DO LADO DE FORA da porta principal, olhando para ela.
 * Porta principal: porta do pavimento mais baixo com um dos lados (a 1,2 m da
 * face da parede) fora de todos os ambientes; preferem-se portas com largura
 * ≥ 0,85 m e posições livres. Sem porta adequada: fora da caixa envolvente do
 * modelo (ao sul), olhando para o centro.
 */
export function entranceSpawn(
  project: Pick<Project, "levels" | "elements">,
  params: PlayerParams = DEFAULT_PLAYER_PARAMS,
  world: CollisionWorld = buildCollisionWorld(project),
): PlayerState {
  const lowest = world.levels[0];
  const baseZ = lowest?.elevation ?? 0;
  const groundAt = (x: number, y: number) => Math.max(supportHeight(world, x, y, params.radius, baseZ + params.stepHeight), world.terrainZ);

  if (lowest) {
    const polys = roomPolygons(project, lowest.id);
    const walls = new Map(project.elements.filter(isWall).map((w): [string, Wall] => [w.id, w]));
    const candidates: Array<{ x: number; y: number; yaw: number; z: number; wide: boolean; free: boolean; swing: boolean }> = [];
    for (const e of project.elements) {
      if (e.type !== "door") continue;
      const wall = walls.get(e.hostId);
      if (!wall || wall.levelId !== lowest.id) continue;
      const frame = wallFrame(wall);
      const center = wallLocalToPlan(frame, e.offset);
      for (const side of [1, -1]) {
        const p = wallLocalToPlan(frame, e.offset, side * (wall.thickness / 2 + ENTRANCE_DISTANCE));
        if (polys.some((poly) => pointInPolygon(p, poly))) continue;
        const z = groundAt(p.x, p.y);
        candidates.push({
          x: p.x,
          y: p.y,
          z,
          yaw: Math.atan2(center.y - p.y, center.x - p.x),
          wide: e.width >= MAIN_DOOR_MIN_WIDTH,
          // Portas de giro são entradas sociais; portões/portas de correr (garagem, varandas) ficam em segundo plano.
          swing: e.style === "swing",
          free: isPositionFree(world, p.x, p.y, z, params),
        });
        break;
      }
    }
    const rank = (c: (typeof candidates)[number]) => (c.free ? 4 : 0) + (c.swing ? 2 : 0) + (c.wide ? 1 : 0);
    const best = candidates.reduce<(typeof candidates)[number] | null>((a, c) => (!a || rank(c) > rank(a) ? c : a), null);
    if (best) return makeState(world, best.x, best.y, best.z, best.yaw);
  }

  // Fallback: fora do modelo, ao sul, olhando para o centro.
  const b = world.bounds;
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const x = cx;
  const y = b.minY - 2;
  return makeState(world, x, y, groundAt(x, y), Math.atan2(cy - y, cx - x));
}

/**
 * Posição no centro do primeiro ambiente retangular do pavimento cujo centro
 * esteja livre (cilindro do jogador sem colliders), pés no topo do piso.
 * Retorna null se o pavimento não tiver ambiente utilizável.
 */
export function levelSpawn(
  project: Pick<Project, "levels" | "elements">,
  levelId: string,
  params: PlayerParams = DEFAULT_PLAYER_PARAMS,
  world: CollisionWorld = buildCollisionWorld(project),
): PlayerState | null {
  const level = world.levels.find((l) => l.id === levelId);
  if (!level) return null;
  const walls = project.elements.filter((e): e is Wall => isWall(e) && e.levelId === levelId);
  for (const e of project.elements) {
    if (e.type !== "room" || e.levelId !== levelId) continue;
    const rect = roomShape(walls, e.seed)?.rect;
    if (!rect) continue;
    const x = (rect.minX + rect.maxX) / 2;
    const y = (rect.minY + rect.maxY) / 2;
    const z = Math.max(level.elevation, supportHeight(world, x, y, params.radius, level.elevation + params.stepHeight));
    if (isPositionFree(world, x, y, z, params)) return makeState(world, x, y, z, 0);
  }
  return null;
}
