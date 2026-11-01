import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import { BUDGET_CATEGORY_LABEL, BUDGET_CATEGORIES } from "./categories";
import { PRICE_STATUS_LABEL } from "./budget";
import type { Client, CompanyProfile, Proposal, ProposalTotals } from "./proposal";
import { proposalValidUntil } from "./proposal";

/** Aviso obrigatório no rodapé de todas as páginas. */
export const PDF_DISCLAIMER = "Estimativa gerada a partir do modelo do PROJECT ATLAS. Não substitui orçamento executivo nem projeto técnico aprovado.";
export const PDF_EXAMPLE_WARNING = "ATENÇÃO: Contém preços de EXEMPLO - valores ilustrativos, não utilizar como orçamento real.";

export interface ProposalPdfInput {
  proposal: Proposal;
  company: CompanyProfile;
  client: Client;
  totals: ProposalTotals;
}

export interface ProposalPdfOptions {
  /** Comprime os streams do PDF (padrão true). Use false em testes para inspecionar o texto. */
  compress?: boolean;
}

export interface ProposalPdfResult {
  bytes: Uint8Array;
  pages: number;
  /** Imagens ignoradas por estarem inválidas/ilegíveis. */
  skippedImages: number;
}

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const NUM = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });

/**
 * Texto seguro para as fontes padrão do jsPDF (WinAnsi/Latin-1): acentos do
 * português são preservados; caracteres fora do Latin-1 são substituídos.
 */
export function pdfText(s: string): string {
  return s
    .replace(/[   ]/g, " ")
    .replace(/[‒-―−]/g, "-")
    .replace(/[‘’‚]/g, "'")
    .replace(/[“”„]/g, '"')
    .replace(/…/g, "...")
    .replace(/≈/g, "~")
    .replace(/Σ/g, "Soma")
    .replace(/π/g, "pi")
    .replace(/[≤]/g, "<=")
    .replace(/[≥]/g, ">=")
    .replace(/[^\x00-\xFF]/g, "?");
}

export const formatBRL = (n: number): string => pdfText(BRL.format(n));
const formatDate = (iso: string): string => {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
};

const MARGIN = 15;
const FOOTER_SPACE = 22;
const ACCENT: [number, number, number] = [30, 64, 110];

function imageFormat(dataUrl: string): "PNG" | "JPEG" | null {
  const m = /^data:image\/(png|jpe?g);base64,/i.exec(dataUrl);
  if (!m) return null;
  return m[1]!.toLowerCase() === "png" ? "PNG" : "JPEG";
}

