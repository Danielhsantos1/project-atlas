import type { Element, Opening, Project, Wall } from "./schema";
import { ElementSchema, isFloor, isOpening, isWall } from "./schema";
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

export function addElements(project: Project, newElements: readonly Element[]): Project {
  const all = [...project.elements, ...newElements];
  const ids = new Set(project.elements.map((e) => e.id));
  for (const el of newElements) {
    if (ids.has(el.id)) throw new DomainError("Identificador de elemento duplicado.");
    ids.add(el.id);
    validateElement(el, all);
  }
  return withElements(project, all);
}

/** Aplica alterações parciais a um elemento. `id` e `type` são imutáveis. */
export function updateElement(project: Project, id: string, patch: ElementPatch): Project {
  const current = requireElement(project, id);
  const merged = { ...current, ...patch, id: current.id, type: current.type } as Element;
  const valid = validateElement(merged, project.elements);
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

/** Translada um elemento. Aberturas deslizam ao longo da parede (componente projetada). */
export function moveElement(project: Project, id: string, delta: Vec2): Project {
  const el = requireElement(project, id);
  switch (el.type) {
    case "wall":
      return setWallEndpoints(project, id, { start: add(el.start, delta), end: add(el.end, delta) });
    case "floor":
    case "object":
      return updateElement(project, id, {
        position: { ...el.position, x: roundTo(el.position.x + delta.x, 9), y: roundTo(el.position.y + delta.y, 9) },
      });
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
  if (el.type === "floor" || el.type === "object") {
    return updateElement(project, id, { rotation: normalizeDegrees(el.rotation + deltaDeg) });
  }
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
  } else {
    created.push({
      ...el,
      id: createId(),
      name: nextName(pool(), prefix(el.name)),
      position: { ...el.position, x: el.position.x + shift.x, y: el.position.y + shift.y },
    });
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
    } else if (e.type === "door") stats.doors++;
    else if (e.type === "window") stats.windows++;
    else stats.objects++;
  }
  return stats;
}
