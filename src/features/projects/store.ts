"use client";

import { create } from "zustand";
import type { Project } from "@/core/model/schema";
import type { NewProjectInput } from "@/core/model/factory";
import type { ProjectSummary } from "@/persistence/summary";
import type { ActivityEvent } from "@/persistence/activity";
import { getProjectService } from "@/persistence/browser";
import { PersistenceError } from "@/persistence/errors";
import { downloadText, safeFileName } from "@/lib/download";
import { notify, reportError } from "@/ui/notifications";

type ProjectPatch = Partial<Pick<Project, "name" | "description" | "category" | "status" | "favorite">>;

interface ProjectsState {
  summaries: ProjectSummary[];
  activity: ActivityEvent[];
  loaded: boolean;
  loadError: string | null;
  refresh(): Promise<void>;
  create(input: Omit<NewProjectInput, "now">): Promise<Project | null>;
  duplicate(id: string): Promise<void>;
  remove(id: string): Promise<void>;
  update(id: string, patch: ProjectPatch): Promise<void>;
  importFile(file: File): Promise<Project | null>;
  exportProject(id: string): Promise<void>;
  createFrom(project: Project, name?: string): Promise<Project | null>;
}

/** Estado da biblioteca de projetos (dashboard). Fonte: ProjectService. */
export const useProjects = create<ProjectsState>((set, get) => {
  /** Executa um caso de uso, mostra erros esperados e recarrega a lista. */
  async function run<T>(fn: () => Promise<T>): Promise<T | null> {
    try {
      const result = await fn();
      await get().refresh();
      return result;
    } catch (error) {
      reportError(error);
      return null;
    }
  }

  return {
    summaries: [],
    activity: [],
    loaded: false,
    loadError: null,

    async refresh() {
      const service = getProjectService();
      try {
        const summaries = await service.list();
        set({ summaries, activity: service.activityLog(), loaded: true, loadError: null });
      } catch (error) {
        if (error instanceof PersistenceError) set({ loaded: true, loadError: error.message });
        else throw error;
      }
    },

    create: (input) => run(() => getProjectService().create(input)),

    async duplicate(id) {
      const copy = await run(() => getProjectService().duplicate(id));
      if (copy) notify("success", `Projeto duplicado: ${copy.name}`);
    },

    async remove(id) {
      const ok = await run(async () => {
        await getProjectService().delete(id);
        return true;
      });
      if (ok) notify("info", "Projeto excluído.");
    },

    async update(id, patch) {
      await run(() => getProjectService().update(id, patch));
    },

    async importFile(file) {
      const project = await run(async () => getProjectService().importJson(await file.text()));
      if (project) notify("success", `Projeto importado: ${project.name}`);
      return project;
    },

    createFrom: (project, name) => run(() => getProjectService().createFrom(project, name)),

    async exportProject(id) {
      await run(async () => {
        const service = getProjectService();
        const project = await service.open(id);
        if (!project) throw new PersistenceError("Projeto não encontrado.");
        downloadText(`${safeFileName(project.name)}.atlas.json`, service.exportJson(project));
      });
    },
  };
});
