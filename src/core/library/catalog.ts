import type { ObjectKind } from "../model/schema";

/**
 * Biblioteca inicial. Cada item é uma especificação paramétrica (não um
 * modelo 3D fixo): ao inserir, vira um elemento com propriedades editáveis.
 */
export type LibraryCategory =
  | "paredes"
  | "portas"
  | "janelas"
  | "pisos"
  | "colunas"
  | "escadas"
  | "moveis"
  | "bancadas"
  | "armarios"
  | "sanitarios";

export const LIBRARY_CATEGORIES: ReadonlyArray<{ id: LibraryCategory; label: string }> = [
  { id: "paredes", label: "Paredes" },
  { id: "portas", label: "Portas" },
  { id: "janelas", label: "Janelas" },
  { id: "pisos", label: "Pisos e lajes" },
  { id: "colunas", label: "Colunas" },
  { id: "escadas", label: "Escadas" },
  { id: "moveis", label: "Móveis" },
  { id: "bancadas", label: "Bancadas" },
  { id: "armarios", label: "Armários" },
  { id: "sanitarios", label: "Sanitários" },
];

export type LibrarySpec =
  | { elementType: "wall"; height: number; thickness: number; materialId: string }
  | { elementType: "floor"; thickness: number; materialId: string }
  | { elementType: "door"; width: number; height: number; materialId: string }
  | { elementType: "window"; width: number; height: number; sillHeight: number; materialId: string }
  | {
      elementType: "object";
      kind: ObjectKind;
      length: number;
      width: number;
      height: number;
      elevation?: number;
      materialId: string;
    };

export interface LibraryItem {
  id: string;
  name: string;
  category: LibraryCategory;
  description: string;
  spec: LibrarySpec;
}

