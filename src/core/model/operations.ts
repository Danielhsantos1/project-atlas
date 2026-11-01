import type { Element, Level, Opening, Project, Wall } from "./schema";
import { ElementSchema, LevelSchema, isFloor, isOpening, isRoof, isRoom, isWall } from "./schema";
import { roomShape } from "../geometry/rooms";
import { roofGeometry } from "../geometry/roof";
import { DomainError } from "./errors";
import { MIN_WALL_LENGTH, nextName } from "./factory";
import { createId } from "./ids";
import { add, dot, rotate, samePoint, sub, type Vec2 } from "../geometry/vec";
import { floorArea } from "../geometry/shapes";
import { wallFrame, wallLength, wallQuantities } from "../geometry/wall";
import { degToRad, normalizeDegrees, roundTo } from "../units/units";

/**
 * Operações de edição: funções PURAS (projeto → novo projeto), validadas.
 * A interface nunca altera elementos diretamente — sempre por aqui.
 */

export type ElementPatch = Record<string, unknown>;

const withElements = (project: Project, elements: Element[]): Project => ({ ...project, elements });

function requireElement(project: Project, id: string): Element {
  const el = project.elements.find((e) => e.id === id);
  if (!el) throw new DomainError("Elemento não encontrado.");
  return el;
}

/** Valida um elemento completo (schema + regras de domínio). Lança DomainError. */
export function validateElement(el: Element, elements: readonly Element[]): Element {
  const parsed = ElementSchema.safeParse(el);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path.join(".") ?? "";
    throw new DomainError(`Valor inválido${field ? ` em "${field}"` : ""}: ${issue?.message ?? "erro de validação"}`);
  }
  const valid = parsed.data;
  if (isWall(valid) && wallLength(valid) < MIN_WALL_LENGTH) {
    throw new DomainError(`A parede precisa ter ao menos ${MIN_WALL_LENGTH * 100} cm de comprimento.`);
  }
  if (isOpening(valid)) {
    const host = elements.find((e) => e.id === valid.hostId);
    if (!host || !isWall(host)) throw new DomainError("A abertura precisa estar associada a uma parede existente.");
  }
  return valid;
}

function assertLevel(project: Project, el: Element) {
  if ("levelId" in el && !project.levels.some((l) => l.id === el.levelId)) {
    throw new DomainError("O elemento precisa pertencer a um pavimento existente.");
  }
}

export function addElements(project: Project, newElements: readonly Element[]): Project {
  const all = [...project.elements, ...newElements];
  const ids = new Set(project.elements.map((e) => e.id));
  for (const el of newElements) {
    if (ids.has(el.id)) throw new DomainError("Identificador de elemento duplicado.");
    ids.add(el.id);
    validateElement(el, all);
    assertLevel(project, el);
  }
  return withElements(project, all);
}

/** Aplica alterações parciais a um elemento. `id` e `type` são imutáveis. */
export function updateElement(project: Project, id: string, patch: ElementPatch): Project {
  const current = requireElement(project, id);
  const merged = { ...current, ...patch, id: current.id, type: current.type } as Element;
  const valid = validateElement(merged, project.elements);
  assertLevel(project, valid);
  return withElements(
    project,
    project.elements.map((e) => (e.id === id ? valid : e)),
  );
}

/** Novo ponto final mantendo início e direção. */
export function wallEndForLength(wall: Wall, length: number): Vec2 {
  if (!(length >= MIN_WALL_LENGTH)) {
    throw new DomainError(`A parede precisa ter ao menos ${MIN_WALL_LENGTH * 100} cm de comprimento.`);
  }
  const f = wallFrame(wall);
  return { x: roundTo(wall.start.x + f.dir.x * length, 9), y: roundTo(wall.start.y + f.dir.y * length, 9) };
}

/** Novo ponto final mantendo início e comprimento, com o ângulo dado (graus). */
export function wallEndForAngle(wall: Wall, angleDeg: number): Vec2 {
  const L = wallLength(wall);
  const r = degToRad(angleDeg);
  return { x: roundTo(wall.start.x + Math.cos(r) * L, 9), y: roundTo(wall.start.y + Math.sin(r) * L, 9) };
}

