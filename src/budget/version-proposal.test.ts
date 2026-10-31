import { describe, expect, it } from "vitest";
import { DomainError } from "@/core/model/errors";
import { updateElement } from "@/core/model/operations";
import { buildBudget } from "./budget";
import { createEmptyPriceDatabase } from "./prices";
import { computeProposalTotals, createProposal, nextProposalNumber, proposalValidUntil } from "./proposal";
import { takeoff } from "./quantities";
import { buildReferenceProject } from "./test-fixtures";
import { canonicalJson, createBudgetSnapshot, fnv1a64Hex, isBudgetCurrent, projectRevisionHash } from "./version";

function reverseKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(reverseKeys);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reverseKeys(x)]));
  return v;
}

describe("versionamento", () => {
  const { project, shared } = buildReferenceProject();

  it("FNV-1a 64 bits (vetores conhecidos) e JSON canônico", () => {
    expect(fnv1a64Hex("")).toBe("cbf29ce484222325");
    expect(fnv1a64Hex("a")).toBe("af63dc4c8601ec8c");
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: undefined }] })).toBe('{"a":[2,{"d":1}],"b":1}');
  });

  it("hash é estável (ordem de chaves) e ignora nome/datas", () => {
    const h = projectRevisionHash(project);
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(projectRevisionHash(reverseKeys(project) as typeof project)).toBe(h);
    const renamed = { ...project, name: "Outro nome", updatedAt: "2030-01-01T00:00:00.000Z" };
    expect(projectRevisionHash(renamed)).toBe(h);
  });

  it("hash muda quando a geometria ou configurações mudam", () => {
    const h = projectRevisionHash(project);
    const moved = updateElement(project, shared.id, { height: 3 });
    expect(projectRevisionHash(moved)).not.toBe(h);
    expect(projectRevisionHash({ ...project, settings: { ...project.settings, gridSize: 0.5 } })).not.toBe(h);
    const snap = createBudgetSnapshot(project, buildBudget(takeoff(project), createEmptyPriceDatabase(), { today: "2026-10-31" }));
    expect(snap.revisionHash).toBe(h);
    expect(snap.projectUpdatedAt).toBe(project.updatedAt);
    expect(isBudgetCurrent(snap, project)).toBe(true);
    expect(isBudgetCurrent(snap, moved)).toBe(false);
    expect(isBudgetCurrent({ ...snap, projectId: "outro" }, project)).toBe(false);
  });
});

describe("proposta", () => {
  it("totais: custo + margem − desconto", () => {
    expect(computeProposalTotals({ total: 10000 }, 20, 10)).toEqual({ cost: 10000, marginValue: 2000, gross: 12000, discountValue: 1200, total: 10800 });
    expect(computeProposalTotals({ total: 1234.56 }, 0, 0).total).toBe(1234.56);
    expect(computeProposalTotals({ total: 100 }, 300, 100).total).toBe(0);
    expect(() => computeProposalTotals({ total: 1 }, 301, 0)).toThrow(DomainError);
    expect(() => computeProposalTotals({ total: 1 }, -1, 0)).toThrow(DomainError);
    expect(() => computeProposalTotals({ total: 1 }, 10, 101)).toThrow(DomainError);
    expect(() => computeProposalTotals({ total: 1 }, Number.NaN, 0)).toThrow(DomainError);
  });

  it("numeração sequencial por ano", () => {
    const existing = ["PROP-2026-0001", { number: "PROP-2026-0007" }, "PROP-2025-0099", "lixo"];
    expect(nextProposalNumber(existing, 2026)).toBe("PROP-2026-0008");
    expect(nextProposalNumber(existing, 2027)).toBe("PROP-2027-0001");
    expect(nextProposalNumber([], 2026)).toBe("PROP-2026-0001");
    expect(() => nextProposalNumber([], 26)).toThrow(DomainError);
  });

  it("createProposal congela o orçamento e a revisão do projeto", () => {
    const { project } = buildReferenceProject();
    const budget = buildBudget(takeoff(project), createEmptyPriceDatabase(), { today: "2026-10-31" });
    const p = createProposal({ project, client: { id: "c1" }, budget, existingNumbers: ["PROP-2026-0003"], marginPercent: 15, validityDays: 10, now: new Date("2026-10-31T12:00:00Z") });
    expect(p).toMatchObject({ number: "PROP-2026-0004", projectId: project.id, status: "rascunho", version: { revisionHash: projectRevisionHash(project), projectUpdatedAt: project.updatedAt } });
    expect(p.budget).toEqual(budget);
    expect(p.budget).not.toBe(budget);
    expect(proposalValidUntil(p)).toBe("2026-11-10");
    expect(() => createProposal({ project, client: { id: "c1" }, budget, existingNumbers: [], marginPercent: 500 })).toThrow(DomainError);
  });
});
