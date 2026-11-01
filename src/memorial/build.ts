import type { Project } from "@/core/model/schema";
import { roomShape } from "@/core/geometry/rooms";
import { levelWalls } from "@/core/model/operations";
import { ROOM_TYPE_INFO } from "@/core/model/factory";
import { projectRevisionHash } from "@/budget/version";
import type { Assumption } from "@/engineering/types";
import type { EngineeringSummary } from "@/engineering";
import type { MemorialBlock, MemorialDocument, MemorialSection } from "./document";

const n = (v: number, d = 2) => v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
const cm = (m: number) => `${n(m * 100, 0)} cm`;

export interface MaterialRow {
  description: string;
  unit: string;
  quantity: number;
  basis?: string;
}

export interface MemorialInput {
  project: Project;
  summary: EngineeringSummary;
  company?: string;
  client?: string;
  address?: string;
  now?: Date;
  /** Lista consolidada de materiais (quantitativo da obra), quando disponível. */
  materials?: MaterialRow[];
}

const assumptionRows = (list: Assumption[]) =>
  list.map((a) => [a.label, `${typeof a.value === "number" ? n(a.value, a.value % 1 === 0 ? 0 : 3) : a.value}${a.unit ? ` ${a.unit}` : ""}`, a.origin]);

/**
 * Monta o memorial a partir do projeto e dos resultados de engenharia.
 * Cada seção traz fórmulas, quadros e as premissas/avisos do respectivo cálculo.
 */