const roundPt = (p: Vec2): Vec2 => ({ x: roundTo(p.x, 9), y: roundTo(p.y, 9) });
const key2 = (p: Vec2) => `${Math.round(p.x * 1e4)}|${Math.round(p.y * 1e4)}`;

/**
 * Altera as extremidades de uma parede mantendo as JUNTAS: extremidades de
 * outras paredes que coincidiam com as antigas acompanham o movimento
 * (comportamento de paredes unidas em ferramentas BIM).
 */
export function setWallEndpoints(project: Project, id: string, next: { start?: Vec2; end?: Vec2 }): Project {
  const wall = requireElement(project, id);
  if (!isWall(wall)) throw new DomainError("O elemento não é uma parede.");
  const moves: Array<{ from: Vec2; to: Vec2 }> = [];
  if (next.start) moves.push({ from: wall.start, to: roundPt(next.start) });
  if (next.end) moves.push({ from: wall.end, to: roundPt(next.end) });

  const updated = project.elements.map((e): Element => {
    if (e.id === id) return { ...wall, start: next.start ? roundPt(next.start) : wall.start, end: next.end ? roundPt(next.end) : wall.end };
    if (!isWall(e)) return e;
    let { start, end } = e;
    for (const m of moves) {
      if (samePoint(e.start, m.from)) start = m.to;
      if (samePoint(e.end, m.from)) end = m.to;
    }
    return start === e.start && end === e.end ? e : { ...e, start, end };
  });
  for (const e of updated) {
    if (e !== project.elements.find((o) => o.id === e.id)) {
      try {
        validateElement(e, updated);
      } catch (error) {
        if (error instanceof DomainError && e.id !== id) {
          throw new DomainError(`A alteração deixaria a parede unida "${e.name}" inválida: ${error.message}`);
        }
        throw error;
      }
    }
  }
  return withElements(project, updated);
}

/**
 * Paredes colineares encadeadas pelas extremidades (mesmo alinhamento, mesmo pavimento):
 * formam uma "fachada" contínua que deve se mover junta.
 */
export function collinearChain(project: Pick<Project, "elements">, wall: Wall): Wall[] {
  const walls = project.elements.filter((e): e is Wall => isWall(e) && e.levelId === wall.levelId);
  const d = sub(wall.end, wall.start);
  const len = Math.hypot(d.x, d.y);
  const onLine = (p: Vec2) => Math.abs((p.x - wall.start.x) * d.y - (p.y - wall.start.y) * d.x) / len < 1e-4;
  const chain = new Map<string, Wall>([[wall.id, wall]]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const w of walls) {
      if (chain.has(w.id) || !onLine(w.start) || !onLine(w.end)) continue;
      const touches = [...chain.values()].some((c) => samePoint(c.start, w.start) || samePoint(c.start, w.end) || samePoint(c.end, w.start) || samePoint(c.end, w.end));
      if (touches) {
        chain.set(w.id, w);
        grew = true;
      }
    }
  }
  return [...chain.values()];
}

/** Translada um elemento. Aberturas deslizam ao longo da parede (componente projetada). */
export function moveElement(project: Project, id: string, delta: Vec2): Project {
  const el = requireElement(project, id);
  switch (el.type) {
    case "wall": {
      // Movimento perpendicular ao eixo: o alinhamento colinear inteiro acompanha (fachada contínua).
      const dir = wallFrame(el).dir;
      const along = Math.abs(dot(delta, dir));
      const perpendicular = along < 1e-9 * Math.max(1, Math.hypot(delta.x, delta.y)) + 1e-12;
      if (!perpendicular) return setWallEndpoints(project, id, { start: add(el.start, delta), end: add(el.end, delta) });
      let next = project;
      const chain = collinearChain(project, el);
      // Move cada parede da cadeia com as juntas; as extremidades compartilhadas da cadeia
      // já movidas não são movidas de novo (comparação com o estado original).
      const moved = new Set<string>();
      for (const w of chain) {
        const cur = next.elements.find((e) => e.id === w.id) as Wall;
        const start = moved.has(key2(w.start)) ? cur.start : add(w.start, delta);
        const end = moved.has(key2(w.end)) ? cur.end : add(w.end, delta);
        next = setWallEndpoints(next, w.id, { start, end });
        moved.add(key2(w.start));
        moved.add(key2(w.end));
      }
      return next;
    }
    case "floor":
    case "object":
      return updateElement(project, id, {
        position: { ...el.position, x: roundTo(el.position.x + delta.x, 9), y: roundTo(el.position.y + delta.y, 9) },
      });
    case "roof":
      return updateElement(project, id, { position: { x: roundTo(el.position.x + delta.x, 9), y: roundTo(el.position.y + delta.y, 9) } });
    case "room":
      throw new DomainError("Ambientes são definidos pelas paredes: mova as paredes ou altere as dimensões no painel.");
    case "door":
    case "window": {
      const host = requireElement(project, el.hostId) as Wall;
      const along = dot(delta, wallFrame(host).dir);
      const L = wallLength(host);
      const offset = Math.min(Math.max(el.offset + along, el.width / 2), Math.max(L - el.width / 2, el.width / 2));
      return updateElement(project, id, { offset: roundTo(offset, 9) });
    }
  }
}

