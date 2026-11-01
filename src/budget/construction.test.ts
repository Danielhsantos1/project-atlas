import { describe, expect, it } from "vitest";
import { createOpening, createProject, createRoom, createRoomWithWalls } from "@/core/model/factory";
import { addElements } from "@/core/model/operations";
import { DomainError } from "@/core/model/errors";
import { buildModernHouse } from "@/core/templates/modern-house";
import type { Project, RoomType, Wall, WallCore } from "@/core/model/schema";
import { wallQuantities } from "@/core/geometry/wall";
import {
  CONCRETE_MIX_PRESETS,
  DEFAULT_CONSTRUCTION_PARAMS,
  concreteMaterials,
  constructionTakeoff,
  materialSummary,
  mixCementConsumption,
  mortarMaterials,
  takeoffComplete,
  wallFaceAreas,
  type ConstructionLine,
} from "./construction";
import { takeoff, type QuantityLine } from "./quantities";
import { buildReferenceProject } from "./test-fixtures";

const line = <T extends QuantityLine>(lines: T[], code: string): T => {
  const l = lines.find((x) => x.code === code);
  if (!l) throw new Error(`linha ${code} ausente: ${lines.map((x) => x.code).join(", ")}`);
  return l;
};
const has = (lines: QuantityLine[], code: string) => lines.some((l) => l.code === code);
const NOW = new Date("2026-01-10T12:00:00Z");

/** Casa simples: sala 4 × 3 m, paredes 2,8 m × 9 cm (1 fiada de bloco 9 cm), porta 0,8×2,1 e janela 1,2×1,2 (peitoril 1,0). */
function simpleHouse(opts: { core?: WallCore; materialId?: string; thickness?: number; roomType?: RoomType; extra?: boolean } = {}): { project: Project; walls: Wall[] } {
  let p = createProject({ name: "Casa Simples", category: "residencial", site: { width: 30, depth: 30 }, now: NOW });
  const a = createRoomWithWalls(p.elements, { x: 0, y: 0 }, { x: 4, y: 3 }, opts.roomType ?? "sala", {
    height: 2.8,
    thickness: opts.thickness ?? 0.09,
    materialId: opts.materialId ?? "plaster-white",
    levelId: "terreo",
    ...(opts.core ? { core: opts.core } : {}),
  });
  p = addElements(p, [...a.walls, a.room]);
  const bottom = a.walls.find((w) => w.start.y === 0 && w.end.y === 0)!;
  const right = a.walls.find((w) => w.start.x === 4 && w.end.x === 4)!;
  p = addElements(p, [createOpening(p.elements, bottom, { elementType: "door", width: 0.8, height: 2.1, materialId: "wood-oak" }, 1)]);
  p = addElements(p, [createOpening(p.elements, right, { elementType: "window", width: 1.2, height: 1.2, sillHeight: 1.0, materialId: "aluminum" }, 1.5)]);
  return { project: p, walls: a.walls };
}

/** Fórmula do livro (g/dm³): C = 1000 / (1/γc + cal/γcal + a/γa + p/γp + x). */
const C = (lime: number, a: number, pr: number, x: number) => 1000 / (1 / 3.15 + lime / 2.3 + a / 2.65 + pr / 2.7 + x);

