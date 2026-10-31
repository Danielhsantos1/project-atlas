import { z } from "zod";
import { createId } from "@/core/model/ids";
import type { KeyValueStorage } from "./repository";

const KEY = "atlas:v1:activity";
const MAX_EVENTS = 300;
/** Salvamentos/aberturas consecutivos do mesmo projeto dentro desta janela viram um único evento. */
const COALESCE_MS = 10 * 60 * 1000;
const COALESCED: ReadonlySet<string> = new Set(["saved", "opened"]);

export const ACTIVITY_TYPES = ["created", "opened", "saved", "duplicated", "deleted", "imported", "exported"] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const ActivityEventSchema = z.object({
  id: z.string(),
  type: z.enum(ACTIVITY_TYPES),
  projectId: z.string(),
  projectName: z.string(),
  at: z.string(),
});
export type ActivityEvent = z.infer<typeof ActivityEventSchema>;

/** Registro de atividade real do usuário (alimenta os indicadores do dashboard). */
export class ActivityLog {
  constructor(private readonly storage: KeyValueStorage) {}

  list(): ActivityEvent[] {
    const raw = this.storage.getItem(KEY);
    if (raw === null) return [];
    try {
      const parsed = z.array(ActivityEventSchema).safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : [];
    } catch {
      // O histórico de atividade é auxiliar: se corromper, recomeça vazio (projetos não são afetados).
      return [];
    }
  }

  record(type: ActivityType, project: { id: string; name: string }, now = new Date()): void {
    const events = this.list();
    const last = events[0];
    if (
      COALESCED.has(type) &&
      last?.type === type &&
      last.projectId === project.id &&
      now.getTime() - new Date(last.at).getTime() < COALESCE_MS
    ) {
      events[0] = { ...last, projectName: project.name, at: now.toISOString() };
    } else {
      events.unshift({ id: createId(), type, projectId: project.id, projectName: project.name, at: now.toISOString() });
    }
    try {
      this.storage.setItem(KEY, JSON.stringify(events.slice(0, MAX_EVENTS)));
    } catch {
      // Sem espaço: descarta o histórico auxiliar para priorizar os projetos.
      this.storage.removeItem(KEY);
    }
  }
}
