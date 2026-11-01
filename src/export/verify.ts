import DxfParser from "dxf-parser";

/**
 * Verificação de integridade de um DXF gerado, em duas camadas INDEPENDENTES:
 *  1. `structuralCheck`: validador próprio linha a linha (pares código/valor,
 *     ordem das seções, camadas declaradas, POLYLINE/VERTEX/SEQEND, formato
 *     numérico, handles, EOF final).
 *  2. `verifyDxf`: além do 1, lê o texto com o pacote `dxf-parser` (terceiros),
 *     confere camadas, contagem de entidades, coordenadas finitas, contenção na
 *     moldura da folha e coerência de $EXTMIN/$EXTMAX.
 * NÃO substitui abrir o arquivo no AutoCAD/BricsCAD/LibreCAD.
 */

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface VerifyReport {
  ok: boolean;
  errors: string[];
  layers: string[];
  counts: Record<string, number>;
  entityTotal: number;
  /** Folha (maior retângulo fechado da camada CARIMBO) e moldura interna (o segundo maior). */
  paper: Box | null;
  frame: Box | null;
  /** Caixa de todas as entidades (texto = ponto de inserção). */
  entityBox: Box | null;
  headerBox: Box | null;
}

const ENTITY_TYPES = new Set(["LINE", "POLYLINE", "VERTEX", "SEQEND", "CIRCLE", "ARC", "TEXT", "SOLID"]);
const FLOAT_CODE = (c: number) => (c >= 10 && c <= 59) || (c >= 140 && c <= 149);
const SECTIONS = ["HEADER", "TABLES", "BLOCKS", "ENTITIES"];

interface Pair {
  code: number;
  value: string;
  line: number;
}

export function readPairs(dxf: string, errors: string[]): Pair[] {
  const pairs: Pair[] = [];
  const lines = dxf.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  if (lines.length % 2 !== 0) errors.push("Numero impar de linhas: pares codigo/valor incompletos.");
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const c = lines[i]!;
    if (!/^\s*\d{1,4}$/.test(c)) {
      errors.push(`Linha ${i + 1}: codigo de grupo invalido "${c}".`);
      continue;
    }
    pairs.push({ code: Number(c), value: lines[i + 1]!, line: i + 2 });
  }
  return pairs;
}