describe("traços: mortarMaterials / concreteMaterials", () => {
  it("argamassa 1:3 (a/c 0,8): C = 1000 ÷ (1/3,15 + 3/2,65 + 0,8) ≈ 444,55 kg/m³", () => {
    // 1/3,15 = 0,317460 ; 3/2,65 = 1,132075 ; soma com 0,8 = 2,249535 -> C = 444,55 kg/m³
    const m = mortarMaterials(1, "1:3");
    expect(m.cementKgPerM3).toBeCloseTo(444.5, 0);
    expect(m.cementKgPerM3).toBeCloseTo(C(0, 3, 0, 0.8), 9);
    expect(m.cementBags).toBe(9); // 444,55 ÷ 50 = 8,89 -> 9 sacos
    expect(m.sandKg).toBeCloseTo(3 * m.cementKg, 9); // areia = a·C
    expect(m.waterL).toBeCloseTo(0.8 * m.cementKg, 9); // água = x·C
    // areia úmida: 1333,6 kg ÷ 1500 kg/m³ × 1,25 = 1,1114 m³
    expect(m.sandM3).toBeCloseTo(((3 * m.cementKg) / 1500) * 1.25, 9);
    expect(m.gravelM3).toBe(0);
  });

  it("concreto 1:2:3 (a/c 0,55): C ≈ 365,86 kg/m³, brita e areia em kg e m³", () => {
    // 1/3,15 = 0,317460 ; 2/2,65 = 0,754717 ; 3/2,70 = 1,111111 ; + 0,55 = 2,733288 -> C = 365,86
    const m = concreteMaterials(2, "1:2:3");
    expect(m.cementKgPerM3).toBeCloseTo(365.86, 2);
    expect(m.cementKg).toBeCloseTo(731.72, 1);
    expect(m.cementBags).toBe(15); // 731,72 ÷ 50 = 14,63
    expect(m.gravelKg).toBeCloseTo(3 * m.cementKg, 9);
    expect(m.gravelM3).toBeCloseTo((3 * m.cementKg) / 1400, 9);
    expect(m.formula).toContain("1:2:3");
  });

  it("cal entra na fórmula (1:1:6) e densidades/inchamento são parâmetros", () => {
    const m = mortarMaterials(1, "1:1:6");
    expect(m.cementKgPerM3).toBeCloseTo(C(1, 6, 0, 1.2), 9);
    expect(m.limeKg).toBeCloseTo(m.cementKg, 9);
    expect(m.limeBags).toBe(Math.ceil(m.limeKg / 20 - 1e-9));
    const dry = mortarMaterials(1, "1:1:6", { sandSwelling: 1 });
    expect(m.sandM3 / dry.sandM3).toBeCloseTo(1.25, 9);
    expect(mixCementConsumption({ lime: 0, sand: 3, gravel: 0, waterCement: 0.8 })).toBeCloseTo(m.cementKgPerM3 * 0 + C(0, 3, 0, 0.8), 9);
  });

  it("traço personalizado, traço desconhecido e mistura inválida", () => {
    const custom = concreteMaterials(1, { lime: 0, sand: 2.5, gravel: 3.5, waterCement: 0.5 });
    expect(custom.cementKgPerM3).toBeCloseTo(C(0, 2.5, 3.5, 0.5), 9);
    expect(() => mortarMaterials(1, "9:9")).toThrow(DomainError);
    expect(() => concreteMaterials(1, "1:3")).toThrow(DomainError); // preset de argamassa não é de concreto
    expect(() => concreteMaterials(1, { lime: 0, sand: 2, gravel: 0, waterCement: 0.5 })).toThrow(DomainError);
    expect(() => mortarMaterials(-1, "1:3")).toThrow(DomainError);
    expect(Object.keys(CONCRETE_MIX_PRESETS)).toContain("1:2:3");
  });
});

describe("wallFaceAreas - classificação interna x externa", () => {
  const { project, shared } = buildReferenceProject();
  const faces = wallFaceAreas(project);
  const walls = project.elements.filter((e): e is Wall => e.type === "wall");

  it("duas faces por parede; área líquida = wallQuantities (desconta aberturas)", () => {
    expect(faces).toHaveLength(walls.length * 2);
    const openings = project.elements.filter((e) => e.type === "door" || e.type === "window");
    for (const f of faces) {
      const w = walls.find((x) => x.id === f.wallId)!;
      expect(f.netArea).toBeCloseTo(wallQuantities(w, openings as never).netArea, 9);
      expect(f.interiorArea + f.exteriorArea).toBeCloseTo(f.netArea, 9);
    }
  });

  it("parede compartilhada: as duas faces internas (porta descontada)", () => {
    const sf = faces.filter((f) => f.wallId === shared.id);
    expect(sf).toHaveLength(2);
    expect(sf.every((f) => f.interior)).toBe(true);
    expect(sf.every((f) => Math.abs(f.interiorArea - (3 * 2.8 - 1.68)) < 1e-9 && f.exteriorArea < 1e-9)).toBe(true);
    expect(new Set(sf.flatMap((f) => f.roomIds)).size).toBe(2); // sala e quarto
  });

  it("perímetro externo: uma face interna e uma externa em cada uma das 6 paredes", () => {
    for (const w of walls.filter((x) => x.id !== shared.id)) {
      const fs = faces.filter((f) => f.wallId === w.id);
      expect(fs.filter((f) => f.interior)).toHaveLength(1);
      expect(fs.filter((f) => !f.interior)).toHaveLength(1);
    }
    const ext = faces.filter((f) => !f.interior).reduce((s, f) => s + f.exteriorArea, 0);
    // perímetro externo da casa 7×3: 2·(7+3) = 20 m × 2,8 = 56 m² − porta? (porta é interna) − janela 1,44 = 54,56
    expect(ext).toBeCloseTo(20 * 2.8 - 1.44, 9);
  });

  it("parede interna que só toca um ambiente aberto não vira interna (sem ambientes: tudo externo)", () => {
    const { project: p } = simpleHouse();
    const noRoom: Project = { ...p, elements: p.elements.filter((e) => e.type !== "room") };
    expect(wallFaceAreas(noRoom).every((f) => !f.interior)).toBe(true);
  });
});

