import type { Roof } from "../core/model/schema";
import { roofGeometry } from "../core/geometry/roof";
import { radToDeg } from "../core/units/units";
import { assume, baseCalc, resolveParam, type Assumption, type CalcBase } from "./types";

/**
 * Cobertura: geometria, telhas, verificação de inclinação e calhas (método NBR 10844).
 * PRÉ-DIMENSIONAMENTO — a estrutura do telhado (madeira/aço) NÃO é dimensionada.
 */

export type RoofCoverTypeId =
  | "ceramic-colonial"
  | "ceramic-romana"
  | "ceramic-francesa"
  | "concrete-tile"
  | "fibrocimento"
  | "metal-trapezoidal"
  | "metal-sandwich"
  | "flat-slab";

export interface RoofCoverType {
  id: RoofCoverTypeId;
  label: string;
  /** Inclinação mínima recomendada (%). */
  minPitchPercent: number;
  /** Peças por m² de água (null = chapa/telha contínua). */
  tilesPerM2: number | null;
  origin: "referencia";
  note: string;
}

const REF_NOTE = "referencia (confirmar com o fabricante)";

export const ROOF_COVER_TYPES: readonly RoofCoverType[] = [
  { id: "ceramic-colonial", label: "Telha cerâmica colonial (capa e canal)", minPitchPercent: 30, tilesPerM2: 26, origin: "referencia", note: REF_NOTE },
  { id: "ceramic-romana", label: "Telha cerâmica romana", minPitchPercent: 30, tilesPerM2: 16, origin: "referencia", note: REF_NOTE },
  { id: "ceramic-francesa", label: "Telha cerâmica francesa (marselha)", minPitchPercent: 35, tilesPerM2: 16, origin: "referencia", note: REF_NOTE },
  { id: "concrete-tile", label: "Telha de concreto", minPitchPercent: 30, tilesPerM2: 10.5, origin: "referencia", note: REF_NOTE },
  { id: "fibrocimento", label: "Telha de fibrocimento ondulada", minPitchPercent: 10, tilesPerM2: null, origin: "referencia", note: REF_NOTE },
  { id: "metal-trapezoidal", label: "Telha metálica trapezoidal", minPitchPercent: 5, tilesPerM2: null, origin: "referencia", note: REF_NOTE },
  { id: "metal-sandwich", label: "Telha metálica sanduíche (termoacústica)", minPitchPercent: 5, tilesPerM2: null, origin: "referencia", note: REF_NOTE },
  { id: "flat-slab", label: "Laje impermeabilizada (cobertura plana)", minPitchPercent: 1, tilesPerM2: null, origin: "referencia", note: REF_NOTE },
];

export const roofCoverById = (id: RoofCoverTypeId): RoofCoverType => ROOF_COVER_TYPES.find((c) => c.id === id)!;

/** Inclinação mínima de escoamento de laje plana impermeabilizada (%). */
export const FLAT_SLAB_MIN_SLOPE_PERCENT = 1;

export interface RoofDesignParams {
  coverType?: RoofCoverTypeId;
  /** Perda/quebra de telhas (%). Padrão 10. */
  lossPercent?: number;
  /** Comprimento útil da telha de cumeeira (m). Padrão 0,40. */
  ridgeTileLengthM?: number;
  minOverhangM?: number;
  maxOverhangM?: number;
  /** Intensidade de chuva de projeto (mm/h). SEM padrão — depende do local. */
  rainIntensityMmH?: number;
  /** Declividade da calha (m/m). Padrão 0,005. */
  gutterSlope?: number;
  /** Coeficiente de Manning. Padrão 0,011. */
  manningN?: number;
  /** Fator de segurança sobre a vazão. Padrão 1,0. */
  gutterSafetyFactor?: number;
  /** Diâmetros comerciais de calha semicircular (mm). */
  gutterDiametersMm?: readonly number[];
  /** Trecho máximo de calha entre condutores verticais (m). Padrão 10. */
  maxGutterRunM?: number;
  /** Soma contribuição de parede incidente (50% da área vertical, NBR 10844). */
  addWallContribution?: boolean;
  wallContributionHeightM?: number;
}

export const GUTTER_K = 60000;
export const DEFAULT_GUTTER_DIAMETERS_MM: readonly number[] = [100, 125, 150, 200];