export function generateProposalPdfWithReport(input: ProposalPdfInput, options: ProposalPdfOptions = {}): ProposalPdfResult {
  const { proposal, company, client, totals } = input;
  const budget = proposal.budget;
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: options.compress ?? true });
  doc.setProperties({ title: pdfText(`Proposta ${proposal.number}`), subject: pdfText(proposal.projectName), creator: "PROJECT ATLAS" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const contentW = pageW - MARGIN * 2;
  let y = MARGIN;

  const ensure = (h: number) => {
    if (y + h > pageH - FOOTER_SPACE) {
      doc.addPage();
      y = MARGIN;
    }
  };
  const text = (s: string, size = 10, style: "normal" | "bold" | "italic" = "normal", color: [number, number, number] = [30, 30, 30]) => {
    doc.setFont("helvetica", style);
    doc.setFontSize(size);
    doc.setTextColor(...color);
    const lines = doc.splitTextToSize(pdfText(s), contentW) as string[];
    const lh = size * 0.42;
    for (const line of lines) {
      ensure(lh);
      doc.text(line, MARGIN, y + lh * 0.8);
      y += lh;
    }
  };
  const section = (title: string) => {
    ensure(12);
    y += 3;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...ACCENT);
    doc.text(pdfText(title.toUpperCase()), MARGIN, y + 4);
    y += 6;
    doc.setDrawColor(...ACCENT);
    doc.setLineWidth(0.3);
    doc.line(MARGIN, y, pageW - MARGIN, y);
    y += 2.5;
  };
  const tableEnd = () => (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? y;

  // ---------- Cabeçalho: empresa ----------
  let logoW = 0;
  if (company.logoDataUrl) {
    const fmt = imageFormat(company.logoDataUrl);
    try {
      if (!fmt) throw new Error("formato");
      const props = doc.getImageProperties(company.logoDataUrl);
      const h = 18;
      const w = Math.min(40, (props.width / props.height) * h);
      doc.addImage(company.logoDataUrl, fmt, MARGIN, y, w, h);
      logoW = w + 4;
    } catch {
      logoW = 0;
    }
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(...ACCENT);
  doc.text(pdfText(company.name), MARGIN + logoW, y + 6);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(80, 80, 80);
  const companyInfo = [company.document && `CNPJ/CPF: ${company.document}`, company.address, [company.phone, company.email].filter(Boolean).join("  |  ")].filter(Boolean);
  companyInfo.forEach((line, i) => doc.text(pdfText(String(line)), MARGIN + logoW, y + 11 + i * 3.8));

  // Bloco da proposta (à direita)
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...ACCENT);
  doc.text(pdfText("PROPOSTA COMERCIAL"), pageW - MARGIN, y + 5, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(40, 40, 40);
  doc.text(pdfText(`Nº ${proposal.number}`), pageW - MARGIN, y + 10.5, { align: "right" });
  doc.text(pdfText(`Data: ${formatDate(proposal.createdAt)}`), pageW - MARGIN, y + 14.5, { align: "right" });
  doc.text(pdfText(`Válida até: ${formatDate(proposalValidUntil(proposal))} (${proposal.validityDays} dias)`), pageW - MARGIN, y + 18.5, { align: "right" });
  if (proposal.status === "rascunho") {
    doc.setTextColor(170, 60, 20);
    doc.text("RASCUNHO", pageW - MARGIN, y + 22.5, { align: "right" });
  }
  y += Math.max(26, 11 + companyInfo.length * 3.8 + 4);
  doc.setDrawColor(...ACCENT);
  doc.setLineWidth(0.8);
  doc.line(MARGIN, y, pageW - MARGIN, y);
  y += 4;

  // ---------- Aviso de preços de exemplo ----------
  if (budget.examplePrices > 0) {
    ensure(12);
    doc.setFillColor(255, 236, 179);
    doc.setDrawColor(200, 120, 0);
    doc.setLineWidth(0.5);
    doc.rect(MARGIN, y, contentW, 10, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.setTextColor(150, 60, 0);
    doc.text(pdfText(PDF_EXAMPLE_WARNING), pageW / 2, y + 6.3, { align: "center", maxWidth: contentW - 4 });
    y += 13;
  }

  // ---------- Cliente e projeto ----------
  section("Cliente");
  text(client.name, 10, "bold");
  const clientInfo = [
    client.contact && `Contato: ${client.contact}`,
    client.document && `CPF/CNPJ: ${client.document}`,
    client.address && `Endereço: ${client.address}`,
    [client.phone && `Telefone: ${client.phone}`, client.email && `E-mail: ${client.email}`].filter(Boolean).join("   "),
  ].filter(Boolean);
  for (const line of clientInfo) text(String(line), 9);

  section("Projeto");
  text(proposal.projectName, 10, "bold");
  text(`Revisão do modelo: ${proposal.version.revisionHash} (atualizado em ${formatDate(proposal.version.projectUpdatedAt)})`, 8.5, "normal", [90, 90, 90]);

  // ---------- Imagens ----------
  let skippedImages = 0;
  const valid: Array<{ url: string; fmt: "PNG" | "JPEG"; ratio: number }> = [];
  for (const url of proposal.images) {
    const fmt = imageFormat(url);
    if (!fmt) {
      skippedImages++;
      continue;
    }
    try {
      const props = doc.getImageProperties(url);
      if (!(props.width > 0 && props.height > 0)) throw new Error("dimensões");
      valid.push({ url, fmt, ratio: props.height / props.width });
    } catch {
      skippedImages++;
    }
  }
  if (valid.length > 0 || skippedImages > 0) {
    section("Imagens");
    const gap = 4;
    const cellW = (contentW - gap) / 2;
    for (let i = 0; i < valid.length; i += 2) {
      const row = valid.slice(i, i + 2);
      const heights = row.map((im) => Math.min(cellW * im.ratio, 80));
      const rowH = Math.max(...heights);
      ensure(rowH + gap);
      row.forEach((im, j) => {
        const h = heights[j]!;
        const w = h / im.ratio;
        const x = MARGIN + j * (cellW + gap) + (cellW - w) / 2;
        try {
          doc.addImage(im.url, im.fmt, x, y, w, h);
        } catch {
          skippedImages++;
        }
      });
      y += rowH + gap;
    }
    if (skippedImages > 0) text(`${skippedImages} imagem(ns) inválida(s) não incluída(s).`, 8, "italic", [120, 120, 120]);
  }

  // ---------- Escopo ----------
  if (proposal.scope.trim()) {
    section("Escopo / descrição dos serviços");
    text(proposal.scope, 9.5);
  }

  // ---------- Quantitativos e preços ----------
  section("Quantitativos e preços");
  const body = budget.lines.map((l) => [
    pdfText(l.description + (l.priceStatus !== "ok" && l.priceStatus !== "sem-preco" ? ` [${PRICE_STATUS_LABEL[l.priceStatus]}]` : "")),
    pdfText(l.unit),
    pdfText(NUM.format(l.quantity)),
    l.unitPrice === null ? "sem preço" : formatBRL(l.unitPrice),
    l.priceStatus === "sem-preco" ? "sem preço" : formatBRL(l.total),
  ]);
  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN, bottom: FOOTER_SPACE, top: MARGIN },
    head: [["Descrição", "Un.", "Quant.", "Preço unit.", "Total"]],
    body: body.map((r) => r.map((c) => pdfText(c))),
    theme: "striped",
    styles: { font: "helvetica", fontSize: 8, cellPadding: 1.6, overflow: "linebreak" },
    headStyles: { fillColor: ACCENT, textColor: 255, fontStyle: "bold" },
    columnStyles: { 0: { cellWidth: "auto" }, 1: { cellWidth: 13, halign: "center" }, 2: { cellWidth: 20, halign: "right" }, 3: { cellWidth: 28, halign: "right" }, 4: { cellWidth: 30, halign: "right" } },
    didParseCell: (data) => {
      if (data.section === "body" && (data.column.index === 3 || data.column.index === 4) && data.cell.raw === "sem preço") {
        data.cell.styles.textColor = [180, 40, 40];
        data.cell.styles.fontStyle = "bold";
      }
    },
  });
  y = tableEnd() + 4;
  if (budget.missingPrices > 0) {
    text(`${budget.missingPrices} item(ns) sem preço não estão incluídos nos totais.`, 8.5, "bold", [180, 40, 40]);
  }

  // ---------- Totais por categoria ----------
  section("Totais por categoria");
  const catRows = BUDGET_CATEGORIES.filter((c) => budget.totalsByCategory[c] !== 0).map((c) => [pdfText(BUDGET_CATEGORY_LABEL[c]), formatBRL(budget.totalsByCategory[c])]);
  const summary: string[][] = [
    ...catRows,
    ["Subtotal (custo direto)", formatBRL(budget.subtotal)],
    [pdfText(`BDI (${NUM.format(budget.bdiPercent)}%)`), formatBRL(budget.bdi)],
    ["Custo total", formatBRL(totals.cost)],
    [pdfText(`Margem (${NUM.format(proposal.marginPercent)}%)`), formatBRL(totals.marginValue)],
    ["Valor bruto", formatBRL(totals.gross)],
    [pdfText(`Desconto (${NUM.format(proposal.discountPercent)}%)`), `- ${formatBRL(totals.discountValue)}`],
  ];
  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN + contentW * 0.35, right: MARGIN, bottom: FOOTER_SPACE, top: MARGIN },
    body: summary.map((r) => r.map((c) => pdfText(c))),
    foot: [[pdfText("VALOR TOTAL DA PROPOSTA"), formatBRL(totals.total)]],
    theme: "grid",
    styles: { font: "helvetica", fontSize: 9, cellPadding: 1.8 },
    footStyles: { fillColor: ACCENT, textColor: 255, fontStyle: "bold", fontSize: 10.5 },
    columnStyles: { 1: { halign: "right", cellWidth: 40 } },
    showFoot: "lastPage",
  });
  y = tableEnd() + 4;
  if (budget.regionalFactor !== 1) text(`Fator regional aplicado aos preços unitários: ${NUM.format(budget.regionalFactor)}.`, 8.5, "italic", [90, 90, 90]);

  // ---------- Condições comerciais ----------
  section("Condições comerciais");
  text(`Forma de pagamento: ${proposal.paymentTerms.trim() || "a combinar"}`, 9.5);
  text(`Prazo de execução: ${proposal.deadlineDays} dias`, 9.5);
  text(`Validade da proposta: ${proposal.validityDays} dias (até ${formatDate(proposalValidUntil(proposal))})`, 9.5);

  if (proposal.notes.trim()) {
    section("Observações");
    text(proposal.notes, 9.5);
  }

  // ---------- Rodapé em todas as páginas ----------
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    const fy = pageH - FOOTER_SPACE + 6;
    doc.setDrawColor(180, 180, 180);
    doc.setLineWidth(0.2);
    doc.line(MARGIN, fy - 3, pageW - MARGIN, fy - 3);
    doc.setFont("helvetica", "italic");
    doc.setFontSize(7);
    doc.setTextColor(90, 90, 90);
    doc.text(doc.splitTextToSize(pdfText(PDF_DISCLAIMER), contentW) as string[], MARGIN, fy);
    if (budget.examplePrices > 0) {
      doc.setFont("helvetica", "bold");
      doc.setTextColor(170, 60, 0);
      doc.text(pdfText("Contém preços de EXEMPLO"), MARGIN, fy + 7);
    }
    doc.setFont("helvetica", "normal");
    doc.setTextColor(90, 90, 90);
    doc.text(pdfText(`${proposal.number} - página ${i} de ${pages}`), pageW - MARGIN, fy + 7, { align: "right" });
  }

  const bytes = new Uint8Array(doc.output("arraybuffer"));
  return { bytes, pages, skippedImages };
}

/** Gera o PDF da proposta (A4 retrato) e devolve os bytes. */
export function generateProposalPdf(input: ProposalPdfInput, options: ProposalPdfOptions = {}): Uint8Array {
  return generateProposalPdfWithReport(input, options).bytes;
}
