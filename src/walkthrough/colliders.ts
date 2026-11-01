import type { BuildingObject, Door, Floor, Level, Opening, Project, Room, Wall } from "../core/model/schema";
import { isOpening, isWall } from "../core/model/schema";
import { computeWallJoins, computeWallPieces, openingHoles, wallFrame, wallLocalToPlan } from "../core/geometry/wall";
import { objectParts, type ObjectPart } from "../core/geometry/objects";
import { polygonSignedArea, roomShape } from "../core/geometry/rooms";
import { rotate } from "../core/geometry/vec";
import { degToRad } from "../core/units/units";

/**
 * MUNDO DE COLISÃO do passeio em primeira pessoa.
 *
 * O mundo é DERIVADO do mesmo `Project` usado pelo editor (nunca uma cópia
 * feita à mão) e é mantido SEPARADO da geometria visual: aqui só existem
 * caixas orientadas no plano (OBB 2D + faixa vertical), suficientes para
 * física de personagem. Sempre que o projeto mudar, basta chamar
 * `buildCollisionWorld` de novo (é barato: O(elementos)).
 *
 * Coordenadas do domínio: X leste, Y norte, Z para cima; metros.
 * Todas as cotas Z de `Collider` são ABSOLUTAS (já somadas à elevação do pavimento).
 *
 * Fontes de colisão:
 *  - Paredes: um bloco por peça de `computeWallPieces` (com juntas) — os vãos
 *    de portas/janelas são vazios reais.
 *  - Portas FECHADAS (fora de `doorOpen`) de estilo "swing"/"sliding":
 *    bloqueador preenchendo o vão. Portas abertas deixam o vão livre (a folha
 *    aberta não colide). Portas de estilo "opening" (vão livre/passagem)
 *    NUNCA bloqueiam, independentemente de `doorOpen`.
 *  - Janelas: bloqueador sempre presente no vão (vidro), inclusive janelas
 *    piso-teto com peitoril 0.
 *  - Pisos/lajes: caixa [z − espessura, z] girada por `rotation`.
 *  - Ambientes: piso fino ("room-floor") no topo da cota do pavimento, SÓ em
 *    pavimentos sem nenhum elemento `floor` — assim cômodos de um pavimento
 *    superior sem laje modelada continuam caminháveis. Se o pavimento tem
 *    qualquer piso/laje, são as lajes que definem onde se pisa (a caixa de um
 *    ambiente em L poderia tampar o vão da escada).
 *  - Objetos: uma caixa por primitiva de `objectParts` (cilindros aproximados
 *    pela caixa envolvente). Escadas viram degraus "stair"; árvore só colide
 *    no tronco; piscina tem a água como bloqueador (≥ 1,0 m) e a borda caminhável.
 *  - Terreno: chão implícito infinito em z = 0, tratado no controlador.
 *  - Telhados: IGNORADOS. São superfícies inclinadas (não representáveis por
 *    OBB horizontais sem degraus artificiais), ficam acima da área percorrível
 *    (não há acesso ao telhado no passeio) e uma cobertura plana acessível deve
 *    ser modelada como piso/laje. Ignorá-los evita "tetos invisíveis" errados.
 */

export type ColliderKind = "wall" | "door" | "window" | "floor" | "room-floor" | "object" | "stair" | "terrain";

/** Caixa orientada: retângulo no plano (centro, semi-eixos, ângulo) × faixa vertical absoluta. */
export interface Collider {
  cx: number;
  cy: number;
  /** Semi-extensão ao longo do eixo local X (girado por `angle`). */
  hx: number;
  /** Semi-extensão ao longo do eixo local Y. */
  hy: number;
  /** Rotação em radianos, anti-horária a partir de +X. */
  angle: number;
  zMin: number;
  zMax: number;
  kind: ColliderKind;
  elementId: string;
}

export interface WorldBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

/** Hash espacial uniforme: célula → índices de colliders cuja AABB toca a célula. */
export interface SpatialGrid {
  cellSize: number;
  cells: Map<string, number[]>;
  /** Colliders grandes demais para o hash (sempre retornados nas consultas). */
  large: number[];
}

export interface CollisionWorld {
  colliders: Collider[];
  /** Pavimentos ordenados por elevação crescente. */
  levels: Level[];
  bounds: WorldBounds;
  grid: SpatialGrid;
  /** Cota do terreno implícito (chão infinito). */
  terrainZ: number;
  /** Avisos de aproximações/descartes feitos ao derivar o mundo. */
  warnings: string[];
}

export const GRID_CELL_SIZE = 2;
/** Acima desse número de células, o collider vai para a lista `large`. */
const MAX_CELLS_PER_COLLIDER = 4096;
/** Espessura do piso fino dos ambientes (m). */
export const ROOM_FLOOR_THICKNESS = 0.05;
/** Altura mínima do bloqueador da água da piscina, a partir da base (m). */
export const POOL_BLOCKER_HEIGHT = 1.0;
/** Fração mínima (área do polígono / área da caixa envolvente) para aproximar ambientes não retangulares. */
const NON_RECT_ROOM_MIN_FILL = 0.9;

