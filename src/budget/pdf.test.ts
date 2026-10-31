import { describe, expect, it } from "vitest";
import { buildBudget } from "./budget";
import { EXAMPLE_PRICE_ITEMS, createEmptyPriceDatabase, mergePriceItems } from "./prices";
import { computeProposalTotals, createProposal, type Client, type CompanyProfile } from "./proposal";
import { takeoff } from "./quantities";
import { PDF_DISCLAIMER, generateProposalPdf, generateProposalPdfWithReport, pdfText } from "./pdf";
import { buildReferenceProject } from "./test-fixtures";

const PNG_1PX = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const company: CompanyProfile = { name: "Atlas Engenharia Ltda.", document: "00.000.000/0001-00", address: "Av. Paulista, 1000 - São Paulo/SP", phone: "(11) 0000-0000", email: "contato@exemplo.com", logoDataUrl: PNG_1PX };
const client: Client = { id: "c1", name: "João da Silva", contact: "João", phone: "(11) 90000-0000", email: "joao@exemplo.com", document: "000.000.000-00", address: "Rua das Flores, 10", createdAt: "2026-10-01T00:00:00.000Z" };

function setup(withExamples: boolean) {
  const { project } = buildReferenceProject();
  const db = withExamples ? mergePriceItems(createEmptyPriceDatabase(), EXAMPLE_PRICE_ITEMS("2026-10-31")) : createEmptyPriceDatabase();
  const budget = buildBudget(takeoff(project), db, { today: "2026-10-31", bdiPercent: 10 });
  const proposal = createProposal({
    project, client, budget, existingNumbers: [], marginPercent: 20, discountPercent: 5,
    scope: "Construção de residência térrea com sala, quarto, piscina e paisagismo.",
    paymentTerms: "30% de entrada e 7 parcelas mensais", deadlineDays: 180, validityDays: 15, notes: "Valores sujeitos a revisão — após visita técnica.",
    images: [PNG_1PX, "data:image/png;base64,AAAA", "nao-e-imagem", PNG_1PX, PNG_1PX], now: new Date("2026-10-31T12:00:00Z"),
  });
  return { proposal, totals: computeProposalTotals(budget, 20, 5) };
}

const latin1 = (b: Uint8Array) => Buffer.from(b).toString("latin1");

describe("PDF da proposta", () => {
  it("gera PDF válido com aviso obrigatório, exemplo destacado, acentos e 'sem preço'", () => {
    const { proposal, totals } = setup(true);
    const r = generateProposalPdfWithReport({ proposal, company, client, totals }, { compress: false });
    const s = latin1(r.bytes);
    expect(s.startsWith("%PDF")).toBe(true);
    expect(s).toContain(PDF_DISCLAIMER);
    expect(s).toContain("Contém preços de EXEMPLO");
    expect(s).toContain("João da Silva");
    expect(s).toContain("PROP-2026-0001");
    expect(s).toContain("sem preço");
    expect(s).toContain("Válida até");
    expect(s).toContain(proposal.version.revisionHash);
    expect(s).toContain("Valores sujeitos a revisão - após visita técnica.");
    expect(r.skippedImages).toBe(2);
    expect(s).toContain("2 imagem\\(ns\\) inválida"); // jsPDF escapa parênteses
    expect(r.pages).toBeGreaterThanOrEqual(2);
    expect(s.match(new RegExp(PDF_DISCLAIMER.replace(/\./g, "\\."), "g"))?.length).toBe(r.pages);
  });

  it("sem preços de exemplo não exibe o aviso; compressão padrão produz bytes PDF", () => {
    const { proposal, totals } = setup(false);
    const s = latin1(generateProposalPdf({ proposal, company: { ...company, logoDataUrl: undefined }, client, totals }, { compress: false }));
    expect(s).not.toContain("Contém preços de EXEMPLO");
    expect(s).toContain(PDF_DISCLAIMER);
    const compressed = generateProposalPdf({ proposal, company, client, totals });
    expect(latin1(compressed.slice(0, 5))).toBe("%PDF-");
  });

  it("pdfText remove caracteres fora do Latin-1", () => {
    expect(pdfText("a — b ≈ c “d” Σ π ção")).toBe('a - b ~ c "d" Soma pi ção');
  });
});
