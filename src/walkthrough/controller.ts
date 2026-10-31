import type { Vec2, Vec3 } from "../core/geometry/vec";
import { queryColliders, type Collider, type CollisionWorld } from "./colliders";

/**
 * CONTROLADOR DE PERSONAGEM em primeira pessoa (física pura, sem React/three.js).
 *
 * O jogador é um cilindro vertical (círculo de raio `radius` no plano ×
 * [pés, pés + height]). Coordenadas do domínio: X leste, Y norte, Z para cima.
 *
 * Algoritmo de `stepPlayer` (um quadro de duração dt, limitado a MAX_DT):
 *
 * 1. Movimento horizontal: velocidade = walk/runSpeed × moveVector(yaw, input).
 *    O deslocamento é dividido em sub-passos de no máximo SUBSTEP (0,05 m) —
 *    menor que qualquer parede (≥ 0,10 m) + raio, então não há "tunelamento".
 *    Em cada sub-passo:
 *    a) Resolução círculo × OBB contra os colliders BLOQUEANTES — aqueles cuja
 *       faixa vertical intersecta [pés + stepHeight, pés + height). Várias
 *       iterações (Gauss-Seidel), empurrando pelo vetor de menor translação;
 *       se o centro estiver dentro da caixa, sai pela face mais próxima.
 *       Empurrar ao longo da normal produz o "deslizar" natural nas paredes.
 *    b) Se estiver no chão: suporte = max(terreno, topos dos colliders cuja
 *       projeção intersecta o círculo e cujo topo ≤ pés + stepHeight + ε).
 *       - suporte acima dos pés → SOBE o degrau (se houver espaço para a
 *         cabeça; senão o sub-passo é desfeito);
 *       - suporte abaixo, até stepHeight → DESCE colado ao degrau (descer
 *         escada é suave, sem "voar");
 *       - queda maior que stepHeight → passa a cair (onGround = false).
 * 2. Movimento vertical: pulo só no chão (vz = jumpSpeed). No ar aplica-se a
 *    gravidade (limitada a maxFallSpeed).
 *    - Subindo: se a cabeça cruzar a face inferior de um collider entre a
 *      posição antiga e a nova, para em baixo dele e zera vz (teto).
 *    - Descendo: verificação VARRIDA — o suporte considera todos os topos
 *      entre a cota antiga (+ stepHeight) e a nova; se a nova cota ficar
 *      abaixo do suporte, pousa nele. Assim nunca atravessa lajes, mesmo em
 *      queda rápida.
 * 3. levelId = pavimento mais alto cuja elevação ≤ pés + 0,1.
 */

export interface PlayerParams {
  radius: number;
  height: number;
  eyeHeight: number;
  stepHeight: number;
  walkSpeed: number;
  runSpeed: number;
  gravity: number;
  jumpSpeed: number;
  maxFallSpeed: number;
}

export const DEFAULT_PLAYER_PARAMS: Readonly<PlayerParams> = Object.freeze({
  radius: 0.25,
  height: 1.75,
  eyeHeight: 1.65,
  stepHeight: 0.35,
  walkSpeed: 1.4,
  runSpeed: 3.2,
  gravity: 9.81,
  jumpSpeed: 3.2,
  maxFallSpeed: 30,
});

export interface PlayerState {
  x: number;
  y: number;
  /** Cota dos pés (absoluta). */
  z: number;
  /** Velocidade vertical (m/s). */
  vz: number;
  /** Direção do olhar no plano (rad); 0 = olhando para +X, anti-horário. */
  yaw: number;
  /** Inclinação do olhar (rad); positivo = para cima. */
  pitch: number;
  onGround: boolean;
  levelId: string;
}

export interface PlayerInput {
  /** −1..1 (frente positiva). */
  forward: number;
  /** −1..1 (direita positiva). */
  right: number;
  run: boolean;
  jump: boolean;
}

/** Tamanho máximo de um sub-passo horizontal (m). */
export const SUBSTEP = 0.05;
/** dt máximo por quadro (s) — evita saltos após a aba ficar em segundo plano. */
export const MAX_DT = 0.1;
const EPS = 1e-6;
const RESOLVE_ITERATIONS = 8;
/** Folga para considerar que o círculo "pisa" num collider (evita apoio por tangência). */
const SUPPORT_EPS = 1e-4;
/** Tolerância vertical para considerar que o jogador está apoiado (m). */
const GROUND_EPS = 1e-4;

// ---------------------------------------------------------------------------
// Helpers de olhar/movimento
// ---------------------------------------------------------------------------

export function eyePosition(state: Pick<PlayerState, "x" | "y" | "z">, params: Pick<PlayerParams, "eyeHeight"> = DEFAULT_PLAYER_PARAMS): Vec3 {
  return { x: state.x, y: state.y, z: state.z + params.eyeHeight };
}

