/**
 * Memorial de cálculo — modelo de documento NEUTRO (seções, texto, tabelas).
 * Os módulos de cálculo geram seções; o renderizador PDF só desenha.
 *
 * REGRAS DE INTEGRIDADE (ver docs/ENGENHARIA.md):
 *  - É um RASCUNHO TÉCNICO para revisão de profissional habilitado. Nunca é emitido como assinado ou aprovado.
 *  - Campos de responsabilidade técnica (nome, CREA/CAU, ART/RRT, assinatura) saem SEMPRE em branco.
 *  - Premissas "adotadas" e entradas ausentes são sempre listadas — nada é omitido para "parecer completo".
 */
export type MemorialBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "bullets"; items: string[] }
  | { kind: "table"; caption?: string; head: string[]; rows: string[][]; align?: Array<"left" | "right" | "center"> }
  | { kind: "formula"; label: string; expression: string; note?: string }
  | { kind: "alert"; level: "aviso" | "pendente"; text: string };

export interface MemorialSection {
  id: string;
  title: string;
  blocks: MemorialBlock[];
}

export interface MemorialMeta {
  projectName: string;
  company: string;
  client?: string;
  address?: string;
  generatedAt: string;
  /** Revisão do modelo de origem (hash) — vincula o memorial à versão exata do projeto. */
  revisionHash: string;
}

export interface MemorialDocument {
  meta: MemorialMeta;
  sections: MemorialSection[];
  /** Pendências que impedem considerar o memorial completo (entradas ausentes). */
  pending: string[];
}

export const MEMORIAL_STATUS = "RASCUNHO TÉCNICO PARA REVISÃO — NÃO VALIDADO POR PROFISSIONAL HABILITADO";

export const MEMORIAL_DISCLAIMER =
  "Documento gerado automaticamente a partir do modelo do PROJECT ATLAS para apoio ao responsável técnico. " +
  "Os resultados são estimativas de pré-dimensionamento e NÃO constituem projeto estrutural, hidráulico ou de cobertura aprovado. " +
  "Fórmulas, coeficientes e normas citadas devem ser conferidos pelo profissional habilitado, na edição vigente, antes de qualquer uso em obra. " +
  "A responsabilidade técnica (ART/RRT) é exclusivamente do profissional que revisar e assinar este documento.";

export const SIGNATURE_FIELDS = ["Responsável técnico", "CREA / CAU nº", "ART / RRT nº", "Data", "Assinatura"] as const;
