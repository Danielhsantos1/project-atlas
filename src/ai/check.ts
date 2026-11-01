import type { Project, Room } from "@/core/model/schema";
import { isOpening } from "@/core/model/schema";
import { roomShape } from "@/core/geometry/rooms";
import { validateOpening } from "@/core/geometry/wall";
import { levelWalls } from "@/core/model/operations";

export interface Finding {
  severity: "erro" | "aviso" | "info";
  message: string;
  elementId?: string;
}

/**
 * Verificador de inconsistências do modelo (regras geométricas e de bom senso).
 * NÃO é verificação normativa: não substitui análise de profissional habilitado.
 */
export function checkProject(project: Project): Finding[] {
  const out: Finding[] = [];
  const openings = project.elements.filter(isOpening);
  const rooms = project.elements.filter((e): e is Room => e.type === "room");
  if (rooms.length === 0) out.push({ severity: "aviso", message: "O projeto ainda não tem ambientes (cômodos) definidos." });
  for (const r of rooms) {
    const shape = roomShape(levelWalls(project, r.levelId), r.seed);
    if (!shape) {
      out.push({ severity: "erro", message: `${r.name}: não está fechado por paredes.`, elementId: r.id });
      continue;
    }
    const doors = openings.filter((o) => o.type === "door" && shape.wallIds.includes(o.hostId));
    const windows = openings.filter((o) => o.type === "window" && shape.wallIds.includes(o.hostId));
    if (doors.length === 0) out.push({ severity: "aviso", message: `${r.name}: sem porta ou passagem.`, elementId: r.id });
    if ((r.roomType === "quarto" || r.roomType === "suite" || r.roomType === "sala") && windows.length === 0) {
      out.push({ severity: "aviso", message: `${r.name}: ambiente de permanência prolongada sem janela.`, elementId: r.id });
    }
    if (r.roomType === "quarto" && shape.area < 6) out.push({ severity: "info", message: `${r.name}: área útil pequena (${shape.area.toFixed(1)} m²).`, elementId: r.id });
  }
  for (const o of openings) {
    const host = project.elements.find((e) => e.id === o.hostId);
    if (host?.type === "wall") for (const i of validateOpening(host, o, openings)) out.push({ severity: "erro", message: `${o.name}: ${i.message}`, elementId: o.id });
  }
  if (project.levels.length > 1 && !project.elements.some((e) => e.type === "object" && e.kind === "stair-straight")) {
    out.push({ severity: "erro", message: "Há mais de um pavimento, mas nenhuma escada." });
  }
  const top = [...project.levels].sort((a, b) => b.elevation - a.elevation)[0];
  if (top && !project.elements.some((e) => e.type === "roof")) out.push({ severity: "aviso", message: "O projeto não tem cobertura (telhado ou laje)." });
  for (const l of project.levels.slice(1)) {
    if (!project.elements.some((e) => e.type === "floor" && e.levelId === l.id)) out.push({ severity: "aviso", message: `${l.name}: sem laje/piso estrutural modelado.` });
  }
  return out;
}