/** Vetor unitário do olhar no domínio (Z para cima). */
export function lookDirection(yaw: number, pitch: number): Vec3 {
  const c = Math.cos(pitch);
  return { x: c * Math.cos(yaw), y: c * Math.sin(yaw), z: Math.sin(pitch) };
}

/**
 * Direção de deslocamento no plano para a entrada dada (módulo ≤ 1).
 * Frente = (cos yaw, sin yaw); direita = frente girada −90°.
 */
export function moveVector(yaw: number, input: Pick<PlayerInput, "forward" | "right">): Vec2 {
  const f = clamp(input.forward, -1, 1);
  const r = clamp(input.right, -1, 1);
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  let x = f * c + r * s;
  let y = f * s - r * c;
  const len = Math.hypot(x, y);
  if (len > 1) {
    x /= len;
    y /= len;
  }
  return { x, y };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : 0));

// ---------------------------------------------------------------------------
// Geometria círculo × OBB
// ---------------------------------------------------------------------------

/** Vetor de saída (menor translação) de um círculo que penetra a OBB, ou null. */
export function circleObbPenetration(
  px: number,
  py: number,
  radius: number,
  box: Pick<Collider, "cx" | "cy" | "hx" | "hy" | "angle">,
): { x: number; y: number; depth: number } | null {
  const c = Math.cos(box.angle);
  const s = Math.sin(box.angle);
  const dx = px - box.cx;
  const dy = py - box.cy;
  // Coordenadas locais da caixa.
  const lx = dx * c + dy * s;
  const ly = -dx * s + dy * c;
  let pushLx: number;
  let pushLy: number;
  let depth: number;
  if (Math.abs(lx) <= box.hx && Math.abs(ly) <= box.hy) {
    // Centro dentro da caixa: sai pela face mais próxima.
    const ox = box.hx - Math.abs(lx);
    const oy = box.hy - Math.abs(ly);
    if (ox <= oy) {
      depth = ox + radius;
      pushLx = lx >= 0 ? depth : -depth;
      pushLy = 0;
    } else {
      depth = oy + radius;
      pushLx = 0;
      pushLy = ly >= 0 ? depth : -depth;
    }
  } else {
    const qx = clamp(lx, -box.hx, box.hx);
    const qy = clamp(ly, -box.hy, box.hy);
    const ex = lx - qx;
    const ey = ly - qy;
    const dist = Math.hypot(ex, ey);
    if (dist >= radius) return null;
    depth = radius - dist;
    pushLx = (ex / dist) * depth;
    pushLy = (ey / dist) * depth;
  }
  return { x: pushLx * c - pushLy * s, y: pushLx * s + pushLy * c, depth };
}

/** Distância do ponto à OBB no plano (0 se dentro). */
export function distanceToObb(px: number, py: number, box: Pick<Collider, "cx" | "cy" | "hx" | "hy" | "angle">): number {
  const c = Math.cos(box.angle);
  const s = Math.sin(box.angle);
  const dx = px - box.cx;
  const dy = py - box.cy;
  const lx = dx * c + dy * s;
  const ly = -dx * s + dy * c;
  const ex = Math.max(Math.abs(lx) - box.hx, 0);
  const ey = Math.max(Math.abs(ly) - box.hy, 0);
  return Math.hypot(ex, ey);
}

/** O collider bloqueia o deslocamento horizontal de um jogador com os pés em `feet`? */
export function isBlocking(c: Collider, feet: number, params: Pick<PlayerParams, "stepHeight" | "height">): boolean {
  return c.zMax > feet + params.stepHeight + EPS && c.zMin < feet + params.height - EPS;
}

/**
 * Resolve a penetração do círculo contra os colliders bloqueantes.
 * Retorna a posição corrigida.
 */
