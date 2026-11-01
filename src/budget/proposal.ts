import { z } from "zod";
import { DomainError } from "@/core/model/errors";
import { createId } from "@/core/model/ids";
import type { Project } from "@/core/model/schema";
import { BudgetSchema, roundMoney, type Budget } from "./budget";
import { projectVersionStamp } from "./version";

export const CompanyProfileSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome da empresa.").max(200),
  /** CNPJ/CPF (texto livre — validação de dígitos fica a cargo do usuário). */
  document: z.string().max(40),
  address: z.string().max(400),
  phone: z.string().max(60),
  email: z.string().max(200),
  logoDataUrl: z.string().startsWith("data:image/").optional(),
});
export type CompanyProfile = z.infer<typeof CompanyProfileSchema>;

export const ClientSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1, "Informe o nome do cliente.").max(200),
  contact: z.string().max(200),
  phone: z.string().max(60),
  email: z.string().max(200),
  document: z.string().max(40),
  address: z.string().max(400),
  createdAt: z.iso.datetime(),
});
export type Client = z.infer<typeof ClientSchema>;

export const MAX_MARGIN_PERCENT = 300;
export const PROPOSAL_STATUSES = ["rascunho", "emitida"] as const;
export const PROPOSAL_NUMBER_RE = /^PROP-(\d{4})-(\d{4,})$/;

export const ProposalSchema = z.object({
  id: z.string().min(1),
  number: z.string().regex(PROPOSAL_NUMBER_RE, "Número de proposta inválido (PROP-AAAA-NNNN)."),
  projectId: z.string().min(1),
  projectName: z.string().min(1).max(120),
  clientId: z.string().min(1),
  /** Revisão do modelo de onde o orçamento foi gerado. */
  version: z.object({ revisionHash: z.string().min(1), projectUpdatedAt: z.iso.datetime() }),
  /** Orçamento congelado no momento da proposta. */
  budget: BudgetSchema,
  scope: z.string().max(10000),
  marginPercent: z.number().finite().min(0).max(MAX_MARGIN_PERCENT),
  discountPercent: z.number().finite().min(0).max(100),
  paymentTerms: z.string().max(2000),
  deadlineDays: z.number().int().nonnegative().max(3650),
  validityDays: z.number().int().positive().max(3650),
  notes: z.string().max(10000),
  /** Imagens (data URLs) — renders, plantas. */
  images: z.array(z.string()),
  createdAt: z.iso.datetime(),
  status: z.enum(PROPOSAL_STATUSES),
});
export type Proposal = z.infer<typeof ProposalSchema>;

export interface ProposalTotals {
  /** Custo (total do orçamento com BDI). */
  cost: number;
  marginValue: number;
  /** Custo + margem. */
  gross: number;
  discountValue: number;
  /** Valor final da proposta. */
  total: number;
}

export function validateMarginDiscount(marginPercent: number, discountPercent: number): void {
  if (!Number.isFinite(marginPercent) || marginPercent < 0 || marginPercent > MAX_MARGIN_PERCENT) {
    throw new DomainError(`A margem deve estar entre 0% e ${MAX_MARGIN_PERCENT}%.`);
  }
  if (!Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100) {
    throw new DomainError("O desconto deve estar entre 0% e 100%.");
  }
}

/** Custo → (+ margem) → bruto → (− desconto sobre o bruto) → total. */
export function computeProposalTotals(budget: Pick<Budget, "total">, marginPercent: number, discountPercent: number): ProposalTotals {
  validateMarginDiscount(marginPercent, discountPercent);
  const cost = roundMoney(budget.total);
  const marginValue = roundMoney((cost * marginPercent) / 100);
  const gross = roundMoney(cost + marginValue);
  const discountValue = roundMoney((gross * discountPercent) / 100);
  return { cost, marginValue, gross, discountValue, total: roundMoney(gross - discountValue) };
}

/** Próximo número sequencial do ano: PROP-AAAA-NNNN. */
export function nextProposalNumber(existing: ReadonlyArray<string | { number: string }>, year: number): string {
  if (!Number.isInteger(year) || year < 1000 || year > 9999) throw new DomainError("Ano inválido para numeração da proposta.");
  let max = 0;
  for (const e of existing) {
    const m = PROPOSAL_NUMBER_RE.exec(typeof e === "string" ? e : e.number);
    if (m && Number(m[1]) === year) max = Math.max(max, Number(m[2]));
  }
  return `PROP-${year}-${String(max + 1).padStart(4, "0")}`;
}

export interface NewProposalInput {
  project: Project;
  client: Pick<Client, "id">;
  budget: Budget;
  existingNumbers: ReadonlyArray<string | { number: string }>;
  scope?: string;
  marginPercent?: number;
  discountPercent?: number;
  paymentTerms?: string;
  deadlineDays?: number;
  validityDays?: number;
  notes?: string;
  images?: string[];
  now?: Date;
}

/** Cria uma proposta (rascunho) vinculada à revisão ATUAL do projeto. */
export function createProposal(input: NewProposalInput): Proposal {
  const now = input.now ?? new Date();
  const stamp = projectVersionStamp(input.project);
  const proposal = {
    id: createId(),
    number: nextProposalNumber(input.existingNumbers, now.getFullYear()),
    projectId: stamp.projectId,
    projectName: input.project.name,
    clientId: input.client.id,
    version: { revisionHash: stamp.revisionHash, projectUpdatedAt: stamp.projectUpdatedAt },
    budget: structuredClone(input.budget),
    scope: input.scope ?? "",
    marginPercent: input.marginPercent ?? 0,
    discountPercent: input.discountPercent ?? 0,
    paymentTerms: input.paymentTerms ?? "",
    deadlineDays: input.deadlineDays ?? 30,
    validityDays: input.validityDays ?? 15,
    notes: input.notes ?? "",
    images: input.images ?? [],
    createdAt: now.toISOString(),
    status: "rascunho" as const,
  };
  validateMarginDiscount(proposal.marginPercent, proposal.discountPercent);
  const parsed = ProposalSchema.safeParse(proposal);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new DomainError(`Proposta inválida: ${issue ? `${issue.path.join(".")} ${issue.message}` : ""}`);
  }
  return parsed.data;
}

/** Data de validade (aaaa-mm-dd) = data de criação + dias de validade. */
export function proposalValidUntil(p: Pick<Proposal, "createdAt" | "validityDays">): string {
  const d = new Date(p.createdAt);
  d.setUTCDate(d.getUTCDate() + p.validityDays);
  return d.toISOString().slice(0, 10);
}