/** Caixa envolvente alinhada aos eixos (no plano) de um collider. */
export function colliderAabb(c: Collider): { minX: number; minY: number; maxX: number; maxY: number } {
  const cos = Math.abs(Math.cos(c.angle));
  const sin = Math.abs(Math.sin(c.angle));
  const ex = c.hx * cos + c.hy * sin;
  const ey = c.hx * sin + c.hy * cos;
  return { minX: c.cx - ex, minY: c.cy - ey, maxX: c.cx + ex, maxY: c.cy + ey };
}

const cellKey = (ix: number, iy: number) => `${ix},${iy}`;

export function buildGrid(colliders: readonly Collider[], cellSize = GRID_CELL_SIZE): SpatialGrid {
  const cells = new Map<string, number[]>();
  const large: number[] = [];
  colliders.forEach((c, index) => {
    const b = colliderAabb(c);
    const x0 = Math.floor(b.minX / cellSize);
    const x1 = Math.floor(b.maxX / cellSize);
    const y0 = Math.floor(b.minY / cellSize);
    const y1 = Math.floor(b.maxY / cellSize);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > MAX_CELLS_PER_COLLIDER) {
      large.push(index);
      return;
    }
    for (let ix = x0; ix <= x1; ix++) {
      for (let iy = y0; iy <= y1; iy++) {
        const k = cellKey(ix, iy);
        const list = cells.get(k);
        if (list) list.push(index);
        else cells.set(k, [index]);
      }
    }
  });
  return { cellSize, cells, large };
}

/**
 * Colliders cuja AABB intersecta o quadrado [x ± radius] × [y ± radius].
 * Resultado sem duplicatas, em ordem crescente de índice (determinístico).
 */
