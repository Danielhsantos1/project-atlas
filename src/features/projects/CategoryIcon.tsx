import {
  Armchair,
  Building2,
  DraftingCompass,
  Gem,
  Home,
  PanelsTopLeft,
  Sofa,
  Sparkles,
  Store,
  type LucideProps,
} from "lucide-react";
import type { ProjectCategory } from "@/core/model/schema";

const ICONS: Record<ProjectCategory, React.ComponentType<LucideProps>> = {
  residencial: Home,
  comercial: Store,
  predial: Building2,
  interiores: Sofa,
  moveis: Armchair,
  marmoraria: Gem,
  vidracaria: PanelsTopLeft,
  engenharia: DraftingCompass,
  especiais: Sparkles,
};

export function CategoryIcon({ category, ...props }: { category: ProjectCategory } & LucideProps) {
  const Icon = ICONS[category];
  return <Icon {...props} />;
}