/** Gira um elemento no plano. Paredes giram em torno do ponto médio. */
export function rotateElement(project: Project, id: string, deltaDeg: number): Project {
  const el = requireElement(project, id);
  if (el.type === "floor" || el.type === "object" || el.type === "roof") {
    return updateElement(project, id, { rotation: normalizeDegrees(el.rotation + deltaDeg) });
  }
  if (el.type === "room") throw new DomainError("Ambientes giram junto com as paredes que os delimitam.");
  if (el.type === "wall") {
    const mid = { x: (el.start.x + el.end.x) / 2, y: (el.start.y + el.end.y) / 2 };
    const r = degToRad(deltaDeg);
    const rot = (p: Vec2): Vec2 => {
      const q = add(mid, rotate(sub(p, mid), r));
      return { x: roundTo(q.x, 9), y: roundTo(q.y, 9) };
    };
    return setWallEndpoints(project, id, { start: rot(el.start), end: rot(el.end) });
  }
  throw new DomainError("Portas e janelas acompanham a rotação da parede hospedeira.");
}

/** Exclui elementos. Excluir uma parede exclui também as aberturas hospedadas nela. */
export function deleteElements(project: Project, ids: readonly string[]): { project: Project; removed: string[] } {
  const toRemove = new Set(ids);
  for (const e of project.elements) {
    if (isOpening(e) && toRemove.has(e.hostId)) toRemove.add(e.id);
  }
  return {
    project: withElements(project, project.elements.filter((e) => !toRemove.has(e.id))),
    removed: [...toRemove],
  };
}

/** Duplica um elemento (paredes levam junto suas aberturas). Retorna o id da cópia. */
export function duplicateElement(project: Project, id: string): { project: Project; newId: string } {
  const el = requireElement(project, id);
  const shift: Vec2 = { x: 0.5, y: -0.5 };
  const created: Element[] = [];
  const pool = (): Element[] => [...project.elements, ...created];
  const prefix = (name: string) => name.replace(/\s+\d+$/, "");

  if (el.type === "door" || el.type === "window") {
    const host = requireElement(project, el.hostId) as Wall;
    const copy: Opening = { ...el, id: createId(), name: nextName(pool(), prefix(el.name)), offset: el.offset + el.width + 0.1 };
    if (copy.offset + copy.width / 2 > wallLength(host)) {
      throw new DomainError("Não há espaço na parede para duplicar esta abertura.");
    }
    created.push(copy);
  } else if (el.type === "wall") {
    const wallCopy: Wall = { ...el, id: createId(), name: nextName(pool(), prefix(el.name)), start: add(el.start, shift), end: add(el.end, shift) };
    created.push(wallCopy);
    for (const o of project.elements) {
      if (isOpening(o) && o.hostId === el.id) {
        created.push({ ...o, id: createId(), hostId: wallCopy.id, name: nextName(pool(), prefix(o.name)) });
      }
    }
  } else if (el.type === "floor" || el.type === "object") {
    created.push({ ...el, id: createId(), name: nextName(pool(), prefix(el.name)), position: { ...el.position, x: el.position.x + shift.x, y: el.position.y + shift.y } });
  } else if (el.type === "roof") {
    created.push({ ...el, id: createId(), name: nextName(pool(), prefix(el.name)), position: { x: el.position.x + shift.x, y: el.position.y + shift.y } });
  } else {
    throw new DomainError("Para duplicar um ambiente, crie um novo cômodo ao lado.");
  }
  return { project: addElements(project, created), newId: created[0]!.id };
}