/** Validador estrutural próprio. Devolve a lista de erros (vazia = ok). */
export function structuralCheck(dxf: string): string[] {
  const errors: string[] = [];
  // Somente ASCII imprimível + LF.
  // eslint-disable-next-line no-control-regex
  if (/[^\x20-\x7e\n]/.test(dxf)) errors.push("Bytes fora de ASCII imprimivel (ou CR/TAB) encontrados.");
  const pairs = readPairs(dxf, errors);
  if (pairs.length < 4) return [...errors, "Arquivo curto demais."];

  const last = pairs[pairs.length - 1]!;
  const prev = pairs[pairs.length - 2]!;
  if (last.code !== 0 || last.value !== "EOF") errors.push("O arquivo nao termina em 0/EOF.");
  if (prev.code !== 0 || prev.value !== "ENDSEC") errors.push("EOF nao vem logo apos ENDSEC.");
  if (!dxf.endsWith("0\nEOF\n")) errors.push('O texto nao termina em "0\\nEOF\\n".');
  if (pairs.filter((p) => p.code === 0 && p.value === "EOF").length !== 1) errors.push("EOF ausente ou repetido.");

  // Seções em ordem.
  const found: string[] = [];
  let i = 0;
  const layers = new Set<string>();
  const ltypes = new Set<string>();
  let layerCountDeclared = -1;
  let layerRecords = 0;
  const headerVars = new Map<string, Pair[]>();
  const handles = new Set<string>();
  while (i < pairs.length) {
    const p = pairs[i]!;
    if (p.code === 0 && p.value === "EOF") break;
    if (!(p.code === 0 && p.value === "SECTION")) {
      errors.push(`Linha ${p.line}: esperado 0/SECTION, encontrado ${p.code}/${p.value}.`);
      break;
    }
    const nm = pairs[i + 1];
    if (!nm || nm.code !== 2) {
      errors.push(`Linha ${p.line}: SECTION sem nome (2).`);
      break;
    }
    found.push(nm.value);
    let j = i + 2;
    const start = j;
    while (j < pairs.length && !(pairs[j]!.code === 0 && pairs[j]!.value === "ENDSEC")) j++;
    if (j >= pairs.length) {
      errors.push(`Secao ${nm.value} sem ENDSEC.`);
      break;
    }
    const body = pairs.slice(start, j);

    if (nm.value === "HEADER") {
      let cur: string | null = null;
      for (const b of body) {
        if (b.code === 9) {
          cur = b.value;
          headerVars.set(cur, []);
        } else if (cur) headerVars.get(cur)!.push(b);
        else errors.push(`Linha ${b.line}: grupo ${b.code} antes de qualquer variavel de cabecalho.`);
      }
    } else if (nm.value === "TABLES") {
      let table = "";
      for (const b of body) {
        if (b.code === 0 && b.value === "TABLE") table = "?";
        else if (b.code === 2 && table === "?") table = b.value;
        else if (b.code === 0 && b.value === "ENDTAB") table = "";
        else if (b.code === 70 && (table === "LAYER") && layerCountDeclared < 0) layerCountDeclared = Number(b.value);
        else if (b.code === 0 && b.value === "LAYER") layerRecords++;
        else if (b.code === 2 && table === "LAYER") layers.add(b.value);
        else if (b.code === 2 && table === "LTYPE") ltypes.add(b.value);
      }
      if (layerCountDeclared !== layerRecords) errors.push(`Tabela LAYER declara ${layerCountDeclared} registros, mas tem ${layerRecords}.`);
      if (!layers.has("0")) errors.push('Camada "0" ausente.');
      for (const need of ["CONTINUOUS", "DASHED", "CENTER"]) if (!ltypes.has(need)) errors.push(`Tipo de linha ${need} ausente.`);
    } else if (nm.value === "ENTITIES") {
      // Cada entidade: 0/TIPO ... ; POLYLINE precisa de VERTEX* e SEQEND.
      let inPoly = false;
      let vertexCount = 0;
      let k = 0;
      while (k < body.length) {
        const e = body[k]!;
        if (e.code !== 0) {
          errors.push(`Linha ${e.line}: grupo ${e.code} fora de entidade.`);
          k++;
          continue;
        }
        const type = e.value;
        if (!ENTITY_TYPES.has(type)) errors.push(`Linha ${e.line}: entidade nao suportada em R12: ${type}.`);
        let m = k + 1;
        let layer: string | null = null;
        const seen = new Set<number>();
        while (m < body.length && body[m]!.code !== 0) {
          const g = body[m]!;
          seen.add(g.code);
          if (g.code === 8) layer = g.value;
          if (g.code === 6 && !ltypes.has(g.value)) errors.push(`Linha ${g.line}: tipo de linha inexistente ${g.value}.`);
          if (g.code === 5) {
            if (handles.has(g.value)) errors.push(`Linha ${g.line}: handle duplicado ${g.value}.`);
            handles.add(g.value);
          }
          if (FLOAT_CODE(g.code) && !/^-?\d+\.\d{6}$/.test(g.value)) errors.push(`Linha ${g.line}: numero fora do formato fixo de 6 casas: "${g.value}".`);
          if (m - k > 60 && type !== "POLYLINE") break;
          m++;
        }
        if (layer === null) errors.push(`Linha ${e.line}: entidade ${type} sem camada (8).`);
        else if (!layers.has(layer)) errors.push(`Linha ${e.line}: camada "${layer}" nao declarada na tabela LAYER.`);
        const need: Record<string, number[]> = { LINE: [10, 20, 11, 21], CIRCLE: [10, 20, 40], ARC: [10, 20, 40, 50, 51], TEXT: [10, 20, 40, 1], SOLID: [10, 20, 11, 21, 12, 22, 13, 23], VERTEX: [10, 20] };
        for (const c of need[type] ?? []) if (!seen.has(c)) errors.push(`Linha ${e.line}: ${type} sem o grupo ${c}.`);
        if (type === "TEXT" && (seen.has(72) || seen.has(73)) && (!seen.has(11) || !seen.has(21))) errors.push(`Linha ${e.line}: TEXT justificado sem 2o ponto de alinhamento (11/21).`);
        if (type === "POLYLINE") {
          if (inPoly) errors.push(`Linha ${e.line}: POLYLINE dentro de POLYLINE.`);
          inPoly = true;
          vertexCount = 0;
          if (!seen.has(66)) errors.push(`Linha ${e.line}: POLYLINE sem 66 (vertices seguem).`);
        } else if (type === "VERTEX") {
          if (!inPoly) errors.push(`Linha ${e.line}: VERTEX fora de POLYLINE.`);
          vertexCount++;
        } else if (type === "SEQEND") {
          if (!inPoly) errors.push(`Linha ${e.line}: SEQEND sem POLYLINE.`);
          else if (vertexCount < 2) errors.push(`Linha ${e.line}: POLYLINE com menos de 2 vertices.`);
          inPoly = false;
        } else if (inPoly) errors.push(`Linha ${e.line}: ${type} dentro de POLYLINE (faltou SEQEND).`);
        k = m;
      }
      if (inPoly) errors.push("POLYLINE sem SEQEND no fim da secao.");
    }
    i = j + 1;
  }
  if (found.join(",") !== SECTIONS.join(",")) errors.push(`Ordem de secoes inesperada: ${found.join(",")} (esperado ${SECTIONS.join(",")}).`);
  for (const v of ["$ACADVER", "$EXTMIN", "$EXTMAX"]) if (!headerVars.has(v)) errors.push(`Variavel de cabecalho ${v} ausente.`);
  const ver = headerVars.get("$ACADVER")?.[0]?.value;
  if (ver !== "AC1009") errors.push(`$ACADVER inesperado: ${ver}.`);
  return errors;
}

