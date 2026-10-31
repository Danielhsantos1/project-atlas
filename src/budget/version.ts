import { z } from "zod";
import type { Project } from "@/core/model/schema";
import { createId } from "@/core/model/ids";
import { BudgetSchema, type Budget } from "./budget";

/**
 * Versionamento do orçamento: cada orçamento/proposta guarda o hash da
 * revisão do modelo de onde saiu, para saber se ainda corresponde ao projeto.
 */

/** JSON canônico: chaves de objetos em ordem alfabética, sem espaços. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) return "null";
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? "null" : canonicalJson(v))).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

const FNV64_OFFSET = 0xcbf29ce484222325n;
const FNV64_PRIME = 0x100000001b3n;
const MASK64 = 0xffffffffffffffffn;

/** FNV-1a de 64 bits sobre os bytes UTF-8; resultado em 16 dígitos hexadecimais. */
export function fnv1a64Hex(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let h = FNV64_OFFSET;
  for (const b of bytes) {
    h ^= BigInt(b);
    h = (h * FNV64_PRIME) & MASK64;
  }
  return h.toString(16).padStart(16, "0");
}

/**
 * Hash determinístico da revisão do modelo: considera pavimentos, elementos e
 * configurações. Nome, descrição, status e datas NÃO alteram o hash.
 */
export function projectRevisionHash(project: Pick<Project, "levels" | "elements" | "settings">): string {
  return fnv1a64Hex(canonicalJson({ levels: project.levels, elements: project.elements, settings: project.settings }));
}

export interface ProjectVersionStamp {
  projectId: string;
  revisionHash: string;
  projectUpdatedAt: string;
}

export function projectVersionStamp(project: Project): ProjectVersionStamp {
  return { projectId: project.id, revisionHash: projectRevisionHash(project), projectUpdatedAt: project.updatedAt };
}

/** O orçamento/proposta corresponde exatamente à revisão atual do projeto? */
export function isBudgetCurrent(snapshot: Pick<ProjectVersionStamp, "revisionHash"> & { projectId?: string }, project: Project): boolean {
  if (snapshot.projectId !== undefined && snapshot.projectId !== project.id) return false;
  return snapshot.revisionHash === projectRevisionHash(project);
}

/** Orçamento congelado, amarrado à revisão exata do projeto. */
export const BudgetSnapshotSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  revisionHash: z.string().min(1),
  projectUpdatedAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
  label: z.string().max(200),
  budget: BudgetSchema,
});
export type BudgetSnapshot = z.infer<typeof BudgetSnapshotSchema>;

export function createBudgetSnapshot(project: Project, budget: Budget, opts: { label?: string; now?: Date } = {}): BudgetSnapshot {
  return {
    id: createId(),
    ...projectVersionStamp(project),
    createdAt: (opts.now ?? new Date()).toISOString(),
    label: opts.label ?? "",
    budget: structuredClone(budget),
  };
}
