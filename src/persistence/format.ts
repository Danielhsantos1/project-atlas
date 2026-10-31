import { z } from "zod";
import { ProjectSchema, type Project } from "@/core/model/schema";
import { PersistenceError } from "./errors";

/**
 * Formato de arquivo/armazenamento do PROJECT ATLAS.
 *
 * Todo documento é gravado num envelope versionado. Ao evoluir o modelo:
 *   1. incremente CURRENT_FORMAT_VERSION;
 *   2. registre em MIGRATIONS a função que converte a versão anterior;
 *   3. adicione testes com um documento real da versão antiga.
 */
export const FORMAT_ID = "atlas.project";
export const CURRENT_FORMAT_VERSION = 1;

export const EnvelopeSchema = z.object({
  format: z.literal(FORMAT_ID),
  version: z.number().int().positive(),
  savedAt: z.string(),
  project: z.unknown(),
});
export type Envelope = z.infer<typeof EnvelopeSchema>;

/** Migração de documento da versão N para N+1 (chave = versão de origem). */
export type Migration = (project: unknown) => unknown;
export const MIGRATIONS: Readonly<Record<number, Migration>> = {};

export function toEnvelope(project: Project, now = new Date()): Envelope {
  return { format: FORMAT_ID, version: CURRENT_FORMAT_VERSION, savedAt: now.toISOString(), project };
}

/** Lê um envelope (já desserializado), aplica migrações e valida o projeto. */
export function fromEnvelope(
  raw: unknown,
  migrations: Readonly<Record<number, Migration>> = MIGRATIONS,
  currentVersion = CURRENT_FORMAT_VERSION,
): Project {
  const env = EnvelopeSchema.safeParse(raw);
  if (!env.success) {
    throw new PersistenceError("O conteúdo não é um projeto do PROJECT ATLAS (envelope ausente ou inválido).");
  }
  let { version, project } = env.data;
  if (version > currentVersion) {
    throw new PersistenceError(
      `Este projeto foi salvo pela versão ${version} do formato; esta aplicação suporta até a versão ${currentVersion}.`,
    );
  }
  while (version < currentVersion) {
    const migrate = migrations[version];
    if (!migrate) throw new PersistenceError(`Não há migração do formato ${version} para ${version + 1}.`);
    project = migrate(project);
    version++;
  }
  const parsed = ProjectSchema.safeParse(project);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new PersistenceError(
      `Projeto inválido: ${issue?.path.join(".") || "raiz"} — ${issue?.message ?? "erro de validação"}`,
    );
  }
  return parsed.data;
}

/** Serializa para JSON (exportação). */
export function exportProjectJson(project: Project, now = new Date()): string {
  return JSON.stringify(toEnvelope(project, now), null, 2);
}

/** Desserializa JSON importado. */
export function parseProjectJson(text: string): Project {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (cause) {
    throw new PersistenceError("Arquivo JSON inválido ou corrompido.", { cause });
  }
  return fromEnvelope(raw);
}
