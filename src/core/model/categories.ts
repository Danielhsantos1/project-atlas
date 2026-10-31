import type { ProjectCategory, ProjectStatus } from "./schema";

export interface CategoryInfo {
  id: ProjectCategory;
  label: string;
  description: string;
}

export const CATEGORIES: readonly CategoryInfo[] = [
  { id: "residencial", label: "Residencial", description: "Casas, sobrados e unidades habitacionais" },
  { id: "comercial", label: "Comercial", description: "Lojas, escritórios e salas comerciais" },
  { id: "predial", label: "Predial", description: "Edifícios de múltiplos pavimentos" },
  { id: "interiores", label: "Interiores", description: "Layout, ambientação e reformas internas" },
  { id: "moveis", label: "Móveis", description: "Móveis planejados e marcenaria" },
  { id: "marmoraria", label: "Marmoraria", description: "Bancadas, tampos e revestimentos em pedra" },
  { id: "vidracaria", label: "Vidraçaria", description: "Vidros, boxes, fachadas e esquadrias" },
  { id: "engenharia", label: "Engenharia", description: "Estudos técnicos e de engenharia" },
  { id: "especiais", label: "Projetos especiais", description: "Projetos fora das categorias padrão" },
];

export const categoryLabel = (id: ProjectCategory): string =>
  CATEGORIES.find((c) => c.id === id)?.label ?? id;

export const STATUS_LABEL: Record<ProjectStatus, string> = {
  "em-andamento": "Em andamento",
  concluido: "Concluído",
  arquivado: "Arquivado",
};
