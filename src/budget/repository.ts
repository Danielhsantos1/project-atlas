import { z } from "zod";
import type { KeyValueStorage } from "@/persistence/repository";
import { PersistenceError } from "@/persistence/errors";
import { DomainError } from "@/core/model/errors";
import { PriceDatabaseSchema, createEmptyPriceDatabase, type PriceDatabase } from "./prices";
import { ClientSchema, CompanyProfileSchema, ProposalSchema, type Client, type CompanyProfile, type Proposal } from "./proposal";
import { BudgetSnapshotSchema, type BudgetSnapshot } from "./version";

/** Chaves do armazenamento (mesmo prefixo versionado dos projetos). */
export const BUDGET_KEYS = {
  prices: "atlas:v1:prices",
  company: "atlas:v1:company",
  clients: "atlas:v1:clients",
  proposals: (projectId: string) => `atlas:v1:proposals:${projectId}`,
  snapshots: (projectId: string) => `atlas:v1:budget-snapshots:${projectId}`,
} as const;

/**
 * Persistência do módulo de orçamento sobre armazenamento chave-valor.
 * Interface assíncrona (substituível por API HTTP). Tudo é validado com Zod na
 * leitura: dado corrompido gera PersistenceError — nunca é ignorado em silêncio.
 */
export class BudgetRepository {
  constructor(private readonly storage: KeyValueStorage) {}

  // ---------- infraestrutura ----------

  private read<T>(key: string, schema: z.ZodType<T>, what: string): T | null {
    let raw: string | null;
    try {
      raw = this.storage.getItem(key);
    } catch (cause) {
      throw new PersistenceError(`Não foi possível ler ${what} do armazenamento local.`, { cause });
    }
    if (raw === null) return null;
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch (cause) {
      throw new PersistenceError(`Os dados de ${what} estão corrompidos.`, { cause });
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new PersistenceError(`Os dados de ${what} têm formato inválido.`, { cause: parsed.error });
    }
    return parsed.data;
  }

  private write<T>(key: string, schema: z.ZodType<T>, value: T, what: string): void {
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new DomainError(`Não é possível salvar ${what}: ${issue ? `${issue.path.join(".")} ${issue.message}` : "dados inválidos"}.`);
    }
    try {
      this.storage.setItem(key, JSON.stringify(parsed.data));
    } catch (cause) {
      const quota = cause instanceof Error && /quota/i.test(cause.name + cause.message);
      throw new PersistenceError(
        quota ? "Espaço de armazenamento local esgotado. Exclua propostas ou imagens antigas." : `Não foi possível gravar ${what} no armazenamento local.`,
        { cause },
      );
    }
  }

  // ---------- base de preços (nível da área de trabalho) ----------

  async getPriceDatabase(): Promise<PriceDatabase> {
    return this.read(BUDGET_KEYS.prices, PriceDatabaseSchema, "a base de preços") ?? createEmptyPriceDatabase();
  }

  async savePriceDatabase(db: PriceDatabase): Promise<void> {
    this.write(BUDGET_KEYS.prices, PriceDatabaseSchema, db, "a base de preços");
  }

  // ---------- empresa ----------

  async getCompanyProfile(): Promise<CompanyProfile | null> {
    return this.read(BUDGET_KEYS.company, CompanyProfileSchema, "o perfil da empresa");
  }

  async saveCompanyProfile(profile: CompanyProfile): Promise<void> {
    this.write(BUDGET_KEYS.company, CompanyProfileSchema, profile, "o perfil da empresa");
  }

  // ---------- clientes ----------

  async listClients(): Promise<Client[]> {
    const list = this.read(BUDGET_KEYS.clients, z.array(ClientSchema), "os clientes") ?? [];
    return [...list].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }

  async getClient(id: string): Promise<Client | null> {
    return (await this.listClients()).find((c) => c.id === id) ?? null;
  }

  async saveClient(client: Client): Promise<void> {
    const list = (await this.listClients()).filter((c) => c.id !== client.id);
    list.push(client);
    this.write(BUDGET_KEYS.clients, z.array(ClientSchema), list, "o cliente");
  }

  async deleteClient(id: string): Promise<void> {
    const list = await this.listClients();
    this.write(BUDGET_KEYS.clients, z.array(ClientSchema), list.filter((c) => c.id !== id), "os clientes");
  }

  // ---------- propostas (por projeto) ----------

  async listProposals(projectId: string): Promise<Proposal[]> {
    const list = this.read(BUDGET_KEYS.proposals(projectId), z.array(ProposalSchema), "as propostas") ?? [];
    return [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getProposal(projectId: string, id: string): Promise<Proposal | null> {
    return (await this.listProposals(projectId)).find((p) => p.id === id) ?? null;
  }

  async saveProposal(proposal: Proposal): Promise<void> {
    const list = (await this.listProposals(proposal.projectId)).filter((p) => p.id !== proposal.id);
    if (list.some((p) => p.number === proposal.number)) throw new DomainError(`Já existe uma proposta com o número ${proposal.number}.`);
    list.push(proposal);
    this.write(BUDGET_KEYS.proposals(proposal.projectId), z.array(ProposalSchema), list, "a proposta");
  }

  async deleteProposal(projectId: string, id: string): Promise<void> {
    const list = await this.listProposals(projectId);
    this.write(BUDGET_KEYS.proposals(projectId), z.array(ProposalSchema), list.filter((p) => p.id !== id), "as propostas");
  }

  // ---------- orçamentos congelados (por projeto) ----------

  async listSnapshots(projectId: string): Promise<BudgetSnapshot[]> {
    const list = this.read(BUDGET_KEYS.snapshots(projectId), z.array(BudgetSnapshotSchema), "os orçamentos salvos") ?? [];
    return [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async saveSnapshot(snapshot: BudgetSnapshot): Promise<void> {
    const list = (await this.listSnapshots(snapshot.projectId)).filter((s) => s.id !== snapshot.id);
    list.push(snapshot);
    this.write(BUDGET_KEYS.snapshots(snapshot.projectId), z.array(BudgetSnapshotSchema), list, "o orçamento");
  }

  async deleteSnapshot(projectId: string, id: string): Promise<void> {
    const list = await this.listSnapshots(projectId);
    this.write(BUDGET_KEYS.snapshots(projectId), z.array(BudgetSnapshotSchema), list.filter((s) => s.id !== id), "os orçamentos salvos");
  }

  /** Remove propostas e orçamentos de um projeto excluído. */
  async deleteProjectData(projectId: string): Promise<void> {
    this.storage.removeItem(BUDGET_KEYS.proposals(projectId));
    this.storage.removeItem(BUDGET_KEYS.snapshots(projectId));
  }
}