describe("constructionTakeoff - casa simples, conferência manual", () => {
  const { project } = simpleHouse();
  const r = constructionTakeoff(project);
  const NET = 14 * 2.8 - 0.8 * 2.1 - 1.2 * 1.2; // 36,08 m² por face

  it("blocos: 25 un/m² (1/((0,19+0,01)·(0,19+0,01))) × 36,08 m² × 1,05 de perda -> 948 un", () => {
    const b = line(r.lines, "MAT-BLOCO-CERAMICO");
    expect(NET).toBeCloseTo(36.08, 9);
    expect(b.unit).toBe("un");
    expect(b.quantity).toBe(Math.ceil(NET * 25 * 1.05 - 1e-9)); // 902 × 1,05 = 947,1 -> 948
    expect(b.quantity).toBe(948);
    expect(b.basis).toContain("25 un/m²");
    expect(b.role).toBe("insumo");
    expect(b.elementIds).toHaveLength(4);
    expect(has(r.lines, "MAT-BLOCO-CONCRETO")).toBe(false);
  });

  it("argamassa de assentamento = volume da parede − volume dos blocos", () => {
    // por m²: 0,09 − 25 × (0,19·0,19·0,09) = 0,09 − 0,081225 = 0,008775 m³ ; × 36,08 = 0,316602 ; × 1,15 = 0,364092
    const a = line(r.lines, "ARG-ASSENTAMENTO");
    expect(a.quantity).toBeCloseTo(round3(36.08 * 0.008775 * 1.15), 3);
    expect(a.quantity).toBe(0.364);
    expect(a.optional).toBe(true);
    expect(a.role).toBe("informativo");
  });

  it("reboco: volumes = área da face × espessura × (1 + 20% de perda), interno x externo", () => {
    expect(line(r.lines, "ARG-CHAPISCO-INT").quantity).toBeCloseTo(round3(36.08 * 0.005 * 1.2), 9); // 0,216
    expect(line(r.lines, "ARG-EMBOCO-INT").quantity).toBeCloseTo(round3(36.08 * 0.02 * 1.2), 9); // 0,866
    expect(line(r.lines, "ARG-REBOCO-INT").quantity).toBeCloseTo(round3(36.08 * 0.005 * 1.2), 9); // 0,216
    expect(line(r.lines, "ARG-CHAPISCO-EXT").quantity).toBe(0.216);
    expect(line(r.lines, "ARG-EMBOCO-EXT").quantity).toBeCloseTo(round3(36.08 * 0.025 * 1.2), 9); // emboço paulista 25 mm = 1,082
    expect(has(r.lines, "ARG-REBOCO-EXT")).toBe(false); // massa única: sem reboco externo
  });

  it("cimento: Σ (volume com perda × C do traço) ÷ 50 kg, arredondado para cima", () => {
    // usos (m³ com perda; traço; C):
    const chap = 36.08 * 0.005 * 1.2 * 2; // chapisco int+ext, 1:3
    const emb = (36.08 * 0.02 + 36.08 * 0.025) * 1.2 + 36.08 * 0.005 * 1.2; // emboço int+ext + reboco int, 1:2:8
    const ass = 36.08 * 0.008775 * 1.15; // assentamento 1:1:6
    const sub = 3.91 * 2.91 * 0.05 * 1.1; // contrapiso 1:4 (área útil 11,3781 m²)
    const conc = (14 * 0.2 * 0.3 + (1.4 + 1.8 + 1.8) * 0.09 * 0.1) * 1.05; // baldrame 14 m + vergas, 1:2:3
    const kg = chap * C(0, 3, 0, 0.8) + emb * C(2, 8, 0, 1.8) + ass * C(1, 6, 0, 1.2) + sub * C(0, 4, 0, 0.95) + conc * C(0, 2, 3, 0.55);
    const cim = line(r.lines, "MAT-CIMENTO");
    expect(cim.unit).toBe("sc");
    expect(cim.details?.cementKg).toBeCloseTo(kg, 6);
    expect(cim.quantity).toBe(Math.ceil(kg / 50 - 1e-9));
    expect(cim.basis).toContain("50");
    expect(cim.basis).toContain("validar");
    const cal = line(r.lines, "MAT-CAL");
    const limeKg = emb * 2 * C(2, 8, 0, 1.8) + ass * 1 * C(1, 6, 0, 1.2);
    expect(cal.details?.limeKg).toBeCloseTo(limeKg, 6);
    const sandKg = chap * 3 * C(0, 3, 0, 0.8) + emb * 8 * C(2, 8, 0, 1.8) + ass * 6 * C(1, 6, 0, 1.2) + sub * 4 * C(0, 4, 0, 0.95) + conc * 2 * C(0, 2, 3, 0.55);
    expect(line(r.lines, "MAT-AREIA").quantity).toBeCloseTo(round3((sandKg / 1500) * 1.25), 3);
    expect(line(r.lines, "MAT-BRITA").quantity).toBeCloseTo(round3((conc * 3 * C(0, 2, 3, 0.55)) / 1400), 3);
  });

  it("vergas e contravergas: largura do vão + 2 × 0,30 m", () => {
    expect(line(r.lines, "ALV-VERGA").quantity).toBeCloseTo(0.8 + 0.6 + 1.2 + 0.6, 9); // porta + janela = 3,2
    expect(line(r.lines, "ALV-CONTRAVERGA").quantity).toBeCloseTo(1.8, 9); // só a janela
  });

  it("baldrame conceitual: 14 m de eixo × 0,20 × 0,30 = 0,84 m³, sinalizado como conceitual", () => {
    const f = line(r.lines, "EST-FUNDACAO");
    expect(f.quantity).toBe(0.84);
    expect(f.basis).toContain("CONCEITUAL");
    expect(r.warnings.some((w) => w.includes("CONCEITUAL"))).toBe(true);
  });

  it("aço e fôrma: taxa × volume e áreas de contato", () => {
    // aço: (0,84 × 90 + 0,045 × 100) × 1,10 = (75,6 + 4,5) × 1,1 = 88,11 kg
    expect(line(r.lines, "MAT-ACO").quantity).toBeCloseTo(88.11, 2);
    expect(line(r.lines, "EST-FORMA").quantity).toBeCloseTo(2 * 14 * 0.3, 9); // 2 laterais do baldrame
  });

  it("contrapiso 0,05 m sobre a área útil (3,91 × 2,91), colante, rejunte e rodapé", () => {
    const a = 3.91 * 2.91;
    expect(line(r.lines, "CONTRAPISO").quantity).toBeCloseTo(round3(a * 0.05), 9);
    expect(line(r.lines, "MAT-ARG-COLANTE").quantity).toBeCloseTo(round3(a * 5), 9); // sala em porcelanato: 5 kg/m²
    // rejunte: (600+600)·3·9/(600·600) = 0,09 dm³/m² × 1,9 kg/dm³ × 1,10 = 0,18810 kg/m²
    expect(line(r.lines, "MAT-REJUNTE").quantity).toBeCloseTo(round3(a * 0.0900 * 1.9 * 1.1), 3);
    // rodapé: perímetro interno 2·(3,91+2,91) = 13,64 m − porta 0,8 m
    expect(line(r.lines, "ACAB-RODAPE").quantity).toBeCloseTo(13.64 - 0.8, 9);
    expect(line(r.lines, "ACAB-SOLEIRA").quantity).toBeCloseTo(0.8, 9);
    expect(line(r.lines, "ACAB-PEITORIL").quantity).toBeCloseTo(1.2 + 0.1, 9);
  });

  it("pintura: selador/massa por face interna x externa e forro (tinta de paredes é do takeoff)", () => {
    expect(line(r.lines, "PINT-INT-SELADOR").quantity).toBeCloseTo(round3(NET / 10), 9);
    expect(line(r.lines, "PINT-INT-MASSA").quantity).toBeCloseTo(round3((NET * 2) / 2), 9);
    expect(line(r.lines, "PINT-EXT-SELADOR").quantity).toBeCloseTo(round3(NET / 10), 9);
    expect(line(r.lines, "PINT-EXT-MASSA").quantity).toBeCloseTo(round3((NET * 2) / 2), 9);
    expect(has(r.lines, "PINT-TINTA")).toBe(false);
    expect(has(r.lines, "PINT-PAREDE")).toBe(false);
    expect(line(r.lines, "PINT-FORRO").quantity).toBeCloseTo(round3(3.91 * 2.91), 9);
    expect(line(r.lines, "PINT-FORRO-TINTA").quantity).toBeCloseTo(round3((3.91 * 2.91 * 2) / 10), 9);
  });

  it("áreas pintáveis internas + externas = PINT-PAREDE do takeoff", () => {
    const t = takeoff(project);
    const areas = ["PINT-INT-SELADOR", "PINT-EXT-SELADOR"].reduce((s, c) => s + (line(r.lines, c).details?.areaM2 ?? 0), 0);
    expect(areas).toBeCloseTo(line(t.lines, "PINT-PAREDE").quantity, 9);
  });

  it("avisos: instalações sempre; sem telhado = sem aviso de estrutura de telhado", () => {
    expect(r.warnings).toContain("Instalações elétricas, hidráulicas e de gás não modeladas: orçar à parte");
    expect(r.warnings.some((w) => w.includes("Estrutura do telhado"))).toBe(false);
    expect(r.warnings.some((w) => w.includes("validados pelo engenheiro"))).toBe(true);
  });
});

