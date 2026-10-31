import type { Project } from "@/core/model/schema";
import { createProject, type NewProjectInput } from "@/core/model/factory";
import { createId } from "@/core/model/ids";
import { DomainError } from "@/core/model/errors";
import { ProjectSchema } from "@/core/model/schema";
import type { ProjectRepository } from "./repository";
import type { ActivityLog } from "./activity";
import { exportProjectJson, parseProjectJson } from "./format";

/**
 * Casos de uso de projeto (camada de aplicação). A interface conversa com
 * este serviço; o serviço conversa com o repositório.
 */
export class ProjectService {
  constructor(
    private readonly repo: ProjectRepository,
    private readonly activity: ActivityLog,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  list() {
    return this.repo.list();
  }

  async open(id: string): Promise<Project | null> {
    const p = await this.repo.get(id);
    if (p) this.activity.record("opened", p, this.clock());
    return p;
  }

  async create(input: Omit<NewProjectInput, "now">): Promise<Project> {
    const project = createProject({ ...input, now: this.clock() });
    await this.repo.save(project);
    this.activity.record("created", project, this.clock());
    return project;
  }

  /** Grava o estado atual do projeto, atualizando a data de modificação. */
  async save(project: Project): Promise<Project> {
    const parsed = ProjectSchema.safeParse({ ...project, updatedAt: this.clock().toISOString() });
    if (!parsed.success) throw new DomainError(`Projeto inválido: ${parsed.error.issues[0]?.message}`);
    await this.repo.save(parsed.data);
    this.activity.record("saved", parsed.data, this.clock());
    return parsed.data;
  }

  private async require(id: string): Promise<Project> {
    const p = await this.repo.get(id);
    if (!p) throw new DomainError("Projeto não encontrado.");
    return p;
  }

  async update(id: string, patch: Partial<Pick<Project, "name" | "description" | "category" | "status" | "favorite">>) {
    const p = await this.require(id);
    return this.save({ ...p, ...patch });
  }

  async duplicate(id: string): Promise<Project> {
    const source = await this.require(id);
    const now = this.clock().toISOString();
    const copy: Project = {
      ...structuredClone(source),
      id: createId(),
      name: `${source.name} (cópia)`.slice(0, 120),
      favorite: false,
      createdAt: now,
      updatedAt: now,
    };
    await this.repo.save(copy);
    this.activity.record("duplicated", copy, this.clock());
    return copy;
  }

  async delete(id: string): Promise<void> {
    const p = await this.repo.get(id);
    await this.repo.delete(id);
    if (p) this.activity.record("deleted", p, this.clock());
  }

  /** Exporta o documento completo (geometria + propriedades + configurações) em JSON. */
  exportJson(project: Project): string {
    this.activity.record("exported", project, this.clock());
    return exportProjectJson(project, this.clock());
  }

  /** Importa como NOVO projeto (nunca sobrescreve um existente). */
  async importJson(text: string): Promise<Project> {
    const imported = parseProjectJson(text);
    const now = this.clock().toISOString();
    const project: Project = { ...imported, id: createId(), createdAt: now, updatedAt: now };
    await this.repo.save(project);
    this.activity.record("imported", project, this.clock());
    return project;
  }

  activityLog() {
    return this.activity.list();
  }
}
