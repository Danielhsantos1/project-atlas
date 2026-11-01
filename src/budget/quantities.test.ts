import { describe, expect, it } from "vitest";
import { createProject, createRoomWithWalls, createRoom, createObject, createOpening } from "@/core/model/factory";
import { addElements } from "@/core/model/operations";
import { wallQuantities } from "@/core/geometry/wall";
import { DomainError } from "@/core/model/errors";
import { takeoff, type QuantityLine } from "./quantities";
import { buildReferenceProject, WALL_OPTS } from "./test-fixtures";

const line = (lines: QuantityLine[], code: string) => {
  const l = lines.find((x) => x.code === code);
  if (!l) throw new Error(`linha ${code} ausente: ${lines.map((x) => x.code).join(", ")}`);
  return l;
};

describe("takeoff - projeto de referência", () => {
  const { project, shared } = buildReferenceProject();
  const { lines, warnings } = takeoff(project);

  it("parede compartilhada é contada uma única vez (7 paredes, 23 m de eixo)", () => {
    const walls = project.elements.filter((e) => e.type === "wall");
    expect(walls).toHaveLength(7);
    expect(line(lines, "ALV-BLOCO-CERAMICO").elementIds).toHaveLength(7);
    expect(line(lines, "ALV-BLOCO-CERAMICO").elementIds.filter((id) => id === shared.id)).toHaveLength(1);
  });

  it("área líquida de alvenaria desconta porta e janela", () => {
    // 23 m × 2,8 m = 64,4 m² − porta 0,8×2,1 (1,68) − janela 1,2×1,2 (1,44) = 61,28 m²
    expect(line(lines, "ALV-BLOCO-CERAMICO").quantity).toBe(61.28);
    expect(line(lines, "ALV-BLOCO-CERAMICO").unit).toBe("m²");
    expect(line(lines, "ALV-BLOCO-CERAMICO").category).toBe("materiais");
    // coerente com a função do núcleo
    const openings = project.elements.filter((e) => e.type === "door" || e.type === "window");
    const sharedQ = wallQuantities(shared, openings.filter((o) => o.hostId === shared.id) as never);
    expect(sharedQ.netArea).toBeCloseTo(3 * 2.8 - 1.68, 9);
  });

  it("reboco e pintura = 2 faces; litros de tinta = área × demãos ÷ rendimento", () => {
    expect(line(lines, "REVEST-REBOCO").quantity).toBe(122.56);
    const pint = line(lines, "PINT-PAREDE");
    expect(pint.quantity).toBe(122.56);
    expect(pint.basis).toContain("2 faces");
    const tinta = line(lines, "PINT-TINTA");
    expect(tinta.unit).toBe("L");
    expect(tinta.quantity).toBe(24.512); // 122,56 × 2 ÷ 10
    expect(tinta.basis).toContain("2 demãos");
  });

  it("parâmetros editáveis alteram tinta e perda de piso", () => {
    const r = takeoff(project, { paintCoats: 3, paintYieldM2PerLiterPerCoat: 12, floorLossPercent: 5 });
    expect(line(r.lines, "PINT-TINTA").quantity).toBe(Math.round(((122.56 * 3) / 12) * 1000) / 1000);
    expect(line(r.lines, "PISO-PORCELAIN-TILE").quantity).toBe(Math.round(10.64 * 1.05 * 1000) / 1000);
    expect(() => takeoff(project, { paintCoats: 0 })).toThrow(DomainError);
  });

  it("piso dos ambientes: área útil (meia espessura descontada) × (1 + perda)", () => {
    const sala = line(lines, "PISO-PORCELAIN-TILE");
    expect(sala.quantity).toBe(11.704); // 3,8 × 2,8 = 10,64 × 1,10
    expect(sala.basis).toContain("10% de perda");
    expect(sala.category).toBe("acabamentos");
    expect(line(lines, "PISO-WOOD-OAK").quantity).toBe(8.624); // 2,8 × 2,8 = 7,84 × 1,10
    expect(line(lines, "FORRO-GESSO").quantity).toBe(18.48); // 10,64 + 7,84
  });

  it("laje de concreto em m³ e grama em m²", () => {
    expect(line(lines, "LAJE-CONCRETO")).toMatchObject({ quantity: 2.52, unit: "m³" });
    expect(line(lines, "PAISAGISMO-GRAMA")).toMatchObject({ quantity: 50, unit: "m²" });
  });

  it("aberturas agrupadas por tipo, dimensão e material", () => {
    const door = line(lines, "PORTA-80X210-WOOD-OAK");
    expect(door).toMatchObject({ quantity: 1, unit: "un", category: "esquadrias" });
    expect(door.description).toBe("Porta 80 x 210 cm - Madeira carvalho");
    expect(line(lines, "JANELA-120X120-ALUMINUM").description).toContain("Alumínio anodizado");
  });

  it("telhado: área inclinada e cumeeira", () => {
    // (7 + 1) × (3 + 1) / cos 30°
    expect(line(lines, "COB-ROOF-TILE-CERAMIC").quantity).toBe(Math.round((32 / Math.cos(Math.PI / 6)) * 1000) / 1000);
    expect(line(lines, "COB-CUMEEIRA")).toMatchObject({ quantity: 8, unit: "m" });
  });

  it("objetos: estrutura, móveis planejados, bancada, piscina, paisagismo, equipamentos", () => {
    // 0,2×0,4×2,8 + π×0,15²×2,8
    expect(line(lines, "EST-CONCRETO").quantity).toBe(Math.round((0.224 + Math.PI * 0.0225 * 2.8) * 1000) / 1000);
    expect(line(lines, "MOV-CABINET-BASE")).toMatchObject({ quantity: 2, category: "moveis-planejados" });
    expect(line(lines, "BANCADA-PEDRA")).toMatchObject({ quantity: 1.44, unit: "m²" });
    expect(line(lines, "PISCINA").quantity).toBe(25.16); // (8 − 0,6) × (4 − 0,6)
    expect(line(lines, "PISCINA-UN").quantity).toBe(1);
    expect(line(lines, "PAISAGISMO-ARVORE").quantity).toBe(1);
    expect(line(lines, "EQUIP-FRIDGE")).toMatchObject({ optional: true, category: "equipamentos" });
    expect(lines.some((l) => l.code === "SOLTO-SOFA")).toBe(false);
    const withLoose = takeoff(project, { includeLooseFurniture: true });
    expect(line(withLoose.lines, "SOLTO-SOFA")).toMatchObject({ optional: true, category: "custos-adicionais", quantity: 1 });
  });

  it("todas as linhas têm pavimento, elementos e memória de cálculo", () => {
    for (const l of lines) {
      expect(l.elementIds.length).toBeGreaterThan(0);
      expect(l.basis.length).toBeGreaterThan(0);
      expect(l.levelId).toBe("terreo");
    }
  });

  it("sem avisos de ambiente sem porta (porta na parede compartilhada atende os dois)", () => {
    expect(warnings.filter((w) => w.includes("porta"))).toEqual([]);
    expect(warnings.filter((w) => w.includes("telhado"))).toEqual([]);
  });

  it("é determinístico", () => {
    expect(takeoff(project)).toEqual(takeoff(project));
  });
});