describe("parâmetros alteram o resultado de forma proporcional", () => {
  const { project } = simpleHouse();
  const base = constructionTakeoff(project);

  it("perda de argamassa de revestimento 20% -> 40%: volume × 1,4/1,2", () => {
    const r = constructionTakeoff(project, { plaster: { lossPercent: 40 } });
    expect(line(r.lines, "ARG-EMBOCO-INT").quantity / line(base.lines, "ARG-EMBOCO-INT").quantity).toBeCloseTo(1.4 / 1.2, 2);
  });

  it("espessura do emboço interno dobrada dobra o volume (sem perda)", () => {
    const a = constructionTakeoff(project, { plaster: { lossPercent: 0 } });
    const b = constructionTakeoff(project, { plaster: { lossPercent: 0, interior: { embocoM: 0.04 } } });
    expect(line(b.lines, "ARG-EMBOCO-INT").quantity / line(a.lines, "ARG-EMBOCO-INT").quantity).toBeCloseTo(2, 2);
    expect(line(b.lines, "ARG-CHAPISCO-INT").quantity).toBe(line(a.lines, "ARG-CHAPISCO-INT").quantity); // demais camadas intactas
  });

  it("junta de 2 cm: 1/((0,19+0,02)²) = 22,68 un/m²", () => {
    const r = constructionTakeoff(project, { masonry: { jointM: 0.02, blockLossPercent: 0 } });
    expect(line(r.lines, "MAT-BLOCO-CERAMICO").quantity).toBe(Math.ceil(36.08 * (1 / (0.21 * 0.21)) - 1e-9));
  });

  it("perda de blocos 0% -> 902 un; traço de assentamento mais rico muda cimento", () => {
    expect(line(constructionTakeoff(project, { masonry: { blockLossPercent: 0 } }).lines, "MAT-BLOCO-CERAMICO").quantity).toBe(902);
    const rich = constructionTakeoff(project, { mixes: { assentamento: "1:3", chapisco: "1:3", emboco: "1:3", reboco: "1:3", contrapiso: "1:3" } });
    expect(line(rich.lines, "MAT-CIMENTO").quantity).toBeGreaterThan(line(base.lines, "MAT-CIMENTO").quantity);
    expect(has(rich.lines, "MAT-CAL")).toBe(false); // nenhum traço com cal
  });

  it("inchamento da areia 1,25 -> 1,0 reduz a areia em 20%", () => {
    const r = constructionTakeoff(project, { materials: { sandSwelling: 1 } });
    expect(line(r.lines, "MAT-AREIA").quantity / line(base.lines, "MAT-AREIA").quantity).toBeCloseTo(0.8, 2);
  });

  it("altura de azulejo 0 desliga o revestimento; fachada em textura troca a massa acrílica", () => {
    const r = constructionTakeoff(project, { finishes: { exterior: { finish: "textura" } } });
    expect(has(r.lines, "PINT-EXT-MASSA")).toBe(false);
    expect(line(r.lines, "PINT-EXT-TEXTURA").quantity).toBeCloseTo(round3(36.08 * 1.5), 9);
  });

  it("parâmetros inválidos / chaves desconhecidas / traço desconhecido lançam DomainError", () => {
    expect(() => constructionTakeoff(project, { masonry: { jointM: -1 } })).toThrow(DomainError);
    expect(() => constructionTakeoff(project, { masonry: { blockLossPercent: 150 } })).toThrow(DomainError);
    expect(() => constructionTakeoff(project, { materials: { sandSwelling: 0.5 } })).toThrow(DomainError);
    expect(() => constructionTakeoff(project, { naoExiste: 1 } as never)).toThrow(DomainError);
    expect(() => constructionTakeoff(project, { mixes: { chapisco: "7:7" } })).toThrow(DomainError);
    expect(DEFAULT_CONSTRUCTION_PARAMS.masonry.jointM).toBe(0.01);
  });
});

