import { describe, expect, it } from "vitest";
import { MemoryStorage } from "@/persistence/repository";
import { PersistenceError } from "@/persistence/errors";
import { DomainError } from "@/core/model/errors";
import { buildBudget } from "./budget";
import { EXAMPLE_PRICE_ITEMS, createEmptyPriceDatabase, mergePriceItems } from "./prices";
import { createProposal, type Client } from "./proposal";
import { takeoff } from "./quantities";
import { BUDGET_KEYS, BudgetRepository } from "./repository";
import { buildReferenceProject } from "./test-fixtures";
import { createBudgetSnapshot } from "./version";

const client = (id: string, name: string): Client => ({ id, name, contact: "", phone: "", email: "", document: "", address: "", createdAt: "2026-10-01T00:00:00.000Z" });

describe("BudgetRepository", () => {
  it("ida e volta: preços, empresa, clientes, propostas e orçamentos", async () => {
    const storage = new MemoryStorage();
    const repo = new BudgetRepository(storage);
    expect(await repo.getPriceDatabase()).toEqual(createEmptyPriceDatabase());
    expect(await repo.getCompanyProfile()).toBeNull();

    const db = mergePriceItems(createEmptyPriceDatabase(), EXAMPLE_PRICE_ITEMS("2026-10-31"));
    await repo.savePriceDatabase(db);
    expect(await repo.getPriceDatabase()).toEqual(db);
    expect(storage.getItem("atlas:v1:prices")).not.toBeNull();

    await repo.saveCompanyProfile({ name: "Atlas Engenharia", document: "00.000.000/0001-00", address: "Rua A, 1", phone: "", email: "" });
    expect((await repo.getCompanyProfile())?.name).toBe("Atlas Engenharia");
    await expect(repo.saveCompanyProfile({ name: "", document: "", address: "", phone: "", email: "" })).rejects.toThrow(DomainError);

    await repo.saveClient(client("c2", "Zélia"));
    await repo.saveClient(client("c1", "Ana"));
    await repo.saveClient({ ...client("c1", "Ana Souza") });
    expect((await repo.listClients()).map((c) => c.name)).toEqual(["Ana Souza", "Zélia"]);
    await repo.deleteClient("c2");
    expect(await repo.getClient("c2")).toBeNull();

    const { project } = buildReferenceProject();
    const budget = buildBudget(takeoff(project), db, { today: "2026-10-31" });
    const p1 = createProposal({ project, client: { id: "c1" }, budget, existingNumbers: [], now: new Date("2026-10-01T00:00:00Z") });
    await repo.saveProposal(p1);
    const p2 = createProposal({ project, client: { id: "c1" }, budget, existingNumbers: await repo.listProposals(project.id), now: new Date("2026-10-02T00:00:00Z") });
    await repo.saveProposal(p2);
    expect((await repo.listProposals(project.id)).map((p) => p.number)).toEqual(["PROP-2026-0002", "PROP-2026-0001"]);
    expect(await repo.getProposal(project.id, p1.id)).toEqual(p1);
    await expect(repo.saveProposal({ ...p2, id: "outro" })).rejects.toThrow(DomainError);
    await repo.deleteProposal(project.id, p1.id);
    expect(await repo.listProposals(project.id)).toHaveLength(1);
    expect(await repo.listProposals("outro-projeto")).toEqual([]);

    const snap = createBudgetSnapshot(project, budget, { label: "v1" });
    await repo.saveSnapshot(snap);
    expect(await repo.listSnapshots(project.id)).toEqual([snap]);
    await repo.deleteSnapshot(project.id, snap.id);
    expect(await repo.listSnapshots(project.id)).toEqual([]);

    await repo.saveSnapshot(snap);
    await repo.deleteProjectData(project.id);
    expect(storage.getItem(BUDGET_KEYS.proposals(project.id))).toBeNull();
    expect(storage.getItem(BUDGET_KEYS.snapshots(project.id))).toBeNull();
  });

  it("dados corrompidos geram PersistenceError (sem engolir o erro)", async () => {
    const storage = new MemoryStorage();
    const repo = new BudgetRepository(storage);
    storage.setItem(BUDGET_KEYS.prices, "{não é json");
    await expect(repo.getPriceDatabase()).rejects.toThrow(PersistenceError);
    storage.setItem(BUDGET_KEYS.prices, JSON.stringify({ version: 2, items: [] }));
    await expect(repo.getPriceDatabase()).rejects.toThrow(PersistenceError);
    storage.setItem(BUDGET_KEYS.clients, JSON.stringify([{ id: "x" }]));
    await expect(repo.listClients()).rejects.toThrow(PersistenceError);
    storage.setItem(BUDGET_KEYS.proposals("p"), "[1]");
    await expect(repo.listProposals("p")).rejects.toThrow(PersistenceError);
  });

  it("falha de gravação (cota) vira PersistenceError", async () => {
    const storage = new MemoryStorage();
    storage.setItem = () => {
      const e = new Error("exceeded the quota");
      e.name = "QuotaExceededError";
      throw e;
    };
    await expect(new BudgetRepository(storage).savePriceDatabase(createEmptyPriceDatabase())).rejects.toThrow(/esgotado/);
  });
});
