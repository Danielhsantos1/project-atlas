import type { Door, Project, Wall } from "../core/model/schema";
import { isWall } from "../core/model/schema";
import { wallFrame, wallLocalToPlan } from "../core/geometry/wall";
import { degToRad } from "../core/units/units";
import type { PlayerState } from "./controller";
import { isPassageDoor } from "./colliders";

/**
 * Interação do passeio: encontrar o que está "à mão" do jogador.
 * Hoje só portas são interativas (abrir/fechar altera o mundo de colisão:
 * porta aberta = vão livre; fechada = bloqueador).
 */

export interface DoorInteractable {
  kind: "door";
  elementId: string;
  label: "Abrir porta" | "Fechar porta";
  /** Distância no plano do jogador ao centro da porta (m). */
  distance: number;
}

/**
 * Interruptor de luz — tipo de extensão PREPARADO. O modelo do projeto ainda
 * não possui elementos de iluminação/interruptores, portanto
 * `findInteractable` nunca retorna este tipo por enquanto.
 */
export interface LightSwitchInteractable {
  kind: "light-switch";
  elementId: string;
  label: "Acender luz" | "Apagar luz";
  distance: number;
}

/**
 * Janela operável — tipo de extensão PREPARADO. Janelas hoje são sempre
 * tratadas como vidro fixo (bloqueador permanente no vão); o estado
 * aberto/fechado de folhas de janela ainda não faz parte do modelo, portanto
 * `findInteractable` nunca retorna este tipo por enquanto.
 */
export interface WindowInteractable {
  kind: "window";
  elementId: string;
  label: "Abrir janela" | "Fechar janela";
  distance: number;
}

export type Interactable = DoorInteractable | LightSwitchInteractable | WindowInteractable;

/** Meio ângulo do cone de interação em torno do olhar. */
export const INTERACTION_HALF_ANGLE = degToRad(70);
/** Dentro deste raio (m) a porta é alcançável qualquer que seja o olhar (jogador no vão). */
const ALWAYS_REACH = 0.35;

/**
 * Porta mais próxima alcançável (portas de estilo "opening" são ignoradas): centro no plano a até `maxDist`, na mesma
 * faixa de nível (pés entre a base da porta − 0,6 m e a metade da sua altura)
 * e a até 70° da direção do olhar.
 * @param doorOpen portas abertas (define o rótulo "Abrir"/"Fechar").
 */
export function findInteractable(
  project: Pick<Project, "levels" | "elements">,
  state: Pick<PlayerState, "x" | "y" | "z" | "yaw">,
  maxDist = 1.6,
  doorOpen: ReadonlySet<string> = new Set(),
): Interactable | null {
  const elevation = new Map(project.levels.map((l) => [l.id, l.elevation]));
  const walls = new Map(project.elements.filter(isWall).map((w): [string, Wall] => [w.id, w]));
  const lookX = Math.cos(state.yaw);
  const lookY = Math.sin(state.yaw);
  const cosLimit = Math.cos(INTERACTION_HALF_ANGLE);
  let best: DoorInteractable | null = null;

  for (const e of project.elements) {
    if (e.type !== "door") continue;
    const door: Door = e;
    if (isPassageDoor(door)) continue; // vão livre: nada a abrir/fechar
    const wall = walls.get(door.hostId);
    if (!wall) continue;
    const levelZ = elevation.get(wall.levelId);
    if (levelZ === undefined) continue;
    const base = levelZ + wall.baseElevation;
    if (state.z < base - 0.6 || state.z > base + door.height / 2) continue;
    const c = wallLocalToPlan(wallFrame(wall), door.offset);
    const vx = c.x - state.x;
    const vy = c.y - state.y;
    const d = Math.hypot(vx, vy);
    if (d > maxDist) continue;
    if (d > ALWAYS_REACH && (vx * lookX + vy * lookY) / d < cosLimit) continue;
    if (!best || d < best.distance) {
      best = { kind: "door", elementId: door.id, label: doorOpen.has(door.id) ? "Fechar porta" : "Abrir porta", distance: d };
    }
  }
  return best;
}

/** Alterna uma porta (imutável: devolve um novo conjunto). */
export function toggleDoor(set: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}
