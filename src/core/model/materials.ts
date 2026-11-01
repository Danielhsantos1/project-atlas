/**
 * Catálogo de materiais (aparência). Propriedades físicas/normativas
 * (resistência, transmitância etc.) ficam para os módulos de engenharia.
 */
export interface Material {
  id: string;
  name: string;
  group: "Alvenaria" | "Concreto" | "Madeira" | "Pedra" | "Cerâmica" | "Metal" | "Vidro" | "Tecido" | "Acabamento" | "Tinta" | "Cobertura" | "Externo";
  /** Cor base sRGB em hexadecimal. */
  color: string;
  roughness: number;
  metalness: number;
  /** 1 = opaco. */
  opacity: number;
}

export const MATERIALS: readonly Material[] = [
  { id: "plaster-white", name: "Reboco pintado branco", group: "Alvenaria", color: "#e9e7e2", roughness: 0.9, metalness: 0, opacity: 1 },
  { id: "plaster-gray", name: "Reboco pintado cinza", group: "Alvenaria", color: "#9da3aa", roughness: 0.9, metalness: 0, opacity: 1 },
  { id: "brick", name: "Tijolo aparente", group: "Alvenaria", color: "#a4553a", roughness: 0.95, metalness: 0, opacity: 1 },
  { id: "concrete", name: "Concreto aparente", group: "Concreto", color: "#8f9296", roughness: 0.85, metalness: 0, opacity: 1 },
  { id: "concrete-polished", name: "Cimento queimado", group: "Concreto", color: "#a9abad", roughness: 0.45, metalness: 0, opacity: 1 },
  { id: "wood-oak", name: "Madeira carvalho", group: "Madeira", color: "#b98a5a", roughness: 0.7, metalness: 0, opacity: 1 },
  { id: "wood-walnut", name: "Madeira nogueira", group: "Madeira", color: "#5c3b26", roughness: 0.65, metalness: 0, opacity: 1 },
  { id: "mdf-white", name: "MDF branco", group: "Madeira", color: "#f2f2ef", roughness: 0.5, metalness: 0, opacity: 1 },
  { id: "mdf-graphite", name: "MDF grafite", group: "Madeira", color: "#3a3d42", roughness: 0.5, metalness: 0, opacity: 1 },
  { id: "marble-white", name: "Mármore branco", group: "Pedra", color: "#ecebe8", roughness: 0.2, metalness: 0, opacity: 1 },
  { id: "granite-black", name: "Granito preto", group: "Pedra", color: "#1e1f22", roughness: 0.25, metalness: 0, opacity: 1 },
  { id: "quartz-gray", name: "Quartzo cinza", group: "Pedra", color: "#7b7f86", roughness: 0.3, metalness: 0, opacity: 1 },
  { id: "porcelain-tile", name: "Porcelanato claro", group: "Cerâmica", color: "#d8d2c6", roughness: 0.35, metalness: 0, opacity: 1 },
  { id: "ceramic-white", name: "Louça sanitária branca", group: "Cerâmica", color: "#f7f7f5", roughness: 0.15, metalness: 0, opacity: 1 },
  { id: "aluminum", name: "Alumínio anodizado", group: "Metal", color: "#b7bcc2", roughness: 0.35, metalness: 0.8, opacity: 1 },
  { id: "aluminum-black", name: "Alumínio preto", group: "Metal", color: "#26282c", roughness: 0.4, metalness: 0.7, opacity: 1 },
  { id: "steel-inox", name: "Aço inox escovado", group: "Metal", color: "#c9ccd0", roughness: 0.3, metalness: 0.9, opacity: 1 },
  { id: "glass-clear", name: "Vidro incolor", group: "Vidro", color: "#a8d8f0", roughness: 0.05, metalness: 0, opacity: 0.3 },
  { id: "glass-smoked", name: "Vidro fumê", group: "Vidro", color: "#4d5a63", roughness: 0.05, metalness: 0, opacity: 0.45 },
  { id: "fabric-gray", name: "Tecido cinza", group: "Tecido", color: "#6f747b", roughness: 1, metalness: 0, opacity: 1 },
  { id: "fabric-beige", name: "Tecido bege", group: "Tecido", color: "#c8b79c", roughness: 1, metalness: 0, opacity: 1 },
  { id: "gypsum", name: "Gesso acartonado", group: "Acabamento", color: "#f4f3ef", roughness: 0.9, metalness: 0, opacity: 1 },
  { id: "ceramic-brick", name: "Tijolo cerâmico (bloco)", group: "Alvenaria", color: "#b5643f", roughness: 0.95, metalness: 0, opacity: 1 },
  { id: "concrete-block", name: "Bloco de concreto", group: "Alvenaria", color: "#9a9a96", roughness: 0.95, metalness: 0, opacity: 1 },
  { id: "mortar", name: "Argamassa", group: "Alvenaria", color: "#b9b4a8", roughness: 1, metalness: 0, opacity: 1 },
  { id: "plaster-raw", name: "Reboco (sem pintura)", group: "Acabamento", color: "#cfc9bb", roughness: 1, metalness: 0, opacity: 1 },
  { id: "paint-white", name: "Tinta acrílica branca", group: "Tinta", color: "#f3f2ee", roughness: 0.85, metalness: 0, opacity: 1 },
  { id: "paint-sand", name: "Tinta acrílica areia", group: "Tinta", color: "#d9cdb4", roughness: 0.85, metalness: 0, opacity: 1 },
  { id: "paint-graphite", name: "Tinta acrílica grafite", group: "Tinta", color: "#3d4045", roughness: 0.85, metalness: 0, opacity: 1 },
  { id: "paint-terracotta", name: "Tinta acrílica terracota", group: "Tinta", color: "#b8664a", roughness: 0.85, metalness: 0, opacity: 1 },
  { id: "ceramic-floor", name: "Piso cerâmico", group: "Cerâmica", color: "#c9bfae", roughness: 0.4, metalness: 0, opacity: 1 },
  { id: "ceramic-tile-wall", name: "Revestimento cerâmico (parede)", group: "Cerâmica", color: "#e6e8ea", roughness: 0.25, metalness: 0, opacity: 1 },
  { id: "roof-tile-ceramic", name: "Telha cerâmica", group: "Cobertura", color: "#a2533a", roughness: 0.8, metalness: 0, opacity: 1 },
  { id: "roof-metal", name: "Telha metálica", group: "Cobertura", color: "#6f757c", roughness: 0.5, metalness: 0.6, opacity: 1 },
  { id: "roof-fiber-cement", name: "Telha de fibrocimento", group: "Cobertura", color: "#a7aaa8", roughness: 0.9, metalness: 0, opacity: 1 },
  { id: "steel", name: "Aço estrutural", group: "Metal", color: "#5d6267", roughness: 0.5, metalness: 0.8, opacity: 1 },
  { id: "grass", name: "Grama", group: "Externo", color: "#5f8f3e", roughness: 1, metalness: 0, opacity: 1 },
  { id: "water", name: "Água (piscina)", group: "Externo", color: "#3fa7d6", roughness: 0.05, metalness: 0, opacity: 0.75 },
  { id: "paving-stone", name: "Calçada / pedra", group: "Externo", color: "#8d8a83", roughness: 0.95, metalness: 0, opacity: 1 },
  { id: "deck-wood", name: "Deck de madeira", group: "Externo", color: "#8a6142", roughness: 0.8, metalness: 0, opacity: 1 },
  { id: "foliage", name: "Folhagem", group: "Externo", color: "#3f7a3a", roughness: 1, metalness: 0, opacity: 1 },
  { id: "car-paint", name: "Pintura automotiva", group: "Metal", color: "#2a3b55", roughness: 0.3, metalness: 0.6, opacity: 1 },
];

const BY_ID = new Map(MATERIALS.map((m) => [m.id, m]));

export const FALLBACK_MATERIAL: Material = {
  id: "unknown",
  name: "Material desconhecido",
  group: "Acabamento",
  color: "#ff00ff",
  roughness: 1,
  metalness: 0,
  opacity: 1,
};

/** Retorna o material; IDs desconhecidos aparecem em magenta (convenção CAD de "material ausente"). */
export function getMaterial(id: string): Material {
  return BY_ID.get(id) ?? FALLBACK_MATERIAL;
}

export const isKnownMaterial = (id: string): boolean => BY_ID.has(id);
