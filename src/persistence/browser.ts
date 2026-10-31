"use client";

import { ActivityLog } from "./activity";
import { KeyValueProjectRepository } from "./key-value-repository";
import { ProjectService } from "./project-service";

let service: ProjectService | null = null;

/**
 * Instância do serviço no navegador (localStorage). Para migrar para
 * PostgreSQL, troque apenas a implementação do repositório aqui.
 */
export function getProjectService(): ProjectService {
  if (typeof window === "undefined") {
    throw new Error("getProjectService() só pode ser usado no navegador.");
  }
  service ??= new ProjectService(
    new KeyValueProjectRepository(window.localStorage),
    new ActivityLog(window.localStorage),
  );
  return service;
}