export function buildMemorial(input: MemorialInput): MemorialDocument {
  const { project, summary } = input;
  const now = input.now ?? new Date();
  const sections: MemorialSection[] = [];

  // 1. Identificação e quadro de áreas
  const rooms = project.elements.filter((e) => e.type === "room");
  const rows: string[][] = [];
  let total = 0;
  for (const r of rooms) {
    if (r.type !== "room") continue;
    const shape = roomShape(levelWalls(project, r.levelId), r.seed);
    const level = project.levels.find((l) => l.id === r.levelId);
    if (shape) total += shape.area;
    rows.push([r.name, ROOM_TYPE_INFO[r.roomType].label, level?.name ?? "-", shape ? `${n(shape.area)} m²` : "ambiente aberto", shape ? `${n(shape.perimeter)} m` : "-"]);
  }
  rows.push(["TOTAL (área útil)", "", "", `${n(total)} m²`, ""]);
  sections.push({
    id: "identificacao",
    title: "Identificação e quadro de áreas",
    blocks: [
      { kind: "paragraph", text: `Projeto: ${project.name}. Terreno de ${n(project.site.width)} x ${n(project.site.depth)} m. ${project.levels.length} pavimento(s): ${project.levels.map((l) => `${l.name} (cota ${n(l.elevation)} m, piso a piso ${n(l.height)} m)`).join("; ")}.` },
      { kind: "paragraph", text: "Áreas úteis medidas pelas faces internas das paredes, derivadas da geometria do modelo (valores de modelo, não levantamento topográfico)." },
      { kind: "table", caption: "Quadro de áreas por ambiente", head: ["Ambiente", "Tipo", "Pavimento", "Área útil", "Perímetro"], rows, align: ["left", "left", "left", "right", "right"] },
    ],
  });

  // 2. Cobertura e calhas
  if (summary.roofs) {
    const blocks: MemorialBlock[] = [];
    summary.roofs.forEach((r, i) => {
      blocks.push({ kind: "paragraph", text: `Cobertura ${i + 1}: ${r.cover.label}. Inclinação ${n(r.pitchPercent, 1)}% (${n(r.pitchDeg, 1)}°), altura da cumeeira ${n(r.riseM)} m, área inclinada ${n(r.inclinedAreaM2)} m², projeção ${n(r.planAreaM2)} m².` });
      blocks.push({ kind: "formula", label: "Altura da cumeeira", expression: "h = (vão/2) x tan(α)", note: `α = ${n(r.pitchDeg, 1)}°` });
      if (r.tiles.count !== null) blocks.push({ kind: "paragraph", text: `Telhas: ${n(r.tiles.perM2 ?? 0, 1)} un/m² x ${n(r.inclinedAreaM2)} m² + perda de ${n(r.tiles.lossPercent, 0)}% = ${n(r.tiles.count, 0)} unidades; cumeeira ${n(r.tiles.ridgeLinearM)} m (${r.tiles.ridgeTileCount ?? "-"} peças).` });
      blocks.push({ kind: "alert", level: r.pitchCheck.ok ? "aviso" : "pendente", text: r.pitchCheck.message });
      blocks.push({ kind: "paragraph", text: r.overhangCheck.message });
      blocks.push({ kind: "paragraph", text: r.framingNote });
      if (r.gutters) {
        blocks.push({ kind: "formula", label: "Vazão de contribuição (NBR 10844 — consulta)", expression: "Q = I x A / 60  [L/min]", note: `I = ${n(r.gutters.rainIntensityMmH, 0)} mm/h (informado)` });
        blocks.push({ kind: "formula", label: "Capacidade da calha semicircular (Manning-Strickler)", expression: "Q = K x (S/n) x R_H^(2/3) x i^(1/2),  K = 60000", note: `n = ${r.gutters.manningN}; i = ${n(r.gutters.slope * 100, 2)}%` });
        blocks.push({ kind: "table", caption: `Calhas - cobertura ${i + 1}`, head: ["Lado", "Beiral (m)", "Área contrib. (m²)", "Vazão (L/min)", "Condutores", "Calha"], rows: r.gutters.sides.map((s) => [s.label, n(s.eaveLengthM), n(s.contributingAreaM2), n(s.flowLMin), String(s.leaders), s.diameterMm ? `Ø${s.diameterMm} mm` : "nenhuma atende"]), align: ["left", "right", "right", "right", "right", "left"] });
        blocks.push({ kind: "paragraph", text: r.gutters.leaderNote });
      } else {
        blocks.push({ kind: "alert", level: "pendente", text: "Calhas não dimensionadas: informe a intensidade de chuva local (mm/h)." });
      }
    });
    sections.push({ id: "cobertura", title: "Cobertura e calhas", blocks });
  }

  // 3. Água fria
  if (summary.water) {
    const w = summary.water;
    const blocks: MemorialBlock[] = [
      { kind: "paragraph", text: `Ocupação estimada: ${w.bedrooms} dormitório(s) x pessoas por dormitório = ${w.occupants} pessoas.` },
      { kind: "formula", label: "Volume de reservação", expression: `V = pessoas x consumo x dias = ${w.occupants} x ${n(w.volume.perCapitaLPerDay, 0)} x ${n(w.volume.reserveDays, 0)} = ${n(w.volume.requiredL, 0)} L`, note: `Reservatório adotado: ${w.volume.tanks.map((t) => `${n(t, 0)} L`).join(" + ")} (capacidade ${n(w.volume.totalCapacityL, 0)} L)` },
    ];
    if (w.location) blocks.push({ kind: "paragraph", text: `Posição sugerida para o reservatório: x = ${n(w.location.x)} m, y = ${n(w.location.y)} m, sobre eixo de parede do pavimento mais alto. ${w.location.reason}` });
    blocks.push({ kind: "formula", label: "Pressão estática e dinâmica estimada", expression: "p_est = cota da base do reservatório - cota do ponto de utilização [mca];  p_din = p_est - perda de carga", note: `Base: ${n(w.pressure.tankBaseElevation)} m (${w.pressure.tankBaseSource}); perda de carga ${n(w.pressure.headLossMca)} mca` });
    blocks.push({ kind: "table", caption: "Pressões nos pontos de utilização", head: ["Ponto", "Cota saída (m)", "P. estática (mca)", "P. dinâmica (mca)", "Situação"], rows: w.fixtures.map((f) => [f.name, n(f.outletElevation), n(f.staticMca), n(f.dynamicMca), f.status]), align: ["left", "right", "right", "right", "left"] });
    blocks.push({ kind: "paragraph", text: w.pressure.recommendation });
    blocks.push({ kind: "paragraph", text: `Carga do reservatório cheio sobre a estrutura: ${n(w.tankLoad.totalKN)} kN. ${w.tankLoad.note}` });
    sections.push({ id: "agua", title: "Água fria: reservatório e pressão", blocks });
  }

  // 4. Estrutura
  if (summary.structure) {
    const s = summary.structure;
    const blocks: MemorialBlock[] = [
      { kind: "paragraph", text: `Materiais: fck = ${n(s.materials.fckMPa, 0)} MPa, fcd = ${n(s.materials.fcdMPa)} MPa, fyd = ${n(s.materials.fydMPa)} MPa, γf = ${n(s.materials.gammaF, 1)}. Lançamento estrutural PRELIMINAR sobre as paredes do modelo.` },
      { kind: "formula", label: "Laje maciça", expression: "h = lx / 40  (mínimos: 8 cm piso, 7 cm cobertura)", note: "Referência NBR 6118 — conferir." },
      { kind: "formula", label: "Viga", expression: "h = L / 12 (contínua),  h_min = 25 cm,  b_min = 12 cm" },
      { kind: "formula", label: "Pilar (pré-dimensionamento)", expression: "A_c = 1,5 x N_d / (0,85 f_cd + ρ (f_yd - 0,85 f_cd)),  ρ = 0,02;  A_c,min = 360 cm², lado mín. 19 cm", note: "Fator 1,5 cobre excentricidades e esbeltez no pré-dimensionamento." },
      { kind: "table", caption: "Resumo por pavimento", head: ["Pavimento", "Pilares", "Vigas", "Lajes"], rows: s.levels.map((l) => [l.name, String(l.columns), String(l.beams), String(l.slabs)]), align: ["left", "right", "right", "right"] },
      { kind: "table", caption: "Pilares", head: ["Pilar", "Pav.", "Seção (cm)", "Nk (kN)", "Nd (kN)", "Área (cm²)", "Critério"], rows: s.columns.map((c) => [c.id, project.levels.find((l) => l.id === c.levelId)?.name ?? c.levelId, `${n(c.b * 100, 0)} x ${n(c.h * 100, 0)}`, n(c.Nk, 1), n(c.Nd, 1), n(c.areaCm2, 0), c.governedBy]), align: ["left", "left", "left", "right", "right", "right", "left"] },
      { kind: "table", caption: "Vigas (baldrame, pavimentos e cobertura)", head: ["Viga", "Tipo", "Vão (m)", "Seção (cm)", "qk (kN/m)"], rows: [...s.baldrame, ...s.beams].map((b) => [b.id, b.kind, n(b.length), `${n(b.b * 100, 0)} x ${n(b.h * 100, 0)}`, n(b.qk, 1)]), align: ["left", "left", "right", "left", "right"] },
      { kind: "table", caption: "Lajes", head: ["Laje", "Tipo", "lx x ly (m)", "h (cm)", "g (kN/m²)", "q (kN/m²)"], rows: s.slabs.map((l) => [l.id, l.kind, `${n(l.lx)} x ${n(l.ly)}`, n(l.h * 100, 0), n(l.g), n(l.q)]), align: ["left", "left", "left", "right", "right", "right"] },
    ];
    if (s.foundation) {
      blocks.push({ kind: "formula", label: "Sapata isolada", expression: "A = 1,1 x N_k / σ_adm", note: "σ_adm informado pelo usuário (sondagem SPT)." });
      blocks.push({ kind: "table", caption: "Sapatas", head: ["Sapata", "Pilar", "Nk (kN)", "Lado (cm)"], rows: s.foundation.map((f) => [f.id, f.columnId, n(f.Nk, 1), cm(f.side)]), align: ["left", "left", "right", "right"] });
    } else {
      blocks.push({ kind: "alert", level: "pendente", text: "Fundação não dimensionada: informe a tensão admissível do solo (sondagem SPT)." });
    }
    const q = s.quantities;
    blocks.push({ kind: "table", caption: "Quantitativos estruturais estimados", head: ["Item", "Concreto (m³)", "Aço (kg)", "Fôrma (m²)"], rows: [["Pilares", n(q.concreteM3.columns), n(q.steelKg.columns, 0), n(q.formworkM2.columns)], ["Vigas", n(q.concreteM3.beams), n(q.steelKg.beams, 0), n(q.formworkM2.beams)], ["Lajes", n(q.concreteM3.slabs), n(q.steelKg.slabs, 0), n(q.formworkM2.slabs)], ["TOTAL (sem sapatas)", n(q.concreteM3.total), n(q.steelKg.total, 0), n(q.formworkM2.total)]], align: ["left", "right", "right", "right"] });
    blocks.push({ kind: "paragraph", text: q.note });
    blocks.push({ kind: "alert", level: "aviso", text: "Apenas cargas verticais características. Vento, estabilidade global, flechas, fissuração, punção e detalhamento NÃO foram verificados." });
    sections.push({ id: "estrutura", title: "Estrutura: pré-dimensionamento", blocks });
  }

  // 5. Materiais
  if (input.materials && input.materials.length > 0) {
    sections.push({
      id: "materiais",
      title: "Quantidade de materiais da obra",
      blocks: [
        { kind: "paragraph", text: "Quantidades levantadas da geometria do modelo, líquidas de aberturas, com perdas e traços de referência editáveis (não normativos)." },
        { kind: "table", head: ["Material", "Un.", "Quantidade", "Memória de cálculo"], rows: input.materials.map((m) => [m.description, m.unit, n(m.quantity, 2), m.basis ?? ""]), align: ["left", "left", "right", "left"] },
        { kind: "alert", level: "aviso", text: "Instalações elétricas, hidráulicas e de gás não estão modeladas: orçar à parte." },
      ],
    });
  }

  // 6. Premissas, referências e avisos
  const assumptions: Array<[string, Assumption[]]> = [];
  if (summary.roofs?.[0]) assumptions.push(["Cobertura", summary.roofs[0].assumptions]);
  if (summary.water) assumptions.push(["Água fria", summary.water.assumptions]);
  if (summary.structure) assumptions.push(["Estrutura", summary.structure.assumptions]);
  const refs = new Set<string>();
  for (const r of summary.roofs ?? []) r.references.forEach((x) => refs.add(x));
  summary.water?.references.forEach((x) => refs.add(x));
  summary.structure?.references.forEach((x) => refs.add(x));
  sections.push({
    id: "premissas",
    title: "Premissas, referências normativas e avisos",
    blocks: [
      { kind: "paragraph", text: "Origem das premissas: INFORMADO (veio do usuário), ADOTADO (escolha do módulo de cálculo) e REFERENCIA (valor usual a conferir na norma ou com o fabricante). Toda premissa deve ser validada pelo responsável técnico." },
      ...assumptions.map(([label, list]): MemorialBlock => ({ kind: "table", caption: `Premissas - ${label}`, head: ["Premissa", "Valor", "Origem"], rows: assumptionRows(list) })),
      { kind: "bullets", items: [...refs].sort() },
      ...(summary.warnings.length ? [{ kind: "bullets", items: summary.warnings } as MemorialBlock] : []),
    ],
  });

  return {
    meta: {
      projectName: project.name,
      company: input.company ?? "",
      ...(input.client ? { client: input.client } : {}),
      ...(input.address ? { address: input.address } : {}),
      generatedAt: now.toISOString(),
      revisionHash: projectRevisionHash(project),
    },
    sections,
    pending: summary.missingInputs,
  };
}
