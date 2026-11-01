/**
 * Tipos comuns do módulo de engenharia (PRÉ-DIMENSIONAMENTO).
 *
 * Nada aqui é projeto validado: todo resultado carrega premissas, avisos e
 * referências de consulta para conferência por profissional habilitado.
 */

export type AssumptionOrigin = "adotado" | "referencia" | "informado";

export interface Assumption {
  id: string;
  label: string;
  value: number | string;
  unit?: string;
  /** adotado = escolha deste módulo; referencia = valor usual de literatura/norma (conferir); informado = veio dos parâmetros. */
  origin: AssumptionOrigin;
  note?: string;
}

export type CalcStatus = "pre-dimensionamento";

export interface CalcBase {
  status: CalcStatus;
  assumptions: Assumption[];
  warnings: string[];
  references: string[];
  /** Entradas dependentes do local que não foram fornecidas (com dica de onde obter). */
  missingInputs: string[];
}

export const CALC_STATUS: CalcStatus = "pre-dimensionamento";

export const DISCLAIMER =
  "Pré-dimensionamento para conferência por profissional habilitado (ART/RRT). Não é projeto validado nem substitui o projeto estrutural, hidráulico ou de cobertura.";

/** Nome de norma sempre como referência de consulta — nunca afirma conformidade. */
export const normRef = (name: string): string => `${name} — referência de consulta — conferir edição vigente`;

export function assume(
  id: string,
  label: string,
  value: number | string,
  origin: AssumptionOrigin,
  extra: { unit?: string; note?: string } = {},
): Assumption {
  const a: Assumption = { id, label, value, origin };
  if (extra.unit !== undefined) a.unit = extra.unit;
  if (extra.note !== undefined) a.note = extra.note;
  return a;
}

/**
 * Resolve um parâmetro numérico: usa o valor informado (origin "informado") ou
 * o padrão (origin dado) e registra a premissa. Lança RangeError se inválido.
 */
export function resolveParam(
  book: Assumption[],
  id: string,
  label: string,
  given: number | undefined,
  def: number,
  defaultOrigin: Exclude<AssumptionOrigin, "informado">,
  extra: { unit?: string; note?: string; allowZero?: boolean } = {},
): number {
  const value = given ?? def;
  const ok = Number.isFinite(value) && (extra.allowZero ? value >= 0 : value > 0);
  if (!ok) throw new RangeError(`Parâmetro inválido "${label}": ${String(value)}.`);
  book.push(assume(id, label, value, given !== undefined ? "informado" : defaultOrigin, extra));
  return value;
}

export function baseCalc(references: string[]): CalcBase {
  return { status: CALC_STATUS, assumptions: [], warnings: [DISCLAIMER], references: references.map(normRef), missingInputs: [] };
}