type P3 = { x: number; y: number; z?: number };
const finite = (p: P3 | undefined): boolean => !!p && Number.isFinite(p.x) && Number.isFinite(p.y) && (p.z === undefined || Number.isFinite(p.z));

function boxOf(pts: P3[]): Box | null {
  if (pts.length === 0) return null;
  return { minX: Math.min(...pts.map((p) => p.x)), minY: Math.min(...pts.map((p) => p.y)), maxX: Math.max(...pts.map((p) => p.x)), maxY: Math.max(...pts.map((p) => p.y)) };
}

const contains = (outer: Box, inner: Box, tol: number): boolean =>
  inner.minX >= outer.minX - tol && inner.maxX <= outer.maxX + tol && inner.minY >= outer.minY - tol && inner.maxY <= outer.maxY + tol;

/** Pontos relevantes de uma entidade lida pelo dxf-parser. */
function entityPoints(e: Record<string, any>, errors: string[]): P3[] {
  const pts: P3[] = [];
  const chk = (label: string, p: P3 | undefined) => {
    if (!finite(p)) errors.push(`${e.type}: coordenada nao finita em ${label}.`);
    else pts.push(p!);
  };
  switch (e.type) {
    case "LINE":
      (e.vertices ?? []).forEach((v: P3, i: number) => chk(`vertice ${i}`, v));
      break;
    case "POLYLINE":
      (e.vertices ?? []).forEach((v: P3, i: number) => chk(`vertice ${i}`, v));
      break;
    case "CIRCLE":
      chk("centro", e.center);
      if (!Number.isFinite(e.radius) || e.radius <= 0) errors.push("CIRCLE: raio invalido.");
      else if (finite(e.center)) pts.push({ x: e.center.x - e.radius, y: e.center.y - e.radius }, { x: e.center.x + e.radius, y: e.center.y + e.radius });
      break;
    case "ARC": {
      chk("centro", e.center);
      if (!Number.isFinite(e.radius) || e.radius <= 0) errors.push("ARC: raio invalido.");
      else if (finite(e.center)) {
        const s = e.startAngle as number;
        let sweep = (e.endAngle as number) - s;
        while (sweep <= 0) sweep += Math.PI * 2;
        const at = (a: number) => pts.push({ x: e.center.x + e.radius * Math.cos(a), y: e.center.y + e.radius * Math.sin(a) });
        at(s);
        at(s + sweep);
        for (let c = 0; c < 4; c++) {
          let d = (c * Math.PI) / 2 - s;
          while (d < 0) d += Math.PI * 2;
          if (d <= sweep) at(s + d);
        }
      }
      break;
    }
    case "TEXT":
      chk("insercao", e.startPoint);
      if (!Number.isFinite(e.textHeight) || e.textHeight <= 0) errors.push("TEXT: altura invalida.");
      break;
    case "SOLID":
      (e.points ?? []).forEach((v: P3, i: number) => chk(`ponto ${i}`, v));
      break;
    default:
      break;
  }
  return pts;
}