/** Capacidade (L/min) de calha semicircular, Manning-Strickler como na NBR 10844. */
export function gutterCapacityLMin(diameterMm: number, slope: number, n = 0.011): number {
  const D = diameterMm / 1000;
  const S = (Math.PI * D * D) / 8;
  const R = D / 4;
  return GUTTER_K * (S / n) * Math.pow(R, 2 / 3) * Math.sqrt(slope);
}

/** Vazão de projeto Q = I·A/60 (L/min), I em mm/h e A em m². */
export const rainFlowLMin = (intensityMmH: number, areaM2: number): number => (intensityMmH * areaM2) / 60;

export interface DrainSide {
  id: string;
  label: string;
  eaveLengthM: number;
  /** Projeção horizontal da água que escoa para o lado, incluindo beiral (m²). */
  planAreaM2: number;
}

export interface GutterSideResult extends DrainSide {
  wallContributionM2: number;
  contributingAreaM2: number;
  flowLMin: number;
  leaders: number;
  /** Vazão por trecho de calha/condutor (flowLMin / leaders), usada na escolha. */
  designFlowLMin: number;
  diameterMm: number | null;
  capacityLMin: number | null;
  /** Condutores necessários para que o maior diâmetro atenda (quando nenhum atende). */
  leadersNeededForLargest: number | null;
}

export interface GutterResult {
  rainIntensityMmH: number;
  slope: number;
  manningN: number;
  safetyFactor: number;
  sides: GutterSideResult[];
  totalLeaders: number;
  totalFlowLMin: number;
  leaderNote: string;
}

export interface RoofDesign extends CalcBase {
  roofId: string;
  roofType: Roof["roofType"];
  cover: RoofCoverType;
  pitchDeg: number;
  pitchPercent: number;
  /** Altura da cumeeira acima do beiral (m). */
  riseM: number;
  ridgeLengthM: number;
  hipLengthEachM: number;
  hipLengthTotalM: number;
  /** Extensão total das bordas inclinadas (empenas/rincões de beiral lateral), informativa. */
  rakeLengthTotalM: number;
  inclinedAreaM2: number;
  planAreaM2: number;
  tiles: {
    perM2: number | null;
    lossPercent: number;
    exact: number | null;
    /** Arredondado PARA CIMA, com perda. */
    count: number | null;
    ridgeLinearM: number;
    ridgeTileCount: number | null;
  };
  pitchCheck: { ok: boolean; actualPercent: number; minPercent: number; suggestedPitchDeg: number | null; extraRiseM: number | null; message: string };
  overhangCheck: { ok: boolean; overhangM: number; message: string };
  flatSlab: { minSlopePercent: number; minRiseM: number; note: string } | null;
  drainSides: DrainSide[];
  gutters: GutterResult | null;
  framingNote: string;
}

type RoofInput = Pick<Roof, "id" | "roofType" | "width" | "depth" | "pitch" | "overhang" | "materialId">;

function inferCover(roof: RoofInput): RoofCoverTypeId {
  if (roof.roofType === "flat") return "flat-slab";
  if (roof.materialId === "roof-metal") return "metal-trapezoidal";
  if (roof.materialId === "roof-fiber-cement") return "fibrocimento";
  return "ceramic-romana";
}

/** Lados que drenam (coordenadas locais do telhado: cumeeira ao longo de X). */
export function roofDrainSides(roof: Pick<Roof, "roofType" | "width" | "depth" | "overhang">): DrainSide[] {
  const L = roof.width + 2 * roof.overhang;
  const D = roof.depth + 2 * roof.overhang;
  switch (roof.roofType) {
    case "gable":
      return [
        { id: "A", label: "Beiral A (y local −)", eaveLengthM: L, planAreaM2: (L * D) / 2 },
        { id: "B", label: "Beiral B (y local +)", eaveLengthM: L, planAreaM2: (L * D) / 2 },
      ];
    case "shed":
      return [{ id: "baixo", label: "Beiral baixo (y local −)", eaveLengthM: L, planAreaM2: L * D }];
    case "hip": {
      const a = Math.max(L, D);
      const b = Math.min(L, D);
      return [
        { id: "A", label: "Água longa A", eaveLengthM: a, planAreaM2: ((2 * a - b) * b) / 4 },
        { id: "B", label: "Água longa B", eaveLengthM: a, planAreaM2: ((2 * a - b) * b) / 4 },
        { id: "C", label: "Água de empena C", eaveLengthM: b, planAreaM2: (b * b) / 4 },
        { id: "D", label: "Água de empena D", eaveLengthM: b, planAreaM2: (b * b) / 4 },
      ];
    }
    case "flat":
      return [{ id: "perimetro", label: "Perímetro / platibanda (ralos ou calha de laje)", eaveLengthM: 2 * (L + D), planAreaM2: L * D }];
  }
}