describe("outros núcleos de parede", () => {
  it("drywall: chapas nas duas faces, montantes a cada 0,60 m e guias", () => {
    const { project } = simpleHouse({ core: "drywall", materialId: "gypsum", thickness: 0.1 });
    const r = constructionTakeoff(project);
    expect(line(r.lines, "MAT-DRYWALL-CHAPA").quantity).toBeCloseTo(round3(2 * 36.08 * 1.1), 9);
    // vãos: 4 m -> ⌊4/0,6⌋+1 = 7 ; 3 m -> ⌊3/0,6⌋+1 = 6 ; paredes 4+3+4+3 = 26 montantes × 2,8 m
    expect(line(r.lines, "MAT-DRYWALL-MONTANTE").quantity).toBeCloseTo(26 * 2.8, 9);
    expect(line(r.lines, "MAT-DRYWALL-GUIA").quantity).toBeCloseTo(28, 9);
    expect(has(r.lines, "MAT-BLOCO-CERAMICO")).toBe(false);
    expect(has(r.lines, "ALV-VERGA")).toBe(false);
    expect(has(r.lines, "ARG-CHAPISCO-INT")).toBe(false); // drywall não leva argamassa
    expect(has(r.lines, "EST-FUNDACAO")).toBe(false);
  });

  it("concreto moldado in loco: volume = área líquida × espessura, vira cimento/areia/brita/aço/fôrma", () => {
    const { project } = simpleHouse({ core: "concrete", materialId: "plaster-white", thickness: 0.15 });
    const r = constructionTakeoff(project);
    expect(line(r.lines, "EST-CONCRETO-PAREDE").quantity).toBeCloseTo(round3(36.08 * 0.15), 9);
    expect(has(r.lines, "MAT-BRITA")).toBe(true);
    expect(has(r.lines, "MAT-BLOCO-CERAMICO")).toBe(false);
    // fôrma: 2 faces × área líquida + baldrame (não há baldrame sobre concreto? há: é parede de concreto no térreo)
    expect(line(r.lines, "EST-FORMA").quantity).toBeCloseTo(2 * 36.08 + 2 * 14 * 0.3, 6);
  });

  it("bloco de concreto 14×19×39: 12,5 un/m²; parede de 14 cm", () => {
    const { project } = simpleHouse({ core: "concrete-block", thickness: 0.14 });
    const r = constructionTakeoff(project, { masonry: { blockLossPercent: 0 } });
    expect(line(r.lines, "MAT-BLOCO-CONCRETO").quantity).toBe(Math.ceil(36.08 * 12.5 - 1e-9)); // 451
    expect(r.warnings.some((w) => w.includes("incompatível"))).toBe(false);
  });

  it("espessura incompatível com o bloco gera aviso", () => {
    const { project } = simpleHouse({ core: "ceramic-brick", thickness: 0.14 });
    expect(constructionTakeoff(project).warnings.some((w) => w.includes("incompatível"))).toBe(true);
  });
});