export interface ProjectStats {
  walls: number;
  doors: number;
  windows: number;
  floors: number;
  objects: number;
  totalWallLength: number;
  totalWallNetArea: number;
  totalWallVolume: number;
  totalFloorArea: number;
  rooms: number;
  totalRoomArea: number;
  roofs: number;
  totalRoofArea: number;
  levels: number;
}

/** Quantitativos básicos (base para o futuro módulo de orçamentos). */
export function projectStats(project: Pick<Project, "elements">): ProjectStats {
  const openings = project.elements.filter(isOpening);
  const stats: ProjectStats = {
    walls: 0,
    doors: 0,
    windows: 0,
    floors: 0,
    objects: 0,
    totalWallLength: 0,
    totalWallNetArea: 0,
    totalWallVolume: 0,
    totalFloorArea: 0,
    rooms: 0,
    totalRoomArea: 0,
    roofs: 0,
    totalRoofArea: 0,
    levels: "levels" in project ? (project as Project).levels.length : 1,
  };
  for (const e of project.elements) {
    if (isWall(e)) {
      const q = wallQuantities(e, openings);
      stats.walls++;
      stats.totalWallLength += q.length;
      stats.totalWallNetArea += q.netArea;
      stats.totalWallVolume += q.volume;
    } else if (isFloor(e)) {
      stats.floors++;
      stats.totalFloorArea += floorArea(e);
    } else if (isRoom(e)) {
      stats.rooms++;
      const shape = roomShape(project.elements.filter((w): w is Wall => isWall(w) && w.levelId === e.levelId), e.seed);
      stats.totalRoomArea += shape?.area ?? 0;
    } else if (isRoof(e)) {
      stats.roofs++;
      stats.totalRoofArea += roofGeometry(e).area;
    } else if (e.type === "door") stats.doors++;
    else if (e.type === "window") stats.windows++;
    else stats.objects++;
  }
  return stats;
}

/** Paredes de um pavimento. */
export const levelWalls = (project: Pick<Project, "elements">, levelId: string): Wall[] =>
  project.elements.filter((e): e is Wall => isWall(e) && e.levelId === levelId);

// ---------- Pavimentos ----------

export function addLevel(project: Project, level: Level): Project {
  const parsed = LevelSchema.safeParse(level);
  if (!parsed.success) throw new DomainError(parsed.error.issues[0]?.message ?? "Pavimento inválido.");
  if (project.levels.some((l) => l.id === level.id)) throw new DomainError("Pavimento duplicado.");
  return { ...project, levels: [...project.levels, parsed.data].sort((a, b) => a.elevation - b.elevation) };
}

export function updateLevel(project: Project, id: string, patch: Partial<Omit<Level, "id">>): Project {
  const cur = project.levels.find((l) => l.id === id);
  if (!cur) throw new DomainError("Pavimento não encontrado.");
  const parsed = LevelSchema.safeParse({ ...cur, ...patch, id });
  if (!parsed.success) throw new DomainError(parsed.error.issues[0]?.message ?? "Pavimento inválido.");
  return { ...project, levels: project.levels.map((l) => (l.id === id ? parsed.data : l)).sort((a, b) => a.elevation - b.elevation) };
}

/** Remove um pavimento e TODOS os seus elementos (aberturas incluídas). */
export function deleteLevel(project: Project, id: string): Project {
  if (project.levels.length <= 1) throw new DomainError("O projeto precisa de ao menos um pavimento.");
  const ids = project.elements.filter((e) => "levelId" in e && e.levelId === id).map((e) => e.id);
  const { project: next } = deleteElements(project, ids);
  return { ...next, levels: next.levels.filter((l) => l.id !== id) };
}

// ---------- Ambientes ----------

/**
 * Redimensiona um ambiente retangular movendo a parede do lado leste (largura)
 * ou norte (profundidade). Paredes unidas acompanham e ambientes vizinhos se
 * ajustam automaticamente, pois seus contornos são derivados das paredes.
 */
