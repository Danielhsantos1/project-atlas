import type { Project } from "@/core/model/schema";

/**
 * Contratos de extensão do PROJECT ATLAS.
 *
 * Novos domínios (estrutural, elétrica, orçamentos...) se conectam ao núcleo
 * por estas interfaces, sem alterar o modelo geométrico central.
 */

/** Linha de quantitativo — base para orçamentos e listas de materiais. */
export interface QuantityLine {
  moduleId: string;
  code: string;
  description: string;
  unit: "m" | "m²" | "m³" | "un";
  quantity: number;
}

/** Módulo que extrai quantitativos do modelo. */
export interface QuantityProvider {
  moduleId: string;
  quantities(project: Project): QuantityLine[];
}

/** Formato de exportação plugável (JSON hoje; IFC/DXF/OBJ no futuro). */
export interface ProjectExporter {
  id: string;
  label: string;
  extension: string;
  mimeType: string;
  export(project: Project): string;
}

export type ModuleStatus = "ativo" | "planejado";

export interface AtlasModuleInfo {
  id: string;
  name: string;
  description: string;
  status: ModuleStatus;
  /** Módulos dos quais este depende (limites de domínio explícitos). */
  dependsOn: readonly string[];
}
