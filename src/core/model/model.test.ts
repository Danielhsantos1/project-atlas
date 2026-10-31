import { describe, expect, it } from "vitest";
import { createFloor, createObject, createOpening, createProject, createRoomWalls, createWall, nextName } from "./factory";
import {
  addElements,
  deleteElements,
  duplicateElement,
  moveElement,
  projectStats,
  rotateElement,
  setWallEndpoints,
  updateElement,
  wallEndForAngle,
  wallEndForLength,
} from "./operations";
import { DomainError } from "./errors";
import { getLibraryItem, LIBRARY } from "../library/catalog";
import { ProjectSchema, type Opening, type Project, type Wall } from "./schema";
import { isKnownMaterial } from "./materials";
import { wallLength } from "../geometry/wall";

const wallOpts = { height: 2.8, thickness: 0.15, materialId: "plaster-white" };
const doorSpec = { elementType: "door" as const, width: 0.8, height: 2.1, materialId: "wood-oak" };
const windowSpec = { elementType: "window" as const, width: 1.2, height: 1.2, sillHeight: 1, materialId: "aluminum" };

function residential(): Project {
  return createProject({ name: "Casa Teste", category: "residencial", site: { width: 20, depth: 30 } });
}

function roomProject() {
  let p = residential();
  const walls = createRoomWalls(p.elements, { x: 0, y: 0 }, { x: 5, y: 4 }, wallOpts);
  p = addElements(p, walls);
  return { p, walls };
}

describe("criação de objetos", () => {
  it("cria projeto residencial válido com padrões", () => {
    const p = residential();
    expect(ProjectSchema.safeParse(p).success).toBe(true);
    expect(p.category).toBe("residencial");
    expect(p.status).toBe("em-andamento");
    expect(p.settings.defaultWallHeight).toBe(2.8);
    expect(p.elements).toEqual([]);
  });

  it("rejeita projeto sem nome", () => {
    expect(() => createProject({ name: "  ", category: "comercial", site: { width: 10, depth: 10 } })).toThrow(DomainError);
  });

  it("cria parede com medidas numéricas exatas", () => {
    const w = createWall([], { x: 0, y: 0 }, { x: 4.25, y: 0 }, wallOpts);
    expect(w).toMatchObject({ type: "wall", name: "Parede 1", height: 2.8, thickness: 0.15, baseElevation: 0 });
    expect(wallLength(w)).toBe(4.25);
    expect(() => createWall([], { x: 0, y: 0 }, { x: 0.01, y: 0 }, wallOpts)).toThrow(DomainError);
  });

  it("cria ambiente com 4 paredes encadeadas", () => {
    const { walls } = roomProject();
    expect(walls).toHaveLength(4);
    expect(walls.map((w) => w.name)).toEqual(["Parede 1", "Parede 2", "Parede 3", "Parede 4"]);
    walls.forEach((w, i) => expect(w.end).toEqual(walls[(i + 1) % 4]!.start));
    expect(walls.map(wallLength)).toEqual([5, 4, 5, 4]);
  });

  it("insere porta e janela hospedadas, ajustando a posição para caber", () => {
    const { p, walls } = roomProject();
    const d = createOpening(p.elements, walls[0]!, doorSpec, 0.1);
    expect(d).toMatchObject({ type: "door", hostId: walls[0]!.id, offset: 0.4, name: "Porta 1" });
    const j = createOpening(p.elements, walls[1]!, windowSpec, 2);
    expect(j).toMatchObject({ type: "window", sillHeight: 1, offset: 2 });
    const tiny = createWall([], { x: 0, y: 0 }, { x: 0.5, y: 0 }, wallOpts);
    expect(() => createOpening([], tiny, doorSpec, 0.25)).toThrow(/não cabe/);
    expect(() => createOpening([], walls[0]!, { ...windowSpec, sillHeight: 2 }, 2)).toThrow(/mais alta/);
  });

  it("cria piso a partir de dois cantos e objeto da biblioteca", () => {
    const f = createFloor([], { x: 5, y: 4 }, { x: 0, y: 0 }, { thickness: 0.12, materialId: "concrete" });
    expect(f).toMatchObject({ position: { x: 2.5, y: 2, z: 0 }, width: 5, depth: 4, thickness: 0.12 });
    const item = getLibraryItem("cabinet-wall")!;
    if (item.spec.elementType !== "object") throw new Error("spec");
    const o = createObject([], item.spec, item.name, { x: 1, y: 1 });
    expect(o).toMatchObject({ kind: "cabinet-wall", position: { x: 1, y: 1, z: 1.5 }, length: 0.8 });
  });

  it("nomes sequenciais não repetem", () => {
    const w = createWall([], { x: 0, y: 0 }, { x: 1, y: 0 }, wallOpts);
    expect(nextName([{ ...w, name: "Parede 2" }], "Parede")).toBe("Parede 3");
    expect(nextName([{ ...w, name: "Sala" }], "Parede")).toBe("Parede 1");
    expect(nextName([w, { ...w, id: "x", name: "Parede 2" }], "Parede")).toBe("Parede 3");
  });

  it("todos os itens da biblioteca usam materiais existentes", () => {
    for (const item of LIBRARY) expect(isKnownMaterial(item.spec.materialId), item.id).toBe(true);
  });
});