export function designRoof(roof: RoofInput, params: RoofDesignParams = {}): RoofDesign {
  const out = baseCalc(["NBR 10844", "NBR 15575", "Catálogos de fabricantes de telhas"]);
  const A: Assumption[] = out.assumptions;
  const g = roofGeometry(roof);
  const L = roof.width + 2 * roof.overhang;
  const D = roof.depth + 2 * roof.overhang;
  const flat = roof.roofType === "flat";

  const coverId = params.coverType ?? inferCover(roof);
  const cover = roofCoverById(coverId);
  A.push(
    assume("cover", "Tipo de cobertura", cover.label, params.coverType ? "informado" : "adotado", {
      note: params.coverType ? undefined : `Inferido do tipo de telhado/material (${roof.materialId}); confirmar.`,
    }),
    assume("cover.minPitch", "Inclinação mínima da cobertura", cover.minPitchPercent, "referencia", { unit: "%", note: cover.note }),
  );
  if (cover.tilesPerM2 !== null) A.push(assume("cover.tilesPerM2", "Telhas por m²", cover.tilesPerM2, "referencia", { unit: "un/m²", note: cover.note }));

  const loss = resolveParam(A, "loss", "Perda de telhas", params.lossPercent, 10, "adotado", { unit: "%", allowZero: true });
  const ridgeTileLen = resolveParam(A, "ridgeTileLength", "Comprimento da telha de cumeeira", params.ridgeTileLengthM, 0.4, "referencia", { unit: "m", note: REF_NOTE });
  const minOverhang = resolveParam(A, "minOverhang", "Beiral mínimo recomendado", params.minOverhangM, 0.5, "adotado", { unit: "m" });
  const maxOverhang = resolveParam(A, "maxOverhang", "Beiral máximo sem verificação estrutural", params.maxOverhangM, 1.0, "adotado", { unit: "m" });

  const pitchDeg = flat ? 0 : roof.pitch;
  const pitchPercent = Math.tan((pitchDeg * Math.PI) / 180) * 100;

  // Hip/rakes.
  let hipEach = 0;
  let rakeTotal = 0;
  if (roof.roofType === "hip") {
    const a = Math.max(L, D);
    const b = Math.min(L, D);
    const r = (a - b) / 2;
    const horiz = Math.hypot(a / 2 - r, b / 2);
    hipEach = Math.hypot(horiz, g.rise);
    rakeTotal = 0;
  } else if (roof.roofType === "gable") {
    rakeTotal = 4 * Math.hypot(D / 2, g.rise);
  } else if (roof.roofType === "shed") {
    rakeTotal = 2 * Math.hypot(D, g.rise);
  }

  // Telhas.
  const ridgeLinear = g.ridge + 4 * hipEach * (roof.roofType === "hip" ? 1 : 0);
  const tilesExact = cover.tilesPerM2 === null ? null : g.area * cover.tilesPerM2 * (1 + loss / 100);
  const ridgeTileCount = cover.tilesPerM2 === null || ridgeLinear === 0 ? (cover.tilesPerM2 === null ? null : 0) : Math.ceil(ridgeLinear / ridgeTileLen - 1e-9);

  // Inclinação mínima.
  const run = roof.roofType === "gable" ? D / 2 : roof.roofType === "shed" ? D : roof.roofType === "hip" ? Math.min(L, D) / 2 : 0;
  let pitchCheck: RoofDesign["pitchCheck"];
  let flatSlab: RoofDesign["flatSlab"] = null;
  if (flat) {
    const flow = Math.min(L, D) / 2;
    flatSlab = {
      minSlopePercent: FLAT_SLAB_MIN_SLOPE_PERCENT,
      minRiseM: (FLAT_SLAB_MIN_SLOPE_PERCENT / 100) * flow,
      note: `Laje plana: prever caimento mínimo de ${FLAT_SLAB_MIN_SLOPE_PERCENT}% para ralos/calha (≈ ${((FLAT_SLAB_MIN_SLOPE_PERCENT / 100) * flow * 100).toFixed(1)} cm de desnível no maior percurso de ${flow.toFixed(2)} m até o perímetro), impermeabilização e proteção mecânica.`,
    };
    A.push(assume("flat.minSlope", "Caimento mínimo de laje impermeabilizada", FLAT_SLAB_MIN_SLOPE_PERCENT, "referencia", { unit: "%", note: REF_NOTE }));
    pitchCheck = { ok: cover.id === "flat-slab", actualPercent: 0, minPercent: FLAT_SLAB_MIN_SLOPE_PERCENT, suggestedPitchDeg: null, extraRiseM: null, message: "Telhado plano: inclinação do modelo ignorada; ver caimento mínimo da laje." };
    if (cover.id !== "flat-slab") out.warnings.push(`Cobertura "${cover.label}" não combina com telhado plano; use laje impermeabilizada ou altere o tipo de telhado.`);
  } else {
    const minP = cover.minPitchPercent;
    const ok = pitchPercent + 1e-9 >= minP;
    const sugDeg = radToDeg(Math.atan(minP / 100));
    const extra = ok ? 0 : (minP / 100 - pitchPercent / 100) * run;
    pitchCheck = {
      ok,
      actualPercent: pitchPercent,
      minPercent: minP,
      suggestedPitchDeg: ok ? null : sugDeg,
      extraRiseM: ok ? null : extra,
      message: ok
        ? `Inclinação de ${pitchPercent.toFixed(1)}% atende ao mínimo de referência (${minP}%).`
        : `Inclinação de ${pitchPercent.toFixed(1)}% abaixo do mínimo de referência (${minP}%) para ${cover.label}. Sugerido ≥ ${sugDeg.toFixed(1)}° (${minP}%), +${extra.toFixed(2)} m de altura na cumeeira.`,
    };
    if (!ok) out.warnings.push(pitchCheck.message + " Conferir com o fabricante.");
    if (cover.id === "flat-slab") out.warnings.push("Cobertura 'laje' em telhado inclinado: conferir solução (laje inclinada?).");
  }

  // Beiral.
  let overhangCheck: RoofDesign["overhangCheck"];
  if (flat) overhangCheck = { ok: true, overhangM: roof.overhang, message: "Laje plana: beiral/pingadeira e platibanda a definir em projeto." };
  else if (roof.overhang < minOverhang) overhangCheck = { ok: false, overhangM: roof.overhang, message: `Beiral de ${roof.overhang.toFixed(2)} m abaixo do mínimo adotado (${minOverhang} m): pouca proteção das fachadas.` };
  else if (roof.overhang > maxOverhang) overhangCheck = { ok: false, overhangM: roof.overhang, message: `Beiral de ${roof.overhang.toFixed(2)} m acima de ${maxOverhang} m: exige verificação estrutural do balanço.` };
  else overhangCheck = { ok: true, overhangM: roof.overhang, message: "Beiral dentro da faixa adotada." };
  if (!overhangCheck.ok) out.warnings.push(overhangCheck.message);

  const framingNote =
    "A estrutura do telhado (madeiramento/estrutura metálica, terças, caibros, ripas, contraventamento) NÃO é dimensionada aqui: depende de vão, carga de vento e do fabricante da telha — projeto específico por profissional habilitado.";
  out.warnings.push(framingNote);

  const drainSides = roofDrainSides(roof);
  const gutters = designGutters(roof, drainSides, params, out);

  return {
    ...out,
    roofId: roof.id,
    roofType: roof.roofType,
    cover,
    pitchDeg,
    pitchPercent,
    riseM: g.rise,
    ridgeLengthM: g.ridge,
    hipLengthEachM: hipEach,
    hipLengthTotalM: 4 * hipEach,
    rakeLengthTotalM: rakeTotal,
    inclinedAreaM2: g.area,
    planAreaM2: g.footprint,
    tiles: {
      perM2: cover.tilesPerM2,
      lossPercent: loss,
      exact: tilesExact,
      count: tilesExact === null ? null : Math.ceil(tilesExact - 1e-9),
      ridgeLinearM: ridgeLinear,
      ridgeTileCount,
    },
    pitchCheck,
    overhangCheck,
    flatSlab,
    drainSides,
    gutters,
    framingNote,
  };
}

