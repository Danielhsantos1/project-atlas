import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import { pdfText } from "@/budget/pdf";
import { MEMORIAL_DISCLAIMER, MEMORIAL_STATUS, SIGNATURE_FIELDS, type MemorialBlock, type MemorialDocument } from "./document";

const MARGIN = 16;
const ACCENT: [number, number, number] = [30, 64, 110];
const T = pdfText;

export interface MemorialPdfResult {
  bytes: Uint8Array;
  pages: number;
}

/** Desenha o memorial em A4 retrato. Rodapé em TODAS as páginas com o status de rascunho. */
export function generateMemorialPdf(doc: MemorialDocument, options: { compress?: boolean } = {}): MemorialPdfResult {
  const pdf = new jsPDF({ unit: "mm", format: "a4", compress: options.compress ?? true });
  const W = pdf.internal.pageSize.getWidth();
  const H = pdf.internal.pageSize.getHeight();
  const bottom = H - 24;
  let y = MARGIN;

  const ensure = (need: number) => {
    if (y + need > bottom) {
      pdf.addPage();
      y = MARGIN;
    }
  };
  const text = (s: string, size = 9.5, style: "normal" | "bold" | "italic" = "normal", color: [number, number, number] = [30, 30, 30], indent = 0) => {
    pdf.setFont("helvetica", style);
    pdf.setFontSize(size);
    pdf.setTextColor(...color);
    const lines = pdf.splitTextToSize(T(s), W - MARGIN * 2 - indent) as string[];
    for (const l of lines) {
      ensure(size * 0.45);
      pdf.text(l, MARGIN + indent, y);
      y += size * 0.45 + 0.6;
    }
  };

  // ---- Capa ----
  pdf.setFillColor(...ACCENT);
  pdf.rect(0, 0, W, 34, "F");
  pdf.setTextColor(255, 255, 255);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(18);
  pdf.text("MEMORIAL DE CALCULO", MARGIN, 15);
  pdf.setFontSize(10);
  pdf.setFont("helvetica", "normal");
  pdf.text(T(`Pré-dimensionamento e quantitativos - ${doc.meta.projectName}`), MARGIN, 23);
  pdf.text(T(doc.meta.company || "Empresa não informada"), MARGIN, 29);
  y = 42;
  pdf.setFillColor(255, 243, 205);
  pdf.setDrawColor(200, 150, 20);
  pdf.rect(MARGIN, y, W - MARGIN * 2, 14, "FD");
  pdf.setTextColor(120, 70, 0);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(10);
  pdf.text(T(MEMORIAL_STATUS), MARGIN + 3, y + 6);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8.5);
  pdf.text(T(`Gerado em ${doc.meta.generatedAt.slice(0, 10).split("-").reverse().join("/")} - revisão do modelo ${doc.meta.revisionHash.slice(0, 12)}`), MARGIN + 3, y + 11);
  y += 20;
  text(MEMORIAL_DISCLAIMER, 8.5, "italic", [90, 90, 90]);
  y += 2;

  if (doc.pending.length > 0) {
    ensure(14 + doc.pending.length * 5);
    pdf.setFillColor(255, 232, 232);
    pdf.setDrawColor(200, 60, 60);
    const h = 9 + doc.pending.length * 4.6;
    pdf.rect(MARGIN, y, W - MARGIN * 2, h, "FD");
    pdf.setTextColor(150, 30, 30);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9.5);
    pdf.text(T("PENDÊNCIAS - informações necessárias para completar o memorial"), MARGIN + 3, y + 5.5);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8.5);
    doc.pending.forEach((p, i) => pdf.text(T(`- ${p}`), MARGIN + 4, y + 10.5 + i * 4.6, { maxWidth: W - MARGIN * 2 - 8 }));
    y += h + 4;
  }

  // ---- Sumário ----
  text("Sumário", 12, "bold", ACCENT);
  doc.sections.forEach((s, i) => text(`${i + 1}. ${s.title}`, 9.5, "normal", [50, 50, 50], 3));
  y += 4;

  // ---- Seções ----
  const block = (b: MemorialBlock) => {
    switch (b.kind) {
      case "paragraph":
        text(b.text);
        y += 1.2;
        break;
      case "bullets":
        for (const item of b.items) text(`• ${item}`, 9.5, "normal", [30, 30, 30], 3);
        y += 1.2;
        break;
      case "formula":
        ensure(14);
        pdf.setFillColor(240, 244, 250);
        pdf.rect(MARGIN, y - 1, W - MARGIN * 2, b.note ? 13 : 9, "F");
        text(b.label, 8.5, "bold", ACCENT, 2);
        text(b.expression, 10, "normal", [20, 20, 20], 2);
        if (b.note) text(b.note, 8, "italic", [100, 100, 100], 2);
        y += 2;
        break;
      case "alert":
        ensure(12);
        text(`${b.level === "pendente" ? "PENDENTE" : "ATENÇÃO"}: ${b.text}`, 9, "bold", b.level === "pendente" ? [170, 30, 30] : [150, 90, 0], 2);
        y += 1;
        break;
      case "table": {
        if (b.caption) text(b.caption, 9, "bold", ACCENT);
        ensure(18);
        autoTable(pdf, {
          startY: y,
          head: [b.head.map(T)],
          body: b.rows.map((r) => r.map(T)),
          margin: { left: MARGIN, right: MARGIN, bottom: 24 },
          styles: { font: "helvetica", fontSize: 8.2, cellPadding: 1.4, overflow: "linebreak" },
          headStyles: { fillColor: ACCENT, textColor: 255, fontStyle: "bold" },
          alternateRowStyles: { fillColor: [247, 249, 252] },
          columnStyles: Object.fromEntries((b.align ?? []).map((a, i) => [i, { halign: a }])),
        });
        y = (pdf as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4;
        break;
      }
    }
  };
  doc.sections.forEach((s, i) => {
    ensure(24);
    pdf.setDrawColor(...ACCENT);
    pdf.setLineWidth(0.5);
    pdf.line(MARGIN, y, W - MARGIN, y);
    y += 5;
    text(`${i + 1}. ${s.title}`, 13, "bold", ACCENT);
    y += 1;
    s.blocks.forEach(block);
    y += 3;
  });

  // ---- Responsabilidade técnica (SEMPRE em branco) ----
  ensure(60);
  text("Responsabilidade técnica (a ser preenchida pelo profissional)", 12, "bold", ACCENT);
  y += 2;
  for (const f of SIGNATURE_FIELDS) {
    ensure(10);
    text(f, 9, "normal", [60, 60, 60]);
    pdf.setDrawColor(120, 120, 120);
    pdf.setLineWidth(0.2);
    pdf.line(MARGIN + 42, y - 1, W - MARGIN, y - 1);
    y += 6;
  }

  // ---- Rodapé em todas as páginas ----
  const pages = pdf.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    pdf.setPage(p);
    pdf.setDrawColor(200, 200, 200);
    pdf.line(MARGIN, H - 17, W - MARGIN, H - 17);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(7.5);
    pdf.setTextColor(150, 90, 0);
    pdf.text(T(MEMORIAL_STATUS), MARGIN, H - 12.5);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(110, 110, 110);
    pdf.text(T(`${doc.meta.projectName} - memorial de calculo - pág. ${p}/${pages}`), MARGIN, H - 8.5);
  }
  return { bytes: new Uint8Array(pdf.output("arraybuffer")), pages };
}
