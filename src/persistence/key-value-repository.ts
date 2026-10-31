import { z } from "zod";
import type { Project } from "@/core/model/schema";
import { PersistenceError } from "./errors";
import { fromEnvelope, toEnvelope } from "./format";
import type { KeyValueStorage, ProjectRepository } from "./repository";
import { ProjectSummarySchema, buildSummary, type ProjectSummary } from "./summary";

const INDEX_KEY = "atlas:v1:index";
const projectKey = (id: string) => `atlas:v1:project:${id}`;
const IndexSchema = z.array(ProjectSummarySchema);

/** Repositório sobre armazenamento chave-valor (localStorage no navegador). */
export class KeyValueProjectRepository implements ProjectRepository {
  constructor(private readonly storage: KeyValueStorage) {}

  private readIndex(): ProjectSummary[] {
    const raw = this.storage.getItem(INDEX_KEY);
    if (raw === null) return [];
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch (cause) {
      throw new PersistenceError("O índice de projetos está corrompido.", { cause });
    }
    const parsed = IndexSchema.safeParse(json);
    if (!parsed.success) throw new PersistenceError("O índice de projetos tem formato inválido.");
    return parsed.data;
  }

  private write(key: string, value: string) {
    try {
      this.storage.setItem(key, value);
    } catch (cause) {
      const quota = cause instanceof Error && /quota/i.test(cause.name + cause.message);
      throw new PersistenceError(
        quota
          ? "Espaço de armazenamento local esgotado. Exporte e exclua projetos antigos."
          : "Não foi possível gravar no armazenamento local.",
        { cause },
      );
    }
  }

  async list(): Promise<ProjectSummary[]> {
    return [...this.readIndex()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(id: string): Promise<Project | null> {
    const raw = this.storage.getItem(projectKey(id));
    if (raw === null) return null;
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch (cause) {
      throw new PersistenceError("Os dados deste projeto estão corrompidos.", { cause });
    }
    return fromEnvelope(json);
  }

  async save(project: Project): Promise<void> {
    // Grava o documento primeiro; o índice só é atualizado após sucesso.
    this.write(projectKey(project.id), JSON.stringify(toEnvelope(project)));
    const index = this.readIndex().filter((s) => s.id !== project.id);
    index.push(buildSummary(project));
    this.write(INDEX_KEY, JSON.stringify(index));
  }

  async delete(id: string): Promise<void> {
    this.storage.removeItem(projectKey(id));
    this.write(INDEX_KEY, JSON.stringify(this.readIndex().filter((s) => s.id !== id)));
  }
}
