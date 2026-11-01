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
export const SERVICE_UNITS = ["m", "m²", "m³", "un", "L", "kg", "sc"] as const;
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

/**
 * Serviços e insumos do levantamento da CONSTRUÇÃO COMO UM TODO (construction.ts).
 * Códigos fixos e determinísticos. "sc" = saco (cimento 50 kg, cal 20 kg: ver basis da linha).
 * Linhas "informativo" (volumes de argamassa/concreto) são memória de cálculo e saem como opcionais.
 */
export const CONSTRUCTION_SERVICES = {
  // Alvenaria
  "MAT-BLOCO-CERAMICO": def("MAT-BLOCO-CERAMICO", "Bloco cerâmico de vedação (unidades)", "un", "materiais"),
  "MAT-BLOCO-CONCRETO": def("MAT-BLOCO-CONCRETO", "Bloco de concreto de vedação (unidades)", "un", "materiais"),
  "ALV-VERGA": def("ALV-VERGA", "Verga de concreto sobre aberturas (comprimento)", "m", "materiais"),
  "ALV-CONTRAVERGA": def("ALV-CONTRAVERGA", "Contraverga de concreto sob janelas (comprimento)", "m", "materiais"),
  "MAT-DRYWALL-CHAPA": def("MAT-DRYWALL-CHAPA", "Chapa de gesso acartonado, as duas faces (insumo)", "m²", "materiais"),
  "MAT-DRYWALL-MONTANTE": def("MAT-DRYWALL-MONTANTE", "Montante de aço para drywall (comprimento)", "m", "materiais"),
  "MAT-DRYWALL-GUIA": def("MAT-DRYWALL-GUIA", "Guia de aço para drywall (comprimento)", "m", "materiais"),
  // Argamassas (volumes: memória de cálculo)
  "ARG-ASSENTAMENTO": def("ARG-ASSENTAMENTO", "Argamassa de assentamento de alvenaria (volume, com perda)", "m³", "materiais"),
  "ARG-CHAPISCO-INT": def("ARG-CHAPISCO-INT", "Chapisco interno (volume de argamassa, com perda)", "m³", "materiais"),
  "ARG-CHAPISCO-EXT": def("ARG-CHAPISCO-EXT", "Chapisco externo (volume de argamassa, com perda)", "m³", "materiais"),
  "ARG-EMBOCO-INT": def("ARG-EMBOCO-INT", "Emboço interno (volume de argamassa, com perda)", "m³", "materiais"),
  "ARG-EMBOCO-EXT": def("ARG-EMBOCO-EXT", "Emboço externo / massa única (volume de argamassa, com perda)", "m³", "materiais"),
  "ARG-REBOCO-INT": def("ARG-REBOCO-INT", "Reboco interno (volume de argamassa, com perda)", "m³", "materiais"),
  "ARG-REBOCO-EXT": def("ARG-REBOCO-EXT", "Reboco externo (volume de argamassa, com perda)", "m³", "materiais"),
  // Insumos consolidados (cimento, cal, agregados)
  "MAT-CIMENTO": def("MAT-CIMENTO", "Cimento Portland (sacos)", "sc", "materiais"),
  "MAT-CAL": def("MAT-CAL", "Cal hidratada (sacos)", "sc", "materiais"),
  "MAT-AREIA": def("MAT-AREIA", "Areia (volume solto, com inchamento)", "m³", "materiais"),
  "MAT-BRITA": def("MAT-BRITA", "Brita (volume solto)", "m³", "materiais"),
  // Estrutura
  "EST-FUNDACAO": def("EST-FUNDACAO", "Baldrame / fundação CONCEITUAL (volume de concreto)", "m³", "materiais"),
  "EST-CONCRETO-ENG": def("EST-CONCRETO-ENG", "Concreto estrutural informado pelo engenheiro (volume)", "m³", "materiais"),
  "EST-CONCRETO-PAREDE": def("EST-CONCRETO-PAREDE", "Concreto das paredes moldadas in loco (volume)", "m³", "materiais"),
  "EST-CONCRETO-TOTAL": def("EST-CONCRETO-TOTAL", "Concreto estrutural total, com perda (volume)", "m³", "materiais"),
  "MAT-ACO": def("MAT-ACO", "Aço para concreto armado (massa, sem detalhar bitolas)", "kg", "materiais"),
  "EST-FORMA": def("EST-FORMA", "Fôrma de concreto (área de contato)", "m²", "materiais"),
  // Pisos e revestimentos
  CONTRAPISO: def("CONTRAPISO", "Contrapiso / regularização (volume)", "m³", "acabamentos"),
  "MAT-ARG-COLANTE": def("MAT-ARG-COLANTE", "Argamassa colante (massa)", "kg", "acabamentos"),
  "MAT-REJUNTE": def("MAT-REJUNTE", "Rejunte (massa)", "kg", "acabamentos"),
  "REVEST-CERAMICO-PAREDE": def("REVEST-CERAMICO-PAREDE", "Revestimento cerâmico de parede em áreas molhadas", "m²", "acabamentos"),
  "ACAB-RODAPE": def("ACAB-RODAPE", "Rodapé (comprimento)", "m", "acabamentos"),
  "ACAB-SOLEIRA": def("ACAB-SOLEIRA", "Soleira nas portas (comprimento)", "m", "acabamentos"),
  "ACAB-PEITORIL": def("ACAB-PEITORIL", "Peitoril das janelas (comprimento)", "m", "acabamentos"),
  // Pintura e acabamentos internos x externos (a tinta de paredes é PINT-TINTA, do takeoff)
  "PINT-INT-SELADOR": def("PINT-INT-SELADOR", "Selador para paredes internas (insumo)", "L", "acabamentos"),
  "PINT-INT-MASSA": def("PINT-INT-MASSA", "Massa corrida para paredes internas (insumo)", "kg", "acabamentos"),
  "PINT-EXT-SELADOR": def("PINT-EXT-SELADOR", "Selador para fachadas (insumo)", "L", "acabamentos"),
  "PINT-EXT-MASSA": def("PINT-EXT-MASSA", "Massa acrílica para fachadas (insumo)", "kg", "acabamentos"),
  "PINT-EXT-TEXTURA": def("PINT-EXT-TEXTURA", "Textura acrílica para fachadas (insumo)", "kg", "acabamentos"),
  "PINT-FORRO": def("PINT-FORRO", "Pintura de forro (aplicação)", "m²", "acabamentos"),
  "PINT-FORRO-TINTA": def("PINT-FORRO-TINTA", "Tinta para forro (insumo)", "L", "acabamentos"),
  // Cobertura
  "MAT-TELHA-CERAMICA": def("MAT-TELHA-CERAMICA", "Telha cerâmica (unidades)", "un", "materiais"),
  "MAT-TELHA-CUMEEIRA": def("MAT-TELHA-CUMEEIRA", "Telha de cumeeira / espigão (unidades)", "un", "materiais"),
  "COB-ESPIGAO": def("COB-ESPIGAO", "Espigões do telhado (comprimento)", "m", "materiais"),
  "COB-CALHA": def("COB-CALHA", "Calha / linha de beiral para coleta (comprimento, sem dimensionar)", "m", "materiais"),
  "COB-RUFO": def("COB-RUFO", "Rufos de empena e encontros (comprimento, sem dimensionar)", "m", "materiais"),
  "COB-ESTRUTURA": def("COB-ESTRUTURA", "Estrutura do telhado (a dimensionar)", "m²", "materiais"),
} as const satisfies Record<string, ServiceDefinition>;

/** Serviços de código fixo. */
export const STATIC_SERVICES = {
  ...CONSTRUCTION_SERVICES,
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
    case "kg":
    case "quilo":
      return "kg";
    case "sc":
    case "saco":
    case "sacos":
      return "sc";
    default:
      return null;
  }
}