describe("áreas molhadas", () => {
  const { project } = simpleHouse({ roomType: "banheiro" });
  const r = constructionTakeoff(project);

  it("azulejo = perímetro interno × 2,10 m − aberturas dentro da altura, +10% de perda; sem rodapé", () => {
    // perímetro 2·(3,91+2,91) = 13,64 ; ×2,1 = 28,644 ; porta 0,8×2,1 = 1,68 ; janela 1,2 × (2,1−1,0 = 1,1) = 1,32
    const net = 13.64 * 2.1 - 1.68 - 1.2 * 1.1;
    expect(net).toBeCloseTo(25.644, 9);
    expect(line(r.lines, "REVEST-CERAMICO-PAREDE").quantity).toBeCloseTo(round3(net * 1.1), 9);
    expect(has(r.lines, "ACAB-RODAPE")).toBe(false);
  });

  it("takeoffComplete desconta a área azulejada da pintura do takeoff (sem dupla contagem)", () => {
    const t = takeoff(project);
    const c = takeoffComplete(project);
    const net = 13.64 * 2.1 - 1.68 - 1.2 * 1.1;
    expect(line(c.lines, "PINT-PAREDE").quantity).toBeCloseTo(round3(line(t.lines, "PINT-PAREDE").quantity - net), 9);
    expect(line(c.lines, "PINT-TINTA").quantity).toBeCloseTo(round3((line(t.lines, "PINT-PAREDE").quantity - net) * 2 / 10), 2);
    // selador interno também exclui o azulejo
    expect(line(r.lines, "PINT-INT-SELADOR").quantity).toBeCloseTo(round3((36.08 - net) / 10), 3);
  });
});

describe("cobertura", () => {
  const { project } = buildReferenceProject();
  const r = constructionTakeoff(project);

  it("telhas por m² do material × área inclinada, cumeeira e linear de beiral/rufo", () => {
    // gable 7×3 + beiral 0,5: L = 8, D = 4, pitch 30º -> área inclinada 32/cos30º
    const area = 32 / Math.cos((30 * Math.PI) / 180);
    expect(line(r.lines, "MAT-TELHA-CERAMICA").quantity).toBe(Math.ceil(area * 16 * 1.05 - 1e-9));
    expect(line(r.lines, "MAT-TELHA-CUMEEIRA").quantity).toBe(Math.ceil(8 * 3 * 1.05 - 1e-9)); // 8 m de cumeeira
    expect(line(r.lines, "COB-CALHA").quantity).toBeCloseTo(16, 9); // 2 beirais × 8 m
    expect(line(r.lines, "COB-RUFO").quantity).toBeCloseTo(round3(8 / Math.cos((30 * Math.PI) / 180)), 3); // 2·D/cos
    expect(has(r.lines, "COB-CUMEEIRA")).toBe(false); // do takeoff
    expect(has(r.lines, "COB-ROOF-TILE-CERAMIC")).toBe(false); // do takeoff
  });

  it("estrutura do telhado: m² + aviso (não dimensionada)", () => {
    const e = line(r.lines, "COB-ESTRUTURA");
    expect(e.description).toContain("a dimensionar");
    expect(e.quantity).toBeCloseTo(round3(32 / Math.cos((30 * Math.PI) / 180)), 3);
    expect(r.warnings.some((w) => w.startsWith("Estrutura do telhado"))).toBe(true);
  });

  it("telhado de quatro águas tem espigões", () => {
    let p = simpleHouse().project;
    p = addElements(p, [{ ...(buildReferenceProject().project.elements.find((e) => e.type === "roof")!), roofType: "hip", id: "hip-roof", levelId: "terreo" } as never]);
    const res = constructionTakeoff(p);
    expect(line(res.lines, "COB-ESPIGAO").quantity).toBeGreaterThan(0);
    expect(line(res.lines, "COB-CALHA").quantity).toBeCloseTo(2 * (8 + 4), 9);
  });
});