export function verifyDxf(dxf: string): VerifyReport {
  const errors = structuralCheck(dxf);
  const report: VerifyReport = { ok: false, errors, layers: [], counts: {}, entityTotal: 0, paper: null, frame: null, entityBox: null, headerBox: null };
  let parsed: ReturnType<DxfParser["parseSync"]>;
  try {
    parsed = new DxfParser().parseSync(dxf);
  } catch (err) {
    errors.push(`dxf-parser lancou excecao: ${(err as Error).message}`);
    return report;
  }
  if (!parsed) {
    errors.push("dxf-parser nao devolveu documento.");
    return report;
  }
  const layerTable = (parsed.tables as any)?.layer?.layers ?? {};
  report.layers = Object.keys(layerTable);
  const ents = parsed.entities as unknown as Array<Record<string, any>>;
  report.entityTotal = ents.length;
  if (ents.length === 0) errors.push("Nenhuma entidade lida pelo dxf-parser.");
  for (const e of ents) {
    report.counts[e.type] = (report.counts[e.type] ?? 0) + 1;
    if (!report.layers.includes(e.layer)) errors.push(`Entidade ${e.type} em camada ausente da tabela: ${e.layer}.`);
  }

  // Molduras: retângulos fechados na camada CARIMBO, por área.
  const rects = ents
    .filter((e) => e.type === "POLYLINE" && e.layer === "CARIMBO" && e.shape === true && (e.vertices?.length ?? 0) === 4)
    .map((e) => boxOf(e.vertices as P3[])!)
    .sort((a, b) => (b.maxX - b.minX) * (b.maxY - b.minY) - (a.maxX - a.minX) * (a.maxY - a.minY));
  report.paper = rects[0] ?? null;
  report.frame = rects[1] ?? null;
  if (!report.paper || !report.frame) errors.push("Moldura da folha (2 retangulos fechados em CARIMBO) nao encontrada.");

  const all: P3[] = [];
  for (const e of ents) {
    const pts = entityPoints(e, errors);
    const isBorder = e.type === "POLYLINE" && e.layer === "CARIMBO" && (e.vertices?.length ?? 0) === 4 && [report.paper, report.frame].some((b) => b && sameBox(boxOf(e.vertices as P3[])!, b));
    if (report.paper && !isBorder) {
      const b = boxOf(pts);
      if (b && !contains(report.paper, b, 1e-5)) errors.push(`Entidade ${e.type} (${e.layer}) fora da folha.`);
      if (b && report.frame && !contains(report.frame, b, 1e-5)) errors.push(`Entidade ${e.type} (${e.layer}) fora da moldura interna: [${b.minX.toFixed(3)}, ${b.minY.toFixed(3)}]-[${b.maxX.toFixed(3)}, ${b.maxY.toFixed(3)}].`);
    }
    all.push(...pts);
  }
  report.entityBox = boxOf(all);

  const hmin = (parsed.header as any)?.$EXTMIN as P3 | undefined;
  const hmax = (parsed.header as any)?.$EXTMAX as P3 | undefined;
  if (!finite(hmin) || !finite(hmax)) errors.push("$EXTMIN/$EXTMAX ausentes ou nao finitos.");
  else {
    report.headerBox = { minX: hmin!.x, minY: hmin!.y, maxX: hmax!.x, maxY: hmax!.y };
    if (report.entityBox && !contains(report.headerBox, report.entityBox, 1e-5)) errors.push("$EXTMIN/$EXTMAX nao contem todas as entidades.");
    if (report.paper && !sameBox(report.headerBox, report.paper, 1e-4)) errors.push("$EXTMIN/$EXTMAX diferem da folha (moldura externa).");
  }
  report.ok = errors.length === 0;
  return report;
}

function sameBox(a: Box, b: Box, tol = 1e-6): boolean {
  return Math.abs(a.minX - b.minX) < tol && Math.abs(a.minY - b.minY) < tol && Math.abs(a.maxX - b.maxX) < tol && Math.abs(a.maxY - b.maxY) < tol;
}
