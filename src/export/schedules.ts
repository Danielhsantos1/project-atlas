import type { Door, Opening, Project, Wall, Window } from "../core/model/schema";
import { isOpening, isRoom, isWall } from "../core/model/schema";
import { roomShape } from "../core/geometry/rooms";
import { getMaterial } from "../core/model/materials";
import { fmtLen } from "./format";

/**
 * Quadros do projeto: esquadrias (agrupando iguais) e áreas úteis.
 * Os CÓDIGOS (P1, J1, V1...) são numerados no projeto inteiro, para que a
 * mesma esquadria tenha o mesmo código em todos os pavimentos.
 */
export interface OpeningType {
  code: string;
  kind: "door" | "window";
  style: "swing" | "sliding" | "opening" | "window";
  typeLabel: string;
  width: number;
  height: number;
  sill: number;
  materialId: string;
  materialName: string;
  /** Quantidade no escopo pedido (pavimento ou projeto). */
  quantity: number;
  /** "L x A x P" em metros, ex.: "0,80x2,10x0,00". */
  dimensions: string;
}

export interface OpeningSchedule {
  types: OpeningType[];
  /** id da abertura → código. */
  codeOf: Map<string, string>;
}

const mm = (v: number) => Math.round(v * 1000);

function describe(o: Opening): { kind: "door" | "window"; style: OpeningType["style"]; typeLabel: string; prefix: string } {
  if (o.type === "window") return { kind: "window", style: "window", typeLabel: "Janela", prefix: "J" };
  const d = o as Door;
  if (d.style === "sliding") return { kind: "door", style: "sliding", typeLabel: "Porta de correr", prefix: "P" };
  if (d.style === "opening") return { kind: "door", style: "opening", typeLabel: "Vão livre", prefix: "V" };
  return { kind: "door", style: "swing", typeLabel: "Porta de giro", prefix: "P" };
}

const keyOf = (o: Opening): string => {
  const d = describe(o);
  const sill = o.type === "window" ? (o as Window).sillHeight : 0;
  return [d.style, mm(o.width), mm(o.height), mm(sill), o.materialId].join("|");
};

/** Aberturas hospedadas em paredes existentes, na ordem do projeto. */
export function projectOpenings(project: Pick<Project, "elements">): Opening[] {
  const walls = new Set(project.elements.filter(isWall).map((w) => w.id));
  return project.elements.filter((e): e is Opening => isOpening(e) && walls.has(e.hostId));
}

export function buildOpeningSchedule(project: Pick<Project, "elements">, levelId?: string): OpeningSchedule {
  const wallById = new Map(project.elements.filter(isWall).map((w): [string, Wall] => [w.id, w]));
  const all = projectOpenings(project);
  const codes = new Map<string, string>(); // chave → código
  const counters: Record<string, number> = {};
  const codeOf = new Map<string, string>();
  const info = new Map<string, OpeningType>();
  for (const o of all) {
    const key = keyOf(o);
    const d = describe(o);
    let code = codes.get(key);
    if (!code) {
      counters[d.prefix] = (counters[d.prefix] ?? 0) + 1;
      code = `${d.prefix}${counters[d.prefix]}`;
      codes.set(key, code);
      const sill = o.type === "window" ? (o as Window).sillHeight : 0;
      info.set(code, {
        code,
        kind: d.kind,
        style: d.style,
        typeLabel: d.typeLabel,
        width: o.width,
        height: o.height,
        sill,
        materialId: o.materialId,
        materialName: getMaterial(o.materialId).name,
        quantity: 0,
        dimensions: `${fmtLen(o.width)}x${fmtLen(o.height)}x${fmtLen(sill)}`,
      });
    }
    codeOf.set(o.id, code);
    if (!levelId || wallById.get(o.hostId)?.levelId === levelId) info.get(code)!.quantity++;
  }
  const types = [...info.values()].filter((t) => t.quantity > 0);
  return { types, codeOf };
}

export interface AreaRow {
  roomId: string;
  name: string;
  levelName: string;
  area: number;
}

/** Ambientes fechados (com contorno) de um pavimento, com área útil. */
export function buildAreaRows(project: Pick<Project, "elements" | "levels">, levelId: string): { rows: AreaRow[]; open: string[] } {
  const level = project.levels.find((l) => l.id === levelId);
  const walls = project.elements.filter((e): e is Wall => isWall(e) && e.levelId === levelId);
  const rows: AreaRow[] = [];
  const open: string[] = [];
  for (const r of project.elements.filter(isRoom)) {
    if (r.levelId !== levelId) continue;
    const shape = roomShape(walls, r.seed);
    if (!shape) open.push(r.name);
    else rows.push({ roomId: r.id, name: r.name, levelName: level?.name ?? "", area: shape.area });
  }
  return { rows, open };
}

/** Soma das áreas úteis de todos os pavimentos. */
export function totalProjectArea(project: Pick<Project, "elements" | "levels">): number {
  let total = 0;
  for (const l of project.levels) total += buildAreaRows(project, l.id).rows.reduce((s, r) => s + r.area, 0);
  return total;
}
