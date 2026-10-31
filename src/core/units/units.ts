/**
 * Unidades de comprimento.
 *
 * Regra do domínio: TODA geometria é armazenada em METROS (número de ponto
 * flutuante). As unidades de exibição (m, cm, mm) existem apenas na interface.
 */
export type LengthUnit = "m" | "cm" | "mm";

export const LENGTH_UNITS: readonly LengthUnit[] = ["m", "cm", "mm"] as const;

const METERS_PER_UNIT: Record<LengthUnit, number> = {
  m: 1,
  cm: 0.01,
  mm: 0.001,
};

/** Casas decimais padrão para exibição em cada unidade. */
const DISPLAY_DECIMALS: Record<LengthUnit, number> = { m: 2, cm: 1, mm: 0 };

export function toMeters(value: number, unit: LengthUnit): number {
  return roundTo(value * METERS_PER_UNIT[unit], 9);
}

export function fromMeters(meters: number, unit: LengthUnit): number {
  return roundTo(meters / METERS_PER_UNIT[unit], 9);
}

export function convertLength(value: number, from: LengthUnit, to: LengthUnit): number {
  return fromMeters(toMeters(value, from), to);
}

/** Arredondamento numérico estável (evita 0.30000000000000004). */
export function roundTo(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * f) / f;
}

export function formatLength(
  meters: number,
  unit: LengthUnit,
  options: { decimals?: number; withUnit?: boolean; grouping?: boolean } = {},
): string {
  const decimals = options.decimals ?? DISPLAY_DECIMALS[unit];
  const value = fromMeters(meters, unit);
  const text = value.toLocaleString("pt-BR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping: options.grouping ?? true,
  });
  return options.withUnit === false ? text : `${text} ${unit}`;
}

export function formatArea(squareMeters: number): string {
  return `${squareMeters.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m²`;
}

export function formatVolume(cubicMeters: number): string {
  return `${cubicMeters.toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} m³`;
}

export type ParseResult = { ok: true; meters: number } | { ok: false; error: string };

/**
 * Converte texto digitado pelo usuário em metros.
 * Aceita vírgula ou ponto decimal e sufixo opcional de unidade:
 *   "2,5" (unidade padrão) · "250cm" · "2500 mm" · "2.5 m"
 */
export function parseLength(input: string, defaultUnit: LengthUnit): ParseResult {
  const text = input.trim().toLowerCase().replace(/\s+/g, "");
  if (text === "") return { ok: false, error: "Informe um valor." };

  const match = /^(-?\d+(?:[.,]\d+)?|-?[.,]\d+)(mm|cm|m)?$/.exec(text);
  if (!match || match[1] === undefined) {
    return { ok: false, error: `Valor inválido: "${input}". Use, por exemplo, 2,5 ou 250cm.` };
  }
  const value = Number(match[1].replace(",", "."));
  if (!Number.isFinite(value)) return { ok: false, error: "Número inválido." };
  const unit = (match[2] as LengthUnit | undefined) ?? defaultUnit;
  return { ok: true, meters: toMeters(value, unit) };
}

/** Conversão de ângulos (o domínio guarda graus para leitura humana). */
export const degToRad = (deg: number): number => (deg * Math.PI) / 180;
export const radToDeg = (rad: number): number => (rad * 180) / Math.PI;

/** Normaliza ângulo em graus para o intervalo [0, 360). */
export function normalizeDegrees(deg: number): number {
  const r = deg % 360;
  return roundTo(r < 0 ? r + 360 : r, 9);
}