export function resizeRoom(project: Project, roomId: string, axis: "x" | "y", newSize: number): Project {
  const room = project.elements.find((e) => e.id === roomId);
  if (!room || !isRoom(room)) throw new DomainError("Ambiente não encontrado.");
  const walls = levelWalls(project, room.levelId);
  const shape = roomShape(walls, room.seed);
  if (!shape) throw new DomainError("O ambiente não está fechado por paredes.");
  if (!shape.rect) throw new DomainError("Só ambientes retangulares podem ser redimensionados por largura/profundidade.");
  if (!(newSize >= 0.6)) throw new DomainError("O ambiente precisa ter ao menos 60 cm.");
  const r = shape.rect;
  const current = axis === "x" ? r.maxX - r.minX : r.maxY - r.minY;
  const delta = roundTo(newSize - current, 9);
  if (Math.abs(delta) < 1e-9) return project;
  const edge = axis === "x" ? r.maxX : r.maxY;
  const onEdge = walls.filter((w) =>
    axis === "x"
      ? Math.abs(w.start.x - edge) < 1e-4 && Math.abs(w.end.x - edge) < 1e-4 && Math.max(w.start.y, w.end.y) > r.minY + 1e-4 && Math.min(w.start.y, w.end.y) < r.maxY - 1e-4
      : Math.abs(w.start.y - edge) < 1e-4 && Math.abs(w.end.y - edge) < 1e-4 && Math.max(w.start.x, w.end.x) > r.minX + 1e-4 && Math.min(w.start.x, w.end.x) < r.maxX - 1e-4,
  );
  if (onEdge.length === 0) throw new DomainError("Não foi encontrada a parede do lado a ser movido.");
  let next = project;
  const done = new Set<string>();
  for (const w of onEdge) {
    if (done.has(w.id)) continue;
    for (const c of collinearChain(next, next.elements.find((e) => e.id === w.id) as Wall)) done.add(c.id);
    next = moveElement(next, w.id, axis === "x" ? { x: delta, y: 0 } : { x: 0, y: delta });
  }
  // Mantém a semente dentro do ambiente.
  const center = axis === "x" ? { x: (r.minX + r.maxX + delta) / 2, y: room.seed.y } : { x: room.seed.x, y: (r.minY + r.maxY + delta) / 2 };
  return updateElement(next, roomId, { seed: center });
}


/**
 * Altera o pé-direito de um pavimento: altura das paredes (exceto muros e guarda-corpos mais baixos que
 * o pé-direito anterior), forros dos ambientes e a altura piso a piso (pé-direito + espessura de laje).
 * Pavimentos acima são deslocados para manter a mesma espessura de laje entre níveis.
 */
export function setLevelCeilingHeight(project: Project, levelId: string, ceilingHeight: number, slabThickness = 0.2): Project {
  const level = project.levels.find((l) => l.id === levelId);
  if (!level) throw new DomainError("Pavimento não encontrado.");
  if (!(ceilingHeight >= 2 && ceilingHeight <= 8)) throw new DomainError("O pé-direito deve estar entre 2,00 m e 8,00 m.");
  const oldCeiling = Math.max(0, ...project.elements.filter((e) => isWall(e) && e.levelId === levelId).map((e) => (e as Wall).height));
  const newHeight = roundTo(ceilingHeight + slabThickness, 6);
  const delta = newHeight - level.height;
  const levels = project.levels.map((l) => {
    if (l.id === levelId) return { ...l, height: newHeight };
    return l.elevation > level.elevation ? { ...l, elevation: roundTo(l.elevation + delta, 6) } : l;
  });
  const elements = project.elements.map((e): Element => {
    if (!("levelId" in e) || e.levelId !== levelId) return e;
    // Paredes de altura plena acompanham o novo pé-direito; muros/guarda-corpos baixos ficam como estão.
    if (isWall(e) && e.height >= oldCeiling - 1e-6) return { ...e, height: ceilingHeight };
    // Forro rebaixado (abaixo das paredes) é preservado; forro na altura das paredes acompanha o pé-direito.
    if (isRoom(e)) return e.ceilingHeight < oldCeiling - 1e-6 ? { ...e, ceilingHeight: Math.min(e.ceilingHeight, ceilingHeight) } : { ...e, ceilingHeight };
    return e;
  });
  return { ...project, levels: levels.sort((a, b) => a.elevation - b.elevation), elements };
}