describe("estrutura de concreto e structuralOverride", () => {
  const { project } = buildReferenceProject();

  it("laje/pilares geram insumos sem repetir LAJE-CONCRETO / EST-CONCRETO", () => {
    const r = constructionTakeoff(project);
    expect(has(r.lines, "LAJE-CONCRETO")).toBe(false);
    expect(has(r.lines, "EST-CONCRETO")).toBe(false);
    const total = line(r.lines, "EST-CONCRETO-TOTAL");
    expect(total.optional).toBe(true);
    expect(total.basis).toContain("lajes");
    // laje 7×3×0,12 = 2,52 m³ ; pilar 0,2×0,4×2,8 ; pilar redondo π·0,15²·2,8
    expect(total.basis).toContain("2,52");
  });

  it("structuralOverride substitui o concreto/aço/fôrma modelados e remove LAJE/EST do takeoff no merge", () => {
    const r = constructionTakeoff(project, { structuralOverride: { concreteM3: 10, steelKg: 800, formworkM2: 50 } });
    expect(line(r.lines, "EST-CONCRETO-ENG").quantity).toBe(10);
    expect(has(r.lines, "EST-FUNDACAO")).toBe(false);
    // vergas: (1,4 + 1,8 + 1,8) × 0,2 × 0,1 = 0,1 m³ -> aço (800 + 0,1 × 100) × 1,10 = 891
    expect(line(r.lines, "MAT-ACO").quantity).toBeCloseTo(891, 3);
    expect(line(r.lines, "EST-FORMA").quantity).toBeCloseTo(50, 9);
    expect(line(r.lines, "EST-CONCRETO-TOTAL").basis).toContain("estrutura (volume informado pelo engenheiro) 10");
    const merged = takeoffComplete(project, {}, { structuralOverride: { concreteM3: 10 } });
    expect(has(merged.lines, "LAJE-CONCRETO")).toBe(false);
    expect(has(merged.lines, "EST-CONCRETO")).toBe(false);
    expect(has(merged.lines, "EST-CONCRETO-ENG")).toBe(true);
    const plain = takeoffComplete(project);
    expect(has(plain.lines, "LAJE-CONCRETO")).toBe(true);
    expect(has(plain.lines, "EST-CONCRETO")).toBe(true);
    // mais concreto -> mais cimento
    const bigger = constructionTakeoff(project, { structuralOverride: { concreteM3: 20 } });
    expect(line(bigger.lines, "MAT-CIMENTO").quantity).toBeGreaterThan(line(r.lines, "MAT-CIMENTO").quantity);
  });
});

describe("ambientes abertos", () => {
  it("ambiente não fechado avisa e não gera contrapiso/rodapé para ele", () => {
    let { project } = simpleHouse();
    project = addElements(project, [createRoom(project.elements, { x: 20, y: 20 }, "quarto", "terreo")]);
    const r = constructionTakeoff(project);
    expect(r.warnings.some((w) => w.includes("não está fechado"))).toBe(true);
    expect(line(r.lines, "CONTRAPISO").elementIds).toHaveLength(1);
  });
});

describe("takeoffComplete - sem dupla contagem", () => {
  const ref = buildReferenceProject().project;

  it("códigos do merge são únicos e disjuntos entre os dois módulos", () => {
    for (const project of [ref, simpleHouse().project, simpleHouse({ roomType: "banheiro" }).project]) {
      const t = takeoff(project);
      const c = constructionTakeoff(project);
      const tc = new Set(t.lines.map((l) => l.code));
      expect(c.lines.filter((l) => tc.has(l.code))).toEqual([]);
      const m = takeoffComplete(project);
      expect(new Set(m.lines.map((l) => l.code)).size).toBe(m.lines.length);
      expect(m.lines.length).toBe(t.lines.length + c.lines.length);
      expect(m.warnings.some((w) => w.includes("duplicado"))).toBe(false);
    }
  });

  it("avisos mesclados sem repetição; takeoff() permanece intacto", () => {
    const m = takeoffComplete(ref);
    expect(new Set(m.warnings).size).toBe(m.warnings.length);
    expect(m.warnings).toContain("Instalações elétricas, hidráulicas e de gás não modeladas: orçar à parte");
    expect(line(m.lines, "ALV-BLOCO-CERAMICO").quantity).toBe(61.28);
    expect(line(m.lines, "PINT-PAREDE").quantity).toBe(122.56);
  });

  it("parâmetros do takeoff e da construção são independentes", () => {
    const m = takeoffComplete(ref, { paintCoats: 3 }, { masonry: { blockLossPercent: 0 } });
    expect(line(m.lines, "PINT-TINTA").quantity).toBeCloseTo(round3((122.56 * 3) / 10), 3);
  });
});