describe("alteração de propriedades", () => {
  it("altera altura, espessura e material de uma parede", () => {
    const { p, walls } = roomProject();
    const p2 = updateElement(p, walls[0]!.id, { height: 3.1, thickness: 0.2, materialId: "brick" });
    const w = p2.elements.find((e) => e.id === walls[0]!.id) as Wall;
    expect(w).toMatchObject({ height: 3.1, thickness: 0.2, materialId: "brick" });
    // Imutabilidade: o projeto original não muda.
    expect((p.elements[0] as Wall).height).toBe(2.8);
  });

  it("rejeita valores inválidos sem alterar o projeto", () => {
    const { p, walls } = roomProject();
    expect(() => updateElement(p, walls[0]!.id, { height: -1 })).toThrow(DomainError);
    expect(() => updateElement(p, walls[0]!.id, { thickness: Number.NaN })).toThrow(DomainError);
    expect(() => updateElement(p, walls[0]!.id, { end: walls[0]!.start })).toThrow(/comprimento/);
    expect(() => updateElement(p, "nao-existe", { height: 3 })).toThrow(/não encontrado/);
  });

  it("id e tipo são imutáveis", () => {
    const { p, walls } = roomProject();
    const p2 = updateElement(p, walls[0]!.id, { id: "hack", type: "floor" });
    expect(p2.elements[0]).toMatchObject({ id: walls[0]!.id, type: "wall" });
  });

  it("altera comprimento mantendo direção e ângulo mantendo comprimento", () => {
    const w = createWall([], { x: 1, y: 1 }, { x: 4, y: 5 }, wallOpts);
    expect(wallEndForLength(w, 10)).toEqual({ x: 7, y: 9 });
    const end = wallEndForAngle(w, 90);
    expect(end.x).toBeCloseTo(1);
    expect(end.y).toBeCloseTo(6);
    expect(() => wallEndForLength(w, 0)).toThrow(DomainError);
  });

  it("move e gira elementos", () => {
    const { p, walls } = roomProject();
    const moved = moveElement(p, walls[0]!.id, { x: 1, y: 2 });
    expect(moved.elements[0]).toMatchObject({ start: { x: 1, y: 2 }, end: { x: 6, y: 2 } });
    const rotated = rotateElement(p, walls[0]!.id, 90);
    const w = rotated.elements[0] as Wall;
    expect(w.start.x).toBeCloseTo(2.5);
    expect(w.start.y).toBeCloseTo(-2.5);
    expect(wallLength(w)).toBeCloseTo(5);
  });

  it("porta desliza ao longo da parede e fica dentro dela", () => {
    const { p, walls } = roomProject();
    const d = createOpening(p.elements, walls[0]!, doorSpec, 2);
    let p2 = addElements(p, [d]);
    p2 = moveElement(p2, d.id, { x: 1, y: 5 }); // componente Y é ignorada
    expect((p2.elements.find((e) => e.id === d.id) as Opening).offset).toBe(3);
    p2 = moveElement(p2, d.id, { x: 10, y: 0 });
    expect((p2.elements.find((e) => e.id === d.id) as Opening).offset).toBe(4.6);
  });

  it("abertura exige parede hospedeira existente", () => {
    const { p, walls } = roomProject();
    const d = createOpening(p.elements, walls[0]!, doorSpec, 2);
    expect(() => addElements(p, [{ ...d, hostId: "fantasma" }])).toThrow(/parede existente/);
  });
});