export function queryColliders(world: Pick<CollisionWorld, "colliders" | "grid">, x: number, y: number, radius: number): Collider[] {
  const { grid } = world;
  const s = grid.cellSize;
  const minX = x - radius;
  const maxX = x + radius;
  const minY = y - radius;
  const maxY = y + radius;
  const found = new Set<number>(grid.large);
  for (let ix = Math.floor(minX / s); ix <= Math.floor(maxX / s); ix++) {
    for (let iy = Math.floor(minY / s); iy <= Math.floor(maxY / s); iy++) {
      const list = grid.cells.get(cellKey(ix, iy));
      if (list) for (const i of list) found.add(i);
    }
  }
  const out: Collider[] = [];
  for (const i of [...found].sort((a, b) => a - b)) {
    const c = world.colliders[i]!;
    const b = colliderAabb(c);
    if (b.maxX >= minX && b.minX <= maxX && b.maxY >= minY && b.minY <= maxY) out.push(c);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Derivação a partir do modelo
// ---------------------------------------------------------------------------

/**
 * A porta é um vão livre (estilo "opening")? Lido de forma tolerante: projetos
 * antigos sem o campo `style` são tratados como porta comum ("swing").
 */
export function isPassageDoor(door: Door): boolean {
  return (door as { style?: string }).style === "opening";
}

/** A porta bloqueia a passagem neste estado? */
export function doorBlocks(door: Door, doorOpen: ReadonlySet<string>): boolean {
  return !isPassageDoor(door) && !doorOpen.has(door.id);
}

function wallColliders(walls: readonly Wall[], openings: readonly Opening[], elevation: number, doorOpen: ReadonlySet<string>): Collider[] {
  const out: Collider[] = [];
  const joins = computeWallJoins(walls);
  for (const wall of walls) {
    const frame = wallFrame(wall);
    if (frame.length <= 0) continue;
    const angle = Math.atan2(frame.dir.y, frame.dir.x);
    const hy = wall.thickness / 2;
    const base = elevation + wall.baseElevation;
    const box = (u0: number, u1: number, v0: number, v1: number, kind: ColliderKind, elementId: string): Collider => {
      const c = wallLocalToPlan(frame, (u0 + u1) / 2);
      return { cx: c.x, cy: c.y, hx: (u1 - u0) / 2, hy, angle, zMin: base + v0, zMax: base + v1, kind, elementId };
    };
    for (const p of computeWallPieces(wall, openings, joins.get(wall.id))) {
      out.push(box(p.u0, p.u1, p.v0, p.v1, "wall", wall.id));
    }
    const byId = new Map(openings.map((o) => [o.id, o]));
    for (const h of openingHoles(wall, openings)) {
      const o = byId.get(h.openingId);
      if (!o) continue;
      if (o.type === "door" && !doorBlocks(o, doorOpen)) continue; // vão livre: passagem real
      out.push(box(h.u0, h.u1, h.v0, h.v1, o.type === "door" ? "door" : "window", o.id));
    }
  }
  return out;
}

function floorCollider(f: Floor, elevation: number): Collider {
  return {
    cx: f.position.x,
    cy: f.position.y,
    hx: f.width / 2,
    hy: f.depth / 2,
    angle: degToRad(f.rotation),
    zMin: elevation + f.position.z - f.thickness,
    zMax: elevation + f.position.z,
    kind: "floor",
    elementId: f.id,
  };
}

function roomFloorCollider(room: Room, walls: readonly Wall[], elevation: number, warnings: string[]): Collider | null {
  const shape = roomShape(walls, room.seed);
  if (!shape) {
    warnings.push(`Ambiente "${room.name}" não está fechado por paredes: sem piso de colisão próprio.`);
    return null;
  }
  let r = shape.rect;
  if (!r) {
    const xs = shape.inner.map((p) => p.x);
    const ys = shape.inner.map((p) => p.y);
    const bbox = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
    const bboxArea = (bbox.maxX - bbox.minX) * (bbox.maxY - bbox.minY);
    const fill = bboxArea > 0 ? Math.abs(polygonSignedArea(shape.inner)) / bboxArea : 0;
    if (fill < NON_RECT_ROOM_MIN_FILL) {
      warnings.push(
        `Ambiente "${room.name}" não é retangular (ocupa ${(fill * 100).toFixed(0)}% da caixa envolvente): piso de colisão próprio omitido.`,
      );
      return null;
    }
    r = bbox;
  }
  return {
    cx: (r.minX + r.maxX) / 2,
    cy: (r.minY + r.maxY) / 2,
    hx: (r.maxX - r.minX) / 2,
    hy: (r.maxY - r.minY) / 2,
    angle: 0,
    zMin: elevation - ROOM_FLOOR_THICKNESS,
    zMax: elevation,
    kind: "room-floor",
    elementId: room.id,
  };
}

function objectColliders(o: BuildingObject, elevation: number): Collider[] {
  let parts: ObjectPart[] = objectParts(o);
  const rot = degToRad(o.rotation);
  const base = elevation + o.position.z;
  const kind: ColliderKind = o.kind === "stair-straight" ? "stair" : "object";
  // Árvore: só o tronco é sólido (a copa é atravessável).
  if (o.kind === "tree") parts = parts.filter((p) => p.materialId !== "foliage");
  return parts.map((p) => {
    const c = rotate({ x: p.x, y: p.y }, rot);
    let zMin = base + p.z - p.sz / 2;
    let zMax = base + p.z + p.sz / 2;
    // Piscina: a água vira bloqueador alto — ninguém "anda" para dentro dela.
    if (o.kind === "pool" && p.materialId === "water") {
      zMin = base;
      zMax = Math.max(zMax, base + POOL_BLOCKER_HEIGHT);
    }
    return {
      cx: o.position.x + c.x,
      cy: o.position.y + c.y,
      hx: p.sx / 2,
      hy: p.sy / 2,
      angle: rot,
      zMin,
      zMax,
      kind,
      elementId: o.id,
    };
  });
}

function computeBounds(colliders: readonly Collider[]): WorldBounds {
  if (colliders.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0, minZ: 0, maxZ: 0 };
  const b: WorldBounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const c of colliders) {
    const a = colliderAabb(c);
    b.minX = Math.min(b.minX, a.minX);
    b.minY = Math.min(b.minY, a.minY);
    b.maxX = Math.max(b.maxX, a.maxX);
    b.maxY = Math.max(b.maxY, a.maxY);
    b.minZ = Math.min(b.minZ, c.zMin);
    b.maxZ = Math.max(b.maxZ, c.zMax);
  }
  return b;
}

/**
 * Deriva o mundo de colisão do projeto.
 * @param doorOpen ids das portas abertas (vão livre); as demais portas bloqueiam.
 */
export function buildCollisionWorld(project: Pick<Project, "levels" | "elements">, doorOpen: ReadonlySet<string> = new Set()): CollisionWorld {
  const levels = [...project.levels].sort((a, b) => a.elevation - b.elevation);
  const elevationOf = new Map(levels.map((l) => [l.id, l.elevation]));
  const openings = project.elements.filter(isOpening);
  const colliders: Collider[] = [];
  const warnings: string[] = [];

  for (const level of levels) {
    const walls = project.elements.filter((e): e is Wall => isWall(e) && e.levelId === level.id);
    const wallIds = new Set(walls.map((w) => w.id));
    colliders.push(...wallColliders(walls, openings.filter((o) => wallIds.has(o.hostId)), level.elevation, doorOpen));
    // Pavimento com laje/piso modelado: as lajes definem a área caminhável.
    if (project.elements.some((e) => e.type === "floor" && e.levelId === level.id)) continue;
    for (const e of project.elements) {
      if (e.type === "room" && e.levelId === level.id) {
        const c = roomFloorCollider(e, walls, level.elevation, warnings);
        if (c) colliders.push(c);
      }
    }
  }

  for (const e of project.elements) {
    if (e.type !== "floor" && e.type !== "object") continue;
    const elevation = elevationOf.get(e.levelId);
    if (elevation === undefined) {
      warnings.push(`Elemento "${e.name}" está num pavimento inexistente e foi ignorado na colisão.`);
      continue;
    }
    if (e.type === "floor") colliders.push(floorCollider(e, elevation));
    else colliders.push(...objectColliders(e, elevation));
  }

  return { colliders, levels, bounds: computeBounds(colliders), grid: buildGrid(colliders), terrainZ: 0, warnings };
}