function designGutters(
  roof: Pick<Roof, "roofType">,
  sides: DrainSide[],
  params: RoofDesignParams,
  out: CalcBase,
): GutterResult | null {
  const A = out.assumptions;
  if (params.rainIntensityMmH === undefined) {
    out.missingInputs.push("Intensidade pluviométrica de projeto (mm/h) — consultar dados pluviométricos locais / norma (NBR 10844: chuva intensa para a localidade, período de retorno e duração de 5 min).");
    return null;
  }
  const I = resolveParam(A, "rain", "Intensidade de chuva de projeto", params.rainIntensityMmH, NaN, "adotado", { unit: "mm/h" });
  const slope = resolveParam(A, "gutter.slope", "Declividade da calha", params.gutterSlope, 0.005, "referencia", { unit: "m/m", note: "mínimo usual 0,5% (NBR 10844 — conferir)" });
  const n = resolveParam(A, "gutter.n", "Coeficiente de Manning da calha", params.manningN, 0.011, "referencia", { note: "PVC/metal liso — conferir" });
  const sf = resolveParam(A, "gutter.safety", "Fator de segurança da vazão", params.gutterSafetyFactor, 1.0, "adotado", { note: "1,0 = sem folga; aumente para margem (obstrução)" });
  const maxRun = resolveParam(A, "gutter.maxRun", "Trecho máximo de calha entre condutores", params.maxGutterRunM, 10, "adotado", { unit: "m" });
  const diameters = [...(params.gutterDiametersMm ?? DEFAULT_GUTTER_DIAMETERS_MM)].sort((a, b) => a - b);
  A.push(assume("gutter.diameters", "Diâmetros de calha semicircular", diameters.join(", "), params.gutterDiametersMm ? "informado" : "referencia", { unit: "mm" }));
  A.push(assume("gutter.K", "Constante K (Manning, L/min)", GUTTER_K, "referencia", { note: "Q = K·(S/n)·R_H^(2/3)·i^(1/2), S em m², R_H em m" }));

  let wallH = 0;
  if (params.addWallContribution) {
    if (params.wallContributionHeightM === undefined) {
      out.missingInputs.push("Altura da parede que intercepta chuva (m) — medir no projeto de arquitetura (necessária com addWallContribution).");
    } else wallH = resolveParam(A, "wallContribution.height", "Altura da parede incidente", params.wallContributionHeightM, NaN, "adotado", { unit: "m" });
  } else {
    A.push(assume("wallContribution", "Contribuição de chuva incidente em paredes", "ignorada", "adotado", { note: "Ative addWallContribution para somar 50% da área vertical." }));
  }

  const res: GutterSideResult[] = sides.map((s) => {
    const wallArea = params.addWallContribution ? 0.5 * s.eaveLengthM * wallH : 0;
    const area = s.planAreaM2 + wallArea;
    const Q = rainFlowLMin(I, area);
    const leaders = Math.max(1, Math.ceil(s.eaveLengthM / maxRun - 1e-9));
    const Qd = Q / leaders;
    const need = Qd * sf;
    const d = diameters.find((dd) => gutterCapacityLMin(dd, slope, n) >= need) ?? null;
    const biggest = diameters[diameters.length - 1]!;
    const biggestCap = gutterCapacityLMin(biggest, slope, n);
    return {
      ...s,
      wallContributionM2: wallArea,
      contributingAreaM2: area,
      flowLMin: Q,
      leaders,
      designFlowLMin: Qd,
      diameterMm: d,
      capacityLMin: d === null ? null : gutterCapacityLMin(d, slope, n),
      leadersNeededForLargest: d === null ? Math.ceil((Q * sf) / biggestCap - 1e-9) : null,
    };
  });
  for (const s of res) {
    if (s.diameterMm === null) out.warnings.push(`Lado "${s.label}": vazão ${s.designFlowLMin.toFixed(0)} L/min excede a calha de Ø${diameters[diameters.length - 1]} mm; use ao menos ${s.leadersNeededForLargest} condutores, calha maior/retangular ou redimensione conforme norma.`);
  }
  const roofKind = roof.roofType === "flat" ? " Laje plana: vazão tratada no perímetro; ralos/calhas de laje devem ser definidos em projeto." : "";
  out.warnings.push(
    "Diâmetro do condutor vertical NÃO dimensionado (depende dos ábacos da norma: vazão, altura de lâmina e comprimento). Apenas a quantidade de condutores é estimada." + roofKind,
    "Vazão por lado dividida pelo nº de condutores para escolher a calha (cada trecho drena ao seu condutor); contribuição de chuva incidente em paredes " + (params.addWallContribution ? "somada (50% da área vertical)." : "ignorada."),
  );
  return {
    rainIntensityMmH: I,
    slope,
    manningN: n,
    safetyFactor: sf,
    sides: res,
    totalLeaders: res.reduce((s, r) => s + r.leaders, 0),
    totalFlowLMin: res.reduce((s, r) => s + r.flowLMin, 0),
    leaderNote: "Dimensionar condutor vertical conforme norma (NBR 10844).",
  };
}
