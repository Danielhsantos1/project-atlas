import { z } from "zod";
import type { ObjectKind, WallCore } from "@/core/model/schema";
import { getMaterial } from "@/core/model/materials";
import type { BudgetCategory } from "./categories";

/**
 * Catálogo de serviços (composições) do orçamento.
 *
 * Os códigos são ESTÁVEIS: preços são vinculados a eles. Códigos dinâmicos
 * (PISO-<material>, PORTA-<l>X<a>-<material>...) são determinísticos — o mesmo
 * modelo sempre gera o mesmo código.
 */
export const SERVICE_UNITS = ["m", "m²", "m³", "un", "L"] as const;
export const ServiceUnitSchema = z.enum(SERVICE_UNITS);
export type ServiceUnit = z.infer<typeof ServiceUnitSchema>;

export interface ServiceDefinition {
  code: string;
  description: string;
  unit: ServiceUnit;
  /** Categoria do MATERIAL do serviço (mão de obra/equipamentos têm categoria própria no orçamento). */
  category: BudgetCategory;
}

const def = (code: string, description: string, unit: ServiceUnit, category: BudgetCategory): ServiceDefinition => ({ code, description, unit, category });

/** Serviços de código fixo. */
export const STATIC_SERVICES = {
  "ALV-BLOCO-CERAMICO": def("ALV-BLOCO-CERAMICO", "Alvenaria de vedação em bloco cerâmico", "m²", "materiais"),
  "ALV-BLOCO-CONCRETO": def("ALV-BLOCO-CONCRETO", "Alvenaria de vedação em bloco de concreto", "m²", "materiais"),
  "ALV-CONCRETO": def("ALV-CONCRETO", "Parede de concreto moldada in loco", "m²", "materiais"),
  "ALV-DRYWALL": def("ALV-DRYWALL", "Divisória em gesso acartonado (drywall)", "m²", "materiais"),
  "REVEST-REBOCO": def("REVEST-REBOCO", "Revestimento em argamassa (chapisco + reboco), paredes", "m²", "acabamentos"),
  "PINT-PAREDE": def("PINT-PAREDE", "Pintura de paredes (aplicação, incluindo preparo)", "m²", "acabamentos"),
  "PINT-TINTA": def("PINT-TINTA", "Tinta para paredes (insumo)", "L", "acabamentos"),
  "FORRO-GESSO": def("FORRO-GESSO", "Forro de gesso", "m²", "acabamentos"),
  "LAJE-CONCRETO": def("LAJE-CONCRETO", "Laje de concreto (volume)", "m³", "materiais"),
  "EST-CONCRETO": def("EST-CONCRETO", "Estrutura de concreto - pilares e vigas (volume)", "m³", "materiais"),
  "COB-CUMEEIRA": def("COB-CUMEEIRA", "Cumeeira do telhado", "m", "materiais"),
  "BANCADA-PEDRA": def("BANCADA-PEDRA", "Bancada / tampo em pedra", "m²", "moveis-planejados"),
  PISCINA: def("PISCINA", "Piscina - área de espelho d'água", "m²", "servicos"),
  "PISCINA-UN": def("PISCINA-UN", "Piscina (unidade)", "un", "servicos"),
  "PAISAGISMO-GRAMA": def("PAISAGISMO-GRAMA", "Plantio de grama", "m²", "servicos"),
  "PAISAGISMO-ARVORE": def("PAISAGISMO-ARVORE", "Plantio de árvore", "un", "servicos"),
  "PAISAGISMO-ARBUSTO": def("PAISAGISMO-ARBUSTO", "Plantio de arbusto", "un", "servicos"),
  CHURRASQUEIRA: def("CHURRASQUEIRA", "Churrasqueira", "un", "servicos"),
  "ESCADA-RETA": def("ESCADA-RETA", "Escada reta (a detalhar por profissional)", "un", "servicos"),
} as const satisfies Record<string, ServiceDefinition>;

export type StaticServiceCode = keyof typeof STATIC_SERVICES;

/** Segmento de código a partir de um id (ex.: "wood-oak" → "WOOD-OAK"). */
export const codeSegment = (id: string): string => id.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Centímetros inteiros para compor códigos e descrições. */
export const toCm = (m: number): number => Math.round(m * 100);

export const WALL_CORE_SERVICE: Record<WallCore, StaticServiceCode> = {
  "ceramic-brick": "ALV-BLOCO-CERAMICO",
  "concrete-block": "ALV-BLOCO-CONCRETO",
  concrete: "ALV-CONCRETO",
  drywall: "ALV-DRYWALL",
};

export const OBJECT_KIND_LABEL: Record<ObjectKind, string> = {
  "column-rect": "Pilar retangular",
  "column-round": "Pilar circular",
  beam: "Viga",
  "stair-straight": "Escada reta",
  table: "Mesa",
  chair: "Cadeira",
  sofa: "Sofá",
  bed: "Cama",
  countertop: "Bancada",
  "cabinet-base": "Armário inferior",
  "cabinet-wall": "Armário aéreo",
  wardrobe: "Guarda-roupa",
  toilet: "Bacia sanitária",
  washbasin: "Lavatório / cuba",
  shower: "Chuveiro / box",
  "kitchen-island": "Ilha de cozinha",
  "sink-cabinet": "Gabinete de pia",
  cooktop: "Cooktop",
  "oven-tower": "Torre de fornos",
  fridge: "Geladeira",
  "tv-rack": "Rack de TV",
  tv: "Televisor",
  "tv-panel": "Painel de TV",
  nightstand: "Criado-mudo",
  desk: "Escrivaninha",
  "bath-vanity": "Gabinete de banheiro",
  pool: "Piscina",
  tree: "Árvore",
  shrub: "Arbusto",
  grill: "Churrasqueira",
  car: "Automóvel",
};