export const LIBRARY: readonly LibraryItem[] = [
  // Paredes
  { id: "wall-masonry-15", name: "Alvenaria 15 cm", category: "paredes", description: "Parede de alvenaria rebocada, h = 2,80 m", spec: { elementType: "wall", height: 2.8, thickness: 0.15, materialId: "plaster-white" } },
  { id: "wall-masonry-20", name: "Alvenaria 20 cm", category: "paredes", description: "Parede externa rebocada, h = 2,80 m", spec: { elementType: "wall", height: 2.8, thickness: 0.2, materialId: "plaster-gray" } },
  { id: "wall-drywall-10", name: "Drywall 10 cm", category: "paredes", description: "Divisória em gesso acartonado", spec: { elementType: "wall", height: 2.7, thickness: 0.1, materialId: "gypsum" } },
  { id: "wall-brick", name: "Tijolo aparente", category: "paredes", description: "Parede de tijolo à vista", spec: { elementType: "wall", height: 2.8, thickness: 0.2, materialId: "brick" } },
  { id: "wall-parapet", name: "Mureta 1,10 m", category: "paredes", description: "Mureta / guarda-corpo de alvenaria", spec: { elementType: "wall", height: 1.1, thickness: 0.15, materialId: "concrete" } },

  // Portas
  { id: "door-70", name: "Porta 70 × 210", category: "portas", description: "Porta de giro, banheiros", spec: { elementType: "door", width: 0.7, height: 2.1, materialId: "wood-oak" } },
  { id: "door-80", name: "Porta 80 × 210", category: "portas", description: "Porta de giro interna", spec: { elementType: "door", width: 0.8, height: 2.1, materialId: "wood-oak" } },
  { id: "door-90", name: "Porta 90 × 210", category: "portas", description: "Porta de entrada", spec: { elementType: "door", width: 0.9, height: 2.1, materialId: "wood-walnut" } },

  // Janelas
  { id: "window-120x120", name: "Janela 120 × 120", category: "janelas", description: "Peitoril 1,00 m", spec: { elementType: "window", width: 1.2, height: 1.2, sillHeight: 1.0, materialId: "aluminum" } },
  { id: "window-150x120", name: "Janela 150 × 120", category: "janelas", description: "Peitoril 1,00 m", spec: { elementType: "window", width: 1.5, height: 1.2, sillHeight: 1.0, materialId: "aluminum-black" } },
  { id: "window-60x60", name: "Basculante 60 × 60", category: "janelas", description: "Banheiros, peitoril 1,60 m", spec: { elementType: "window", width: 0.6, height: 0.6, sillHeight: 1.6, materialId: "aluminum" } },
  { id: "window-200x220", name: "Porta-janela 200 × 220", category: "janelas", description: "Vão envidraçado até o piso", spec: { elementType: "window", width: 2.0, height: 2.2, sillHeight: 0, materialId: "aluminum-black" } },

  // Pisos
  { id: "floor-slab-12", name: "Laje de concreto 12 cm", category: "pisos", description: "Laje maciça", spec: { elementType: "floor", thickness: 0.12, materialId: "concrete" } },
  { id: "floor-porcelain", name: "Piso porcelanato", category: "pisos", description: "Contrapiso + porcelanato, 5 cm", spec: { elementType: "floor", thickness: 0.05, materialId: "porcelain-tile" } },
  { id: "floor-wood", name: "Piso de madeira", category: "pisos", description: "Assoalho, 3 cm", spec: { elementType: "floor", thickness: 0.03, materialId: "wood-oak" } },

  // Colunas
  { id: "column-rect-20x40", name: "Pilar 20 × 40", category: "colunas", description: "Pilar retangular de concreto", spec: { elementType: "object", kind: "column-rect", length: 0.2, width: 0.4, height: 2.8, materialId: "concrete" } },
  { id: "column-round-30", name: "Pilar circular Ø30", category: "colunas", description: "Pilar circular de concreto", spec: { elementType: "object", kind: "column-round", length: 0.3, width: 0.3, height: 2.8, materialId: "concrete" } },

  // Escadas
  { id: "stair-straight", name: "Escada reta", category: "escadas", description: "Lance reto, 16 degraus (geometria indicativa)", spec: { elementType: "object", kind: "stair-straight", length: 4.2, width: 1.0, height: 2.88, materialId: "concrete-polished" } },

  // Móveis
  { id: "table-6", name: "Mesa de jantar", category: "moveis", description: "Mesa retangular 6 lugares", spec: { elementType: "object", kind: "table", length: 1.8, width: 0.9, height: 0.75, materialId: "wood-walnut" } },
  { id: "chair", name: "Cadeira", category: "moveis", description: "Cadeira simples", spec: { elementType: "object", kind: "chair", length: 0.45, width: 0.5, height: 0.9, materialId: "wood-oak" } },
  { id: "sofa-3", name: "Sofá 3 lugares", category: "moveis", description: "Sofá com encosto e braços", spec: { elementType: "object", kind: "sofa", length: 2.1, width: 0.9, height: 0.85, materialId: "fabric-gray" } },
  { id: "bed-queen", name: "Cama queen", category: "moveis", description: "158 × 198 cm", spec: { elementType: "object", kind: "bed", length: 1.58, width: 1.98, height: 0.55, materialId: "fabric-beige" } },

  // Bancadas
  { id: "countertop-kitchen", name: "Bancada de cozinha", category: "bancadas", description: "Tampo em granito, h = 0,90 m", spec: { elementType: "object", kind: "countertop", length: 2.4, width: 0.6, height: 0.9, materialId: "granite-black" } },
  { id: "countertop-bath", name: "Bancada de banheiro", category: "bancadas", description: "Tampo em mármore, h = 0,85 m", spec: { elementType: "object", kind: "countertop", length: 1.2, width: 0.5, height: 0.85, materialId: "marble-white" } },

  // Armários
  { id: "cabinet-base", name: "Armário inferior", category: "armarios", description: "Gabinete de cozinha, 2 portas", spec: { elementType: "object", kind: "cabinet-base", length: 0.8, width: 0.55, height: 0.85, materialId: "mdf-white" } },
  { id: "cabinet-wall", name: "Armário aéreo", category: "armarios", description: "Aéreo a 1,50 m do piso", spec: { elementType: "object", kind: "cabinet-wall", length: 0.8, width: 0.35, height: 0.7, elevation: 1.5, materialId: "mdf-white" } },
  { id: "wardrobe", name: "Guarda-roupa", category: "armarios", description: "3 portas, 60 cm de profundidade", spec: { elementType: "object", kind: "wardrobe", length: 1.8, width: 0.6, height: 2.4, materialId: "mdf-graphite" } },

  // Sanitários
  { id: "toilet", name: "Bacia sanitária", category: "sanitarios", description: "Bacia com caixa acoplada", spec: { elementType: "object", kind: "toilet", length: 0.38, width: 0.68, height: 0.78, materialId: "ceramic-white" } },
  { id: "washbasin", name: "Lavatório", category: "sanitarios", description: "Cuba de apoio com coluna", spec: { elementType: "object", kind: "washbasin", length: 0.55, width: 0.45, height: 0.85, materialId: "ceramic-white" } },
  { id: "shower", name: "Box de chuveiro", category: "sanitarios", description: "Box em vidro 90 × 90", spec: { elementType: "object", kind: "shower", length: 0.9, width: 0.9, height: 2.0, materialId: "glass-clear" } },
];

export const getLibraryItem = (id: string): LibraryItem | undefined => LIBRARY.find((i) => i.id === id);
