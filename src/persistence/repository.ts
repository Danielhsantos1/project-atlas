import type { Project } from "@/core/model/schema";
import type { ProjectSummary } from "./summary";

/**
 * Contrato de persistência. A interface é assíncrona de propósito: a
 * implementação local (KeyValueProjectRepository) poderá ser substituída por
 * uma API HTTP + PostgreSQL sem mudar quem a consome.
 */
export interface ProjectRepository {
  list(): Promise<ProjectSummary[]>;
  get(id: string): Promise<Project | null>;
  /** Grava o projeto inteiro (geometria + propriedades + configurações). */
  save(project: Project): Promise<void>;
  delete(id: string): Promise<void>;
}

/** Subconjunto da Web Storage API — permite testes com armazenamento em memória. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export class MemoryStorage implements KeyValueStorage {
  private data = new Map<string, string>();
  getItem(key: string) {
    return this.data.has(key) ? this.data.get(key)! : null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, String(value));
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
  keys(): string[] {
    return [...this.data.keys()];
  }
}