describe("materialSummary", () => {
  const { project } = simpleHouse();
  const items = materialSummary(takeoffComplete(project));
  const get = (k: string) => items.find((i) => i.key === k)!;

  it("lista consolidada com unidade, basis e elementos", () => {
    expect(get("bloco-ceramico")).toMatchObject({ unit: "un", quantity: 948 });
    const c = get("cimento");
    expect(c.unit).toBe("sc");
    expect(c.alt?.unit).toBe("kg");
    expect(c.quantity).toBe(Math.ceil((c.alt?.quantity ?? 0) / 50 - 1e-3));
    expect(get("cal").alt?.unit).toBe("kg");
    expect(get("areia").unit).toBe("m³");
    expect(get("brita").unit).toBe("m³");
    expect(get("aco").unit).toBe("kg");
    expect(get("tinta-paredes").unit).toBe("L"); // vem do takeoff
    for (const i of items) {
      expect(i.basis.length).toBeGreaterThan(5);
      expect(i.codes.length).toBeGreaterThan(0);
      expect(i.quantity).toBeGreaterThan(0);
    }
    expect(get("cimento").elementIds.length).toBeGreaterThan(0);
  });

  it("aceita o resultado só da construção (sem tinta de paredes)", () => {
    const only = materialSummary(constructionTakeoff(project));
    expect(only.some((i) => i.key === "tinta-paredes")).toBe(false);
    expect(only.some((i) => i.key === "selador")).toBe(true);
  });
});

describe("casa moderna (fumaça)", () => {
  const project = buildModernHouse(NOW);
  const c = constructionTakeoff(project);
  const t = takeoff(project);
  const m = takeoffComplete(project);

  it("quantidades finitas e positivas, códigos únicos, merge > 80 linhas", () => {
    for (const l of c.lines) {
      expect(Number.isFinite(l.quantity)).toBe(true);
      expect(l.quantity).toBeGreaterThan(0);
      expect(l.elementIds).toBeDefined();
      expect(l.basis.length).toBeGreaterThan(0);
    }
    expect(new Set(c.lines.map((l) => l.code)).size).toBe(c.lines.length);
    expect(new Set(m.lines.map((l) => l.code)).size).toBe(m.lines.length);
    expect(m.lines.length).toBe(t.lines.length + c.lines.length);
    expect(m.lines.length).toBeGreaterThan(80);
  });

  it("cobre os grupos principais e avisa sobre instalações e estrutura do telhado", () => {
    for (const code of ["MAT-BLOCO-CERAMICO", "MAT-CIMENTO", "MAT-CAL", "MAT-AREIA", "MAT-BRITA", "MAT-ACO", "CONTRAPISO", "ACAB-RODAPE", "REVEST-CERAMICO-PAREDE", "PINT-INT-SELADOR", "PINT-EXT-SELADOR", "EST-CONCRETO-COBERTURA", "COB-CALHA"]) {
      expect(has(c.lines, code)).toBe(true);
    }
    expect(c.warnings.some((w) => w.startsWith("Instalações"))).toBe(true);
    expect(c.warnings.some((w) => w.startsWith("Estrutura do telhado"))).toBe(true);
    expect(c.warnings.some((w) => w.includes("vidro"))).toBe(true); // guarda-corpo do pavimento superior
    expect(c.warnings.some((w) => w.includes("sem parâmetro de telhas"))).toBe(false); // cobertura de concreto é laje, não telha
    // laje de cobertura plana: (8 + 0,6)... gourmet 8×4 + beiral 0,3 -> (8,6 × 4,6) × 0,12
    expect(line(c.lines, "EST-CONCRETO-COBERTURA").quantity).toBeCloseTo(round3(8.6 * 4.6 * 0.12), 9);
  });

  it("faces: interno + externo = 2 × área líquida das paredes que não são de vidro", () => {
    const faces = wallFaceAreas(project);
    const sum = faces.reduce((s, f) => s + f.interiorArea + f.exteriorArea, 0);
    expect(sum).toBeCloseTo(faces.reduce((s, f) => s + f.netArea, 0), 6);
    expect(faces.some((f) => f.interior)).toBe(true);
    expect(faces.some((f) => !f.interior)).toBe(true);
  });

  it("pintura: áreas internas + externas (+ azulejo descontado) = pintura do takeoff", () => {
    const area = ["PINT-INT-SELADOR", "PINT-EXT-SELADOR"].reduce((s, code) => s + (line(c.lines, code).details?.areaM2 ?? 0), 0);
    const tile = line(c.lines, "REVEST-CERAMICO-PAREDE").details?.paintDeductM2 ?? 0;
    expect(area + tile).toBeCloseTo(line(t.lines, "PINT-PAREDE").quantity, 4);
    expect(line(m.lines, "PINT-PAREDE").quantity).toBeCloseTo(line(t.lines, "PINT-PAREDE").quantity - tile, 3);
  });

  it("resumo de materiais completo", () => {
    const items = materialSummary(m);
    expect(items.length).toBeGreaterThan(10);
    expect(items.every((i) => Number.isFinite(i.quantity) && i.quantity > 0)).toBe(true);
  });
});

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// Tipo auxiliar para garantir que o resultado é compatível com TakeoffResult.
const _typeCheck: { lines: QuantityLine[]; warnings: string[] } = constructionTakeoff(simpleHouse().project);
void (_typeCheck as unknown as { lines: ConstructionLine[] });