describe("takeoff - avisos de dados incompletos", () => {
  it("projeto sem ambientes e pavimento sem telhado", () => {
    const p = createProject({ name: "Vazio", category: "residencial", site: { width: 10, depth: 10 } });
    const p2 = addElements(p, [createObject(p.elements, { elementType: "object", kind: "tree", length: 1, width: 1, height: 3, materialId: "foliage" }, "Árvore", { x: 1, y: 1 })]);
    const r = takeoff(p2);
    expect(r.warnings.some((w) => w.includes("não possui ambientes"))).toBe(true);
    expect(r.warnings.some((w) => w.includes("não possui telhado"))).toBe(true);
  });

  it("ambiente aberto não tem área computada; ambiente sem porta é sinalizado", () => {
    let p = createProject({ name: "Avisos", category: "residencial", site: { width: 30, depth: 30 } });
    const a = createRoomWithWalls(p.elements, { x: 0, y: 0 }, { x: 4, y: 4 }, "quarto", { ...WALL_OPTS });
    p = addElements(p, [...a.walls, a.room]);
    const open = createRoom(p.elements, { x: 15, y: 15 }, "sala");
    p = addElements(p, [open]);
    const r = takeoff(p);
    expect(r.warnings).toContain(`Ambiente "${open.name}" não está fechado por paredes; área não computada.`);
    expect(r.warnings).toContain(`Ambiente "${a.room.name}" não possui porta em nenhuma de suas paredes.`);
    expect(r.lines.find((l) => l.code === "PISO-PORCELAIN-TILE")).toBeUndefined();
    expect(r.lines.find((l) => l.code === "PISO-WOOD-OAK")?.quantity).toBe(Math.round(3.8 * 3.8 * 1.1 * 1000) / 1000);
  });

  it("abertura com problema de validação gera aviso; escada gera aviso de detalhamento", () => {
    let p = createProject({ name: "Aberturas", category: "residencial", site: { width: 30, depth: 30 } });
    const a = createRoomWithWalls(p.elements, { x: 0, y: 0 }, { x: 4, y: 4 }, "sala", { ...WALL_OPTS });
    p = addElements(p, [...a.walls, a.room]);
    const wall = a.walls[0]!;
    const d1 = { ...createOpening(p.elements, wall, { elementType: "door", width: 0.8, height: 2.1, materialId: "wood-oak" }, 1), name: "Porta A" };
    const d2 = { ...createOpening([...p.elements, d1], wall, { elementType: "door", width: 0.8, height: 2.1, materialId: "wood-oak" }, 1.2), name: "Porta B" };
    p = addElements(p, [d1, d2]);
    p = addElements(p, [createObject(p.elements, { elementType: "object", kind: "stair-straight", length: 3, width: 1, height: 2.8, materialId: "concrete" }, "Escada", { x: 2, y: 2 })]);
    const r = takeoff(p);
    expect(r.warnings.some((w) => w.startsWith('Abertura "Porta A"') && w.includes("Sobrepõe"))).toBe(true);
    expect(r.lines.find((l) => l.code === "PORTA-80X210-WOOD-OAK")?.quantity).toBe(2);
    expect(r.lines.find((l) => l.code === "ESCADA-RETA")?.quantity).toBe(1);
    expect(r.warnings.some((w) => w.includes("Escadas") && w.includes("profissional"))).toBe(true);
  });

  it("vão livre não gera esquadria; porta de correr tem código próprio", () => {
    let p = createProject({ name: "Vãos", category: "residencial", site: { width: 30, depth: 30 } });
    const a = createRoomWithWalls(p.elements, { x: 0, y: 0 }, { x: 5, y: 4 }, "sala", { ...WALL_OPTS });
    p = addElements(p, [...a.walls, a.room]);
    const vao = createOpening(p.elements, a.walls[0]!, { elementType: "door", width: 1.2, height: 2.4, materialId: "plaster-white", style: "opening" }, 1);
    const correr = createOpening([...p.elements, vao], a.walls[2]!, { elementType: "door", width: 2, height: 2.4, materialId: "aluminum-black", style: "sliding" }, 2.5);
    p = addElements(p, [vao, correr]);
    const r = takeoff(p);
    expect(r.lines.filter((l) => l.category === "esquadrias").map((l) => l.code)).toEqual(["PORTA-CORRER-200X240-ALUMINUM-BLACK"]);
    expect(r.lines.find((l) => l.code === "PORTA-CORRER-200X240-ALUMINUM-BLACK")?.description).toBe("Porta de correr 200 x 240 cm - Alumínio preto");
    expect(r.lines.find((l) => l.code === "VAO-LIVRE-120X240")).toMatchObject({ quantity: 1, category: "servicos", description: "Vão livre 120 x 240 cm (passagem sem folha)" });
    expect(r.warnings.some((w) => w.includes("não possui porta"))).toBe(false);
    // ambos os vãos são descontados da alvenaria: 18 m × 2,8 − 1,2×2,4 − 2×2,4
    expect(r.lines.find((l) => l.code === "ALV-BLOCO-CERAMICO")?.quantity).toBe(Math.round((18 * 2.8 - 2.88 - 4.8) * 1000) / 1000);
  });

  it("drywall não recebe reboco; tijolo aparente não recebe pintura nem reboco", () => {
    let p = createProject({ name: "Paredes", category: "residencial", site: { width: 30, depth: 30 } });
    p = addElements(p, [
      { id: "w1", type: "wall", name: "D", levelId: "terreo", core: "drywall", start: { x: 0, y: 0 }, end: { x: 5, y: 0 }, baseElevation: 0, height: 2.7, thickness: 0.1, materialId: "gypsum" },
      { id: "w2", type: "wall", name: "T", levelId: "terreo", core: "ceramic-brick", start: { x: 0, y: 2 }, end: { x: 5, y: 2 }, baseElevation: 0, height: 2.8, thickness: 0.2, materialId: "brick" },
    ]);
    const r = takeoff(p);
    expect(r.lines.find((l) => l.code === "ALV-DRYWALL")?.quantity).toBe(13.5);
    expect(r.lines.find((l) => l.code === "ALV-BLOCO-CERAMICO")?.quantity).toBe(14);
    expect(r.lines.find((l) => l.code === "REVEST-REBOCO")).toBeUndefined();
    expect(r.lines.find((l) => l.code === "PINT-PAREDE")?.quantity).toBe(27); // só o drywall, 2 faces
  });
});