export function resolveHorizontal(world: CollisionWorld, x: number, y: number, feet: number, params: PlayerParams): Vec2 {
  const candidates = queryColliders(world, x, y, params.radius + SUBSTEP).filter((c) => isBlocking(c, feet, params));
  let px = x;
  let py = y;
  for (let it = 0; it < RESOLVE_ITERATIONS; it++) {
    let moved = false;
    for (const c of candidates) {
      const pen = circleObbPenetration(px, py, params.radius, c);
      if (pen && pen.depth > 1e-9) {
        px += pen.x;
        py += pen.y;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return { x: px, y: py };
}

/**
 * Cota de apoio sob o círculo: max(terreno, topos ≤ maxTop dos colliders cuja
 * projeção intersecta o círculo).
 */
export function supportHeight(world: CollisionWorld, x: number, y: number, radius: number, maxTop: number): number {
  let best = world.terrainZ <= maxTop + EPS ? world.terrainZ : -Infinity;
  for (const c of queryColliders(world, x, y, radius)) {
    if (c.zMax > maxTop + EPS || c.zMax <= best) continue;
    if (distanceToObb(x, y, c) < radius - SUPPORT_EPS) best = c.zMax;
  }
  return best;
}

/** Há espaço livre para o corpo inteiro com os pés em `feet`? (ignora o que fica abaixo de stepHeight) */
function hasHeadroom(world: CollisionWorld, x: number, y: number, feet: number, params: PlayerParams): boolean {
  for (const c of queryColliders(world, x, y, params.radius)) {
    if (!isBlocking(c, feet, params)) continue;
    if (distanceToObb(x, y, c) < params.radius - SUPPORT_EPS) return false;
  }
  return true;
}

/** Maior penetração atual do jogador em colliders bloqueantes (diagnóstico/testes). */
export function maxPenetration(world: CollisionWorld, state: Pick<PlayerState, "x" | "y" | "z">, params: PlayerParams = DEFAULT_PLAYER_PARAMS): number {
  let worst = 0;
  for (const c of queryColliders(world, state.x, state.y, params.radius)) {
    if (!isBlocking(c, state.z, params)) continue;
    const pen = circleObbPenetration(state.x, state.y, params.radius, c);
    if (pen) worst = Math.max(worst, pen.depth);
  }
  return worst;
}

/** Pavimento mais alto cuja elevação ≤ pés + 0,1 (ou o mais baixo, se nenhum). */
export function levelAt(world: Pick<CollisionWorld, "levels">, feet: number): string {
  let id = world.levels[0]?.id ?? "";
  for (const l of world.levels) if (l.elevation <= feet + 0.1) id = l.id;
  return id;
}

// ---------------------------------------------------------------------------
// Passo de simulação
// ---------------------------------------------------------------------------

export function stepPlayer(
  world: CollisionWorld,
  state: PlayerState,
  input: PlayerInput,
  dt: number,
  params: PlayerParams = DEFAULT_PLAYER_PARAMS,
): PlayerState {
  const h = clamp(dt, 0, MAX_DT);
  let { x, y, z, vz, onGround } = state;

  // 1. Horizontal em sub-passos.
  const dir = moveVector(state.yaw, input);
  const speed = input.run ? params.runSpeed : params.walkSpeed;
  const dx = dir.x * speed * h;
  const dy = dir.y * speed * h;
  const dist = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(dist / SUBSTEP));
  for (let i = 0; i < steps; i++) {
    const prevX = x;
    const prevY = y;
    const p = resolveHorizontal(world, x + dx / steps, y + dy / steps, z, params);
    x = p.x;
    y = p.y;
    if (!onGround) continue;
    const support = supportHeight(world, x, y, params.radius, z + params.stepHeight);
    if (support > z + GROUND_EPS) {
      if (hasHeadroom(world, x, y, support, params)) z = support;
      else {
        x = prevX;
        y = prevY;
      }
    } else if (z - support <= params.stepHeight + GROUND_EPS) {
      z = support;
    } else {
      onGround = false;
      vz = 0;
    }
  }
  // Mesmo parado, verifica se o apoio sumiu (ex.: mundo reconstruído).
  if (onGround && steps === 1 && dist === 0) {
    const support = supportHeight(world, x, y, params.radius, z + params.stepHeight);
    if (z - support > GROUND_EPS) {
      if (z - support <= params.stepHeight + GROUND_EPS) z = support;
      else onGround = false;
    }
  }

  // 2. Vertical.
  if (onGround && input.jump) {
    vz = params.jumpSpeed;
    onGround = false;
  }
  if (!onGround) {
    vz = Math.max(vz - params.gravity * h, -params.maxFallSpeed);
    let next = z + vz * h;
    if (vz > 0) {
      // Teto: menor face inferior cruzada pela cabeça neste quadro.
      const head = z + params.height;
      let ceiling = Infinity;
      for (const c of queryColliders(world, x, y, params.radius)) {
        if (c.zMin < head - 1e-3 || c.zMin >= next + params.height) continue;
        if (distanceToObb(x, y, c) < params.radius - SUPPORT_EPS) ceiling = Math.min(ceiling, c.zMin);
      }
      if (ceiling < Infinity) {
        next = Math.max(z, ceiling - params.height);
        vz = 0;
      }
    }
    // Apoio varrido: todos os topos entre a cota nova e a antiga (+ degrau).
    const support = supportHeight(world, x, y, params.radius, z + params.stepHeight);
    if (support > next - GROUND_EPS && (vz <= 0 || support > z + GROUND_EPS)) {
      if (vz <= 0) {
        next = support;
        vz = 0;
        onGround = true;
      } else {
        next = Math.max(next, support);
      }
    }
    z = next;
  }

  return { ...state, x, y, z, vz, onGround, levelId: levelAt(world, z) };
}
