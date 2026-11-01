import { z } from "zod";

/** Categorias de custo do orçamento (agrupamento dos totais). */
export const BUDGET_CATEGORIES = [
  "materiais",
  "mao-de-obra",
  "equipamentos",
  "servicos",
  "acabamentos",
  "esquadrias",
  "moveis-planejados",
  "custos-adicionais",
] as const;

export const BudgetCategorySchema = z.enum(BUDGET_CATEGORIES);
export type BudgetCategory = z.infer<typeof BudgetCategorySchema>;

export const BUDGET_CATEGORY_LABEL: Record<BudgetCategory, string> = {
  materiais: "Materiais",
  "mao-de-obra": "Mão de obra",
  equipamentos: "Equipamentos",
  servicos: "Serviços",
  acabamentos: "Acabamentos",
  esquadrias: "Esquadrias",
  "moveis-planejados": "Móveis planejados",
  "custos-adicionais": "Custos adicionais",
};

/** Registro com todas as categorias zeradas (base para somatórios). */
export function emptyCategoryTotals(): Record<BudgetCategory, number> {
  return Object.fromEntries(BUDGET_CATEGORIES.map((c) => [c, 0])) as Record<BudgetCategory, number>;
}
