import type { AtlasModuleInfo, QuantityLine, QuantityProvider } from "./contracts";
import { projectStats } from "@/core/model/operations";
import { isOpening } from "@/core/model/schema";
import { getMaterial } from "@/core/model/materials";
import { wallQuantities } from "@/core/geometry/wall";
import { floorArea, floorVolume } from "@/core/geometry/shapes";

/**
 * Registro de módulos. "ativo" = implementado e testado nesta versão.
 * "planejado" = limite de domínio reservado, sem funcionalidade ainda.
 */
export const MODULES: readonly AtlasModuleInfo[] = [
  { id: "core", name: "Núcleo geométrico", description: "Modelo paramétrico, unidades, geometria e persistência", status: "ativo", dependsOn: [] },
  { id: "architecture", name: "Arquitetura", description: "Paredes, aberturas, pisos e objetos", status: "ativo", dependsOn: ["core"] },
  { id: "cad2d", name: "CAD 2D", description: "Planta baixa com cotas (visualização); desenho 2D livre planejado", status: "ativo", dependsOn: ["core"] },
  { id: "quantities", name: "Quantitativos", description: "Comprimentos, áreas e volumes extraídos do modelo", status: "ativo", dependsOn: ["core", "architecture"] },
  { id: "bim", name: "BIM", description: "Pavimentos, classes IFC e propriedades técnicas", status: "planejado", dependsOn: ["core", "architecture"] },
  { id: "structural", name: "Engenharia estrutural", description: "Lançamento de elementos estruturais", status: "planejado", dependsOn: ["core", "bim"] },
  { id: "electrical", name: "Instalações elétricas", description: "Pontos, circuitos e quadros", status: "planejado", dependsOn: ["core", "bim"] },
  { id: "plumbing", name: "Instalações hidráulicas", description: "Água fria/quente, esgoto e pluvial", status: "planejado", dependsOn: ["core", "bim"] },
  { id: "joinery", name: "Marcenaria", description: "Móveis planejados, plano de corte", status: "planejado", dependsOn: ["core"] },
  { id: "stonework", name: "Marmoraria", description: "Bancadas, tampos, recortes e aproveitamento de chapas", status: "planejado", dependsOn: ["core"] },
  { id: "glazing", name: "Vidraçaria", description: "Vidros temperados, boxes e fachadas", status: "planejado", dependsOn: ["core"] },
  { id: "frames", name: "Esquadrias", description: "Tipologias e detalhamento de esquadrias", status: "planejado", dependsOn: ["core", "architecture"] },
  { id: "rendering", name: "Renderização", description: "Iluminação física e imagens fotorrealistas", status: "planejado", dependsOn: ["core"] },
  { id: "ai", name: "Inteligência artificial", description: "Assistente de projeto e geração de layouts", status: "planejado", dependsOn: ["core"] },
  { id: "budget", name: "Orçamentos", description: "Composições de custo sobre os quantitativos", status: "planejado", dependsOn: ["quantities"] },
  { id: "site", name: "Gestão de obras", description: "Cronograma, medições e diário de obra", status: "planejado", dependsOn: ["budget"] },
];

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Quantitativos do módulo de arquitetura (implementação real do contrato). */
export const architectureQuantities: QuantityProvider = {
  moduleId: "architecture",
  quantities(project) {
    const lines: QuantityLine[] = [];
    const openings = project.elements.filter(isOpening);
    for (const e of project.elements) {
      if (e.type === "wall") {
        const q = wallQuantities(e, openings);
        const mat = getMaterial(e.materialId).name;
        lines.push({ moduleId: "architecture", code: `${e.id}:area`, description: `${e.name} — ${mat} (área líquida)`, unit: "m²", quantity: r3(q.netArea) });
        lines.push({ moduleId: "architecture", code: `${e.id}:vol`, description: `${e.name} — volume`, unit: "m³", quantity: r3(q.volume) });
      } else if (e.type === "floor") {
        lines.push({ moduleId: "architecture", code: `${e.id}:area`, description: `${e.name} — ${getMaterial(e.materialId).name}`, unit: "m²", quantity: r3(floorArea(e)) });
        lines.push({ moduleId: "architecture", code: `${e.id}:vol`, description: `${e.name} — volume`, unit: "m³", quantity: r3(floorVolume(e)) });
      } else {
        lines.push({ moduleId: "architecture", code: e.id, description: e.name, unit: "un", quantity: 1 });
      }
    }
    return lines;
  },
};

export const QUANTITY_PROVIDERS: readonly QuantityProvider[] = [architectureQuantities];

export { projectStats };