const materialName = (materialId: string) => getMaterial(materialId).name;

export function floorFinishService(materialId: string): ServiceDefinition {
  return def(`PISO-${codeSegment(materialId)}`, `Piso / revestimento de piso - ${materialName(materialId)}`, "m²", "acabamentos");
}

export function ceilingService(materialId: string): ServiceDefinition {
  if (materialId === "gypsum") return STATIC_SERVICES["FORRO-GESSO"];
  return def(`FORRO-${codeSegment(materialId)}`, `Forro - ${materialName(materialId)}`, "m²", "acabamentos");
}

export function roofCoverService(materialId: string): ServiceDefinition {
  return def(`COB-${codeSegment(materialId)}`, `Cobertura - ${materialName(materialId)}`, "m²", "materiais");
}

/** Esquadria (porta de giro, porta de correr ou janela). Vãos livres não geram esquadria. */
export function openingService(type: "door" | "window", width: number, height: number, materialId: string, style: "swing" | "sliding" = "swing"): ServiceDefinition {
  const w = toCm(width);
  const h = toCm(height);
  const sliding = type === "door" && style === "sliding";
  const prefix = type === "door" ? (sliding ? "PORTA-CORRER" : "PORTA") : "JANELA";
  const label = type === "door" ? (sliding ? "Porta de correr" : "Porta") : "Janela";
  return def(`${prefix}-${w}X${h}-${codeSegment(materialId)}`, `${label} ${w} x ${h} cm - ${materialName(materialId)}`, "un", "esquadrias");
}

export function structureService(materialId: string): ServiceDefinition {
  if (materialId.startsWith("concrete")) return STATIC_SERVICES["EST-CONCRETO"];
  return def(`EST-${codeSegment(materialId)}`, `Estrutura - pilares e vigas em ${materialName(materialId)} (volume)`, "m³", "materiais");
}

export function countertopService(materialId: string): ServiceDefinition {
  if (getMaterial(materialId).group === "Pedra") return STATIC_SERVICES["BANCADA-PEDRA"];
  return def(`BANCADA-${codeSegment(materialId)}`, `Bancada / tampo - ${materialName(materialId)}`, "m²", "moveis-planejados");
}

/** Vão livre (passagem sem folha): listado para conferência, sem custo de esquadria. */
export function passageService(width: number, height: number): ServiceDefinition {
  const w = toCm(width);
  const h = toCm(height);
  return def(`VAO-LIVRE-${w}X${h}`, `Vão livre ${w} x ${h} cm (passagem sem folha)`, "un", "servicos");
}

/** Móveis planejados (sob medida). */
export const PLANNED_FURNITURE_KINDS = ["cabinet-base", "cabinet-wall", "wardrobe", "kitchen-island", "sink-cabinet", "bath-vanity", "tv-panel"] as const satisfies readonly ObjectKind[];
/** Louças e metais sanitários. */
export const FIXTURE_KINDS = ["toilet", "washbasin", "shower"] as const satisfies readonly ObjectKind[];
/** Equipamentos/eletrodomésticos (itens opcionais). */
export const EQUIPMENT_KINDS = ["cooktop", "oven-tower", "fridge", "tv"] as const satisfies readonly ObjectKind[];
/** Mobiliário solto / itens de decoração (opcionais, só com includeLooseFurniture). */
export const LOOSE_KINDS = ["sofa", "bed", "table", "chair", "desk", "nightstand", "tv-rack", "car"] as const satisfies readonly ObjectKind[];

export function plannedFurnitureService(kind: ObjectKind): ServiceDefinition {
  return def(`MOV-${codeSegment(kind)}`, `${OBJECT_KIND_LABEL[kind]} (móvel planejado)`, "un", "moveis-planejados");
}

export function fixtureService(kind: ObjectKind): ServiceDefinition {
  return def(`LOUCA-${codeSegment(kind)}`, `${OBJECT_KIND_LABEL[kind]} (louça / metal sanitário)`, "un", "acabamentos");
}

export function equipmentService(kind: ObjectKind): ServiceDefinition {
  return def(`EQUIP-${codeSegment(kind)}`, `${OBJECT_KIND_LABEL[kind]} (equipamento)`, "un", "equipamentos");
}

export function looseItemService(kind: ObjectKind): ServiceDefinition {
  return def(`SOLTO-${codeSegment(kind)}`, `${OBJECT_KIND_LABEL[kind]} (mobiliário solto / item avulso)`, "un", "custos-adicionais");
}

/** Normaliza unidades vindas de planilhas externas (SINAPI, fornecedores). Retorna null se desconhecida. */
export function normalizeUnit(raw: string): ServiceUnit | null {
  const u = raw.trim().toLowerCase().replace(/\s+/g, "").replace("2", "²").replace("3", "³");
  switch (u) {
    case "m":
    case "ml":
      return "m";
    case "m²":
      return "m²";
    case "m³":
      return "m³";
    case "un":
    case "und":
    case "unid":
    case "pç":
    case "pc":
      return "un";
    case "l":
    case "lt":
    case "litro":
      return "L";
    default:
      return null;
  }
}
