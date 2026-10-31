/**
 * ATLAS AI — interpretação de pedidos em linguagem natural (pt-BR).
 *
 * Implementação LOCAL baseada em regras: transparente, determinística e sem
 * enviar dados a terceiros. O contrato `AiProvider` permite trocar por um
 * modelo de linguagem no futuro sem alterar o gerador de layout.
 */
export interface HouseBrief {
  floors: 1 | 2;
  targetArea: number | null;
  bedrooms: number;
  suites: number;
  bathrooms: number;
  garageCars: number;
  pool: boolean;
  gourmet: boolean;
  office: boolean;
  laundry: boolean;
  integratedKitchen: boolean;
  largeLiving: boolean;
}

export interface Interpretation {
  brief: HouseBrief;
  /** O que foi entendido, em linguagem simples. */
  understood: string[];
  /** Suposições feitas por falta de informação. */
  assumptions: string[];
}

export interface AiProvider {
  id: string;
  label: string;
  interpret(text: string): Promise<Interpretation>;
}

const NUM: Record<string, number> = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6 };

const norm = (t: string) =>
  t
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/m²/g, "m2");

function count(text: string, pattern: string): number | null {
  const m = new RegExp(`(\\d+|${Object.keys(NUM).join("|")})\\s+(?:${pattern})`).exec(text);
  if (!m?.[1]) return null;
  return /^\d+$/.test(m[1]) ? Number(m[1]) : (NUM[m[1]] ?? null);
}

export function interpretRequest(input: string): Interpretation {
  const t = norm(input);
  const understood: string[] = [];
  const assumptions: string[] = [];

  const areaMatch = /(\d{2,4})\s*(?:m2|metros quadrados|metros)/.exec(t);
  const targetArea = areaMatch ? Number(areaMatch[1]) : null;
  if (targetArea) understood.push(`Área aproximada de ${targetArea} m²`);

  const floors: 1 | 2 = /sobrado|dois pavimentos|2 pavimentos|dois andares|2 andares|duplex/.test(t) ? 2 : 1;
  understood.push(floors === 2 ? "Dois pavimentos (sobrado)" : /terrea|um pavimento|1 pavimento/.test(t) ? "Casa térrea" : "Casa térrea");
  if (floors === 1 && !/terrea|pavimento/.test(t)) assumptions.push("Número de pavimentos não informado: considerada casa térrea.");

  let totalRooms = count(t, "quartos?|dormitorios?");
  let suites = count(t, "suites?") ?? (/\bsuite\b/.test(t) ? 1 : 0);
  if (totalRooms === null) {
    totalRooms = Math.max(2, suites);
    assumptions.push(`Quantidade de quartos não informada: considerados ${totalRooms}.`);
  }
  suites = Math.min(suites, totalRooms);
  understood.push(`${totalRooms} quarto(s)${suites ? `, sendo ${suites} suíte(s)` : ""}`);

  let bathrooms = count(t, "banheiros?") ?? 1;
  if (count(t, "banheiros?") === null) assumptions.push("Banheiros não informados: 1 banheiro social (além dos das suítes).");
  bathrooms = Math.max(1, bathrooms - suites > 0 && count(t, "banheiros?") !== null ? bathrooms - suites : bathrooms);

  const cars = /garagem/.test(t) ? (count(t, "carros?|vagas?") ?? 1) : 0;
  if (cars) understood.push(`Garagem para ${cars} carro(s)`);
  const pool = /piscina/.test(t);
  const gourmet = /gourmet|churrasqueira|espaco de lazer/.test(t);
  const office = /escritorio|home office/.test(t);
  const laundry = !/sem lavanderia/.test(t);
  const integratedKitchen = /integrad|americana|conceito aberto/.test(t);
  const largeLiving = /sala ampla|sala grande|ampla sala/.test(t);
  if (pool) understood.push("Piscina");
  if (gourmet) understood.push("Área gourmet");
  if (office) understood.push("Escritório");
  if (integratedKitchen) understood.push("Cozinha integrada à sala");
  if (largeLiving) understood.push("Sala ampla");
  if (laundry) assumptions.push("Incluída lavanderia (padrão residencial).");

  return {
    brief: { floors, targetArea, bedrooms: totalRooms - suites, suites, bathrooms, garageCars: cars, pool, gourmet, office, laundry, integratedKitchen, largeLiving },
    understood,
    assumptions,
  };
}

export const localRuleProvider: AiProvider = {
  id: "local-rules",
  label: "Interpretador local (regras, sem envio de dados)",
  interpret: async (text) => interpretRequest(text),
};

export const AI_DISCLAIMER =
  "Proposta preliminar gerada automaticamente para estudo. Não é projeto aprovado: deve ser revisada e assinada por profissional habilitado (arquiteto/engenheiro) e atender às normas e à legislação local.";
