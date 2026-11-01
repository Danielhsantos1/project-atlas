import { z } from "zod";

/**
 * Base de domínio para o PROJECT ATLAS como SaaS.
 *
 * ESTADO: modelagem e regras puras (testadas). Ainda NÃO há autenticação,
 * servidor nem cobrança — a aplicação roda localmente para um único usuário.
 * Quando o backend existir, estas regras serão aplicadas NO SERVIDOR
 * (nunca confiar apenas no cliente para permissões e limites).
 */

export const ROLES = ["owner", "admin", "editor", "viewer", "client"] as const;
export const RoleSchema = z.enum(ROLES);
export type Role = z.infer<typeof RoleSchema>;

export const ROLE_LABEL: Record<Role, string> = {
  owner: "Proprietário",
  admin: "Administrador",
  editor: "Projetista",
  viewer: "Visualizador",
  client: "Cliente (portal)",
};

export const UserSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1),
  email: z.email(),
  createdAt: z.iso.datetime(),
});
export type User = z.infer<typeof UserSchema>;

export const OrganizationSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1),
  document: z.string().max(40),
  planId: z.string().min(1),
  createdAt: z.iso.datetime(),
});
export type Organization = z.infer<typeof OrganizationSchema>;

export const MembershipSchema = z.object({ userId: z.string(), organizationId: z.string(), role: RoleSchema });
export type Membership = z.infer<typeof MembershipSchema>;

export const ACTIONS = [
  "project.view",
  "project.edit",
  "project.delete",
  "project.export",
  "budget.view",
  "budget.edit",
  "prices.edit",
  "proposal.issue",
  "ai.generate",
  "members.manage",
  "billing.manage",
] as const;
export type Action = (typeof ACTIONS)[number];

const MATRIX: Record<Role, ReadonlySet<Action>> = {
  owner: new Set(ACTIONS),
  admin: new Set(ACTIONS.filter((a) => a !== "billing.manage")),
  editor: new Set<Action>(["project.view", "project.edit", "project.export", "budget.view", "budget.edit", "proposal.issue", "ai.generate"]),
  viewer: new Set<Action>(["project.view", "budget.view"]),
  client: new Set<Action>(["project.view"]),
};

/** Controle de permissões por papel. */
export const can = (role: Role, action: Action): boolean => MATRIX[role].has(action);

/**
 * Isolamento de dados: um usuário só acessa projetos da organização da qual é membro.
 * (Regra que o backend deverá aplicar em TODAS as consultas.)
 */
export function canAccessProject(memberships: readonly Membership[], userId: string, project: { organizationId: string }, action: Action): boolean {
  const m = memberships.find((x) => x.userId === userId && x.organizationId === project.organizationId);
  return !!m && can(m.role, action);
}

export const LimitsSchema = z.object({
  /** null = ilimitado */
  projects: z.number().int().positive().nullable(),
  members: z.number().int().positive().nullable(),
  aiGenerationsPerMonth: z.number().int().nonnegative().nullable(),
  proposalsPerMonth: z.number().int().nonnegative().nullable(),
  storageMb: z.number().int().positive().nullable(),
});
export type Limits = z.infer<typeof LimitsSchema>;

export const FEATURES = ["pdf-proposal", "price-database", "sinapi-import", "walkthrough", "ai-assistant", "custom-branding", "api-access"] as const;
export type Feature = (typeof FEATURES)[number];

export const PlanSchema = z.object({
  id: z.string(),
  name: z.string(),
  limits: LimitsSchema,
  features: z.array(z.enum(FEATURES)),
});
export type Plan = z.infer<typeof PlanSchema>;

/**
 * Planos de referência (estrutura). Valores comerciais NÃO definidos:
 * preços e cobrança dependem de decisão do negócio e de autorização explícita.
 */
export const PLANS: readonly Plan[] = [
  { id: "gratuito", name: "Gratuito", limits: { projects: 3, members: 1, aiGenerationsPerMonth: 5, proposalsPerMonth: 2, storageMb: 50 }, features: ["walkthrough", "ai-assistant"] },
  { id: "profissional", name: "Profissional", limits: { projects: 50, members: 3, aiGenerationsPerMonth: 100, proposalsPerMonth: 50, storageMb: 2000 }, features: ["walkthrough", "ai-assistant", "pdf-proposal", "price-database", "sinapi-import"] },
  { id: "empresa", name: "Empresa", limits: { projects: null, members: null, aiGenerationsPerMonth: null, proposalsPerMonth: null, storageMb: 20000 }, features: [...FEATURES] },
];

export type Usage = { [K in keyof Limits]: number };

export interface LimitCheck {
  allowed: boolean;
  limit: number | null;
  used: number;
  message: string | null;
}

const LIMIT_LABEL: Record<keyof Limits, string> = {
  projects: "projetos",
  members: "membros",
  aiGenerationsPerMonth: "gerações de IA no mês",
  proposalsPerMonth: "propostas no mês",
  storageMb: "MB de armazenamento",
};

/** Verifica se mais `amount` unidades cabem no limite do plano. */
export function checkLimit(plan: Plan, usage: Usage, key: keyof Limits, amount = 1): LimitCheck {
  const limit = plan.limits[key];
  const used = usage[key];
  if (limit === null) return { allowed: true, limit, used, message: null };
  const allowed = used + amount <= limit;
  return { allowed, limit, used, message: allowed ? null : `Limite do plano ${plan.name} atingido: ${limit} ${LIMIT_LABEL[key]}.` };
}

export const hasFeature = (plan: Plan, f: Feature): boolean => plan.features.includes(f);
