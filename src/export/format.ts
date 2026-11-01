/**
 * Formatação pt-BR própria (sem depender de ICU/locale do ambiente), para que a
 * saída seja idêntica em qualquer máquina: vírgula decimal, sem separador de milhar.
 */
export function fmtNum(v: number, decimals = 2): string {
  const s = v.toFixed(decimals).replace(".", ",");
  return /^-0(,0*)?$/.test(s) ? s.slice(1) : s;
}

/** Comprimento em metros: "5,00". */
export const fmtLen = (m: number): string => fmtNum(m, 2);

/** Área em m² (texto em ASCII "m2" quando passar pelo escritor): "12,34 m²". */
export const fmtArea = (m2: number): string => `${fmtNum(m2, 2)} m²`;

/** Cota de nível: "+3,20", "-0,45" ou "±0,00". */
export function fmtLevel(z: number): string {
  if (Math.abs(z) < 0.005) return "±0,00";
  return `${z > 0 ? "+" : "-"}${fmtNum(Math.abs(z), 2)}`;
}

/** dd/mm/aaaa em UTC (determinístico, independe do fuso da máquina). */
export function fmtDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}
