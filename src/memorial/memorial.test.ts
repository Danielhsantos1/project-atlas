import { describe, expect, it } from "vitest";
import { generateMemorialPdf } from "./pdf";
import { MEMORIAL_STATUS, type MemorialDocument } from "./document";

const doc: MemorialDocument = {
  meta: { projectName: "Casa Teste", company: "Atlas (teste)", generatedAt: "2026-11-01T12:00:00.000Z", revisionHash: "abcdef0123456789" },
  pending: ["Informar a intensidade de chuva local (mm/h)."],
  sections: [
    { id: "a", title: "Dados do projeto", blocks: [{ kind: "paragraph", text: "Área construída de 120,00 m² em dois pavimentos." }, { kind: "bullets", items: ["Item um", "Item dois"] }] },
    { id: "b", title: "Cálculo", blocks: [
      { kind: "formula", label: "Vazão de projeto", expression: "Q = I x A / 60", note: "Q em L/min" },
      { kind: "table", caption: "Quadro", head: ["Descrição", "Valor"], rows: [["Área", "10,00 m²"], ["Perímetro", "13,00 m"]], align: ["left", "right"] },
      { kind: "alert", level: "pendente", text: "Sondagem do solo não informada." },
    ] },
  ],
};

describe("memorial de cálculo em PDF", () => {
  it("gera PDF válido com status de rascunho em todas as páginas e campos de assinatura em branco", () => {
    const { bytes, pages } = generateMemorialPdf(doc, { compress: false });
    const txt = new TextDecoder("latin1").decode(bytes);
    expect(txt.startsWith("%PDF-")).toBe(true);
    expect(pages).toBeGreaterThanOrEqual(1);
    const occurrences = txt.split("RASCUNHO TÉCNICO PARA REVISÃO".normalize("NFC")).length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(pages + 1); // capa + rodapé de cada página
    expect(txt).toContain("Responsável técnico");
    expect(txt).toContain("PENDÊNCIAS");
    expect(txt).not.toMatch(/Assinado por|Aprovado por/i);
    expect(MEMORIAL_STATUS).toMatch(/NÃO VALIDADO/);
  });

  it("conteúdo longo quebra em várias páginas sem estourar", () => {
    const big: MemorialDocument = { ...doc, sections: Array.from({ length: 12 }, (_, i) => ({ id: String(i), title: `Seção ${i}`, blocks: [{ kind: "table", head: ["A", "B"], rows: Array.from({ length: 30 }, (_, r) => [`linha ${r}`, String(r)]) } as const] })) };
    expect(generateMemorialPdf(big).pages).toBeGreaterThan(5);
  });
});