describe("juntas de paredes", () => {
  it("mover uma parede estica as paredes unidas (ambiente continua fechado)", () => {
    const { p, walls } = roomProject();
    const east = walls[1]!; // (5,0) → (5,4)
    const moved = moveElement(p, east.id, { x: 1, y: 0 });
    const w = (id: string) => moved.elements.find((e) => e.id === id) as Wall;
    expect(wallLength(w(walls[0]!.id))).toBe(6);
    expect(wallLength(w(walls[2]!.id))).toBe(6);
    expect(w(walls[3]!.id)).toEqual(walls[3]);
    walls.forEach((_, i) => expect(w(walls[i]!.id).end).toEqual(w(walls[(i + 1) % 4]!.id).start));
  });

  it("alterar comprimento move a junta da extremidade final", () => {
    const { p, walls } = roomProject();
    const south = walls[0]!;
    const next = setWallEndpoints(p, south.id, { end: wallEndForLength(south, 6) });
    const east = next.elements.find((e) => e.id === walls[1]!.id) as Wall;
    expect(east.start).toEqual({ x: 6, y: 0 });
    expect(east.end).toEqual({ x: 5, y: 4 });
  });

  it("rejeita movimento que zeraria uma parede unida", () => {
    const { p, walls } = roomProject();
    expect(() => moveElement(p, walls[1]!.id, { x: -5, y: 0 })).toThrow(/unida/);
  });
});

describe("exclusão e duplicação", () => {
  it("excluir parede exclui aberturas hospedadas", () => {
    const { p, walls } = roomProject();
    const d = createOpening(p.elements, walls[0]!, doorSpec, 2);
    const j = createOpening(p.elements, walls[1]!, windowSpec, 2);
    const p2 = addElements(p, [d, j]);
    const { project, removed } = deleteElements(p2, [walls[0]!.id]);
    expect(removed.sort()).toEqual([walls[0]!.id, d.id].sort());
    expect(project.elements).toHaveLength(4);
    expect(project.elements.some((e) => e.id === j.id)).toBe(true);
  });

  it("duplicar parede duplica as aberturas", () => {
    const { p, walls } = roomProject();
    const p2 = addElements(p, [createOpening(p.elements, walls[0]!, doorSpec, 2)]);
    const { project, newId } = duplicateElement(p2, walls[0]!.id);
    expect(project.elements).toHaveLength(7);
    const copyDoor = project.elements.find((e) => e.type === "door" && e.hostId === newId);
    expect(copyDoor?.name).toBe("Porta 2");
  });
});

describe("quantitativos", () => {
  it("soma comprimentos, áreas líquidas e pisos", () => {
    const { p, walls } = roomProject();
    let p2 = addElements(p, [
      createOpening(p.elements, walls[0]!, doorSpec, 2),
      createOpening(p.elements, walls[1]!, windowSpec, 2),
    ]);
    p2 = addElements(p2, [createFloor(p2.elements, { x: 0, y: 0 }, { x: 5, y: 4 }, { thickness: 0.1, materialId: "concrete" })]);
    const s = projectStats(p2);
    expect(s).toMatchObject({ walls: 4, doors: 1, windows: 1, floors: 1, objects: 0 });
    expect(s.totalWallLength).toBeCloseTo(18);
    expect(s.totalWallNetArea).toBeCloseTo(18 * 2.8 - 1.68 - 1.44, 9);
    expect(s.totalFloorArea).toBeCloseTo(20);
  });
});
