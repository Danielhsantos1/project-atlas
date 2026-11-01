import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStorage, type KeyValueStorage } from "./repository";
import { KeyValueProjectRepository } from "./key-value-repository";
import { ActivityLog } from "./activity";
import { ProjectService } from "./project-service";
import { CURRENT_FORMAT_VERSION, exportProjectJson, fromEnvelope, parseProjectJson, toEnvelope } from "./format";
import { PersistenceError } from "./errors";
import { addElements, updateElement } from "@/core/model/operations";
import { createFloor, createObject, createOpening, createRoomWalls } from "@/core/model/factory";
import { getLibraryItem } from "@/core/library/catalog";
import type { Project, Wall, Window } from "@/core/model/schema";

let storage: MemoryStorage;
let clockMs: number;
let service: ProjectService;
const clock = () => new Date(clockMs);

beforeEach(() => {
  storage = new MemoryStorage();
  clockMs = Date.parse("2026-10-31T12:00:00.000Z");
  service = new ProjectService(new KeyValueProjectRepository(storage), new ActivityLog(storage), clock);
});

/** Monta o cenário do critério de aceitação: ambiente, porta, janela, piso e um móvel. */
function buildHouse(p: Project): Project {
  const walls = createRoomWalls(p.elements, { x: 0, y: 0 }, { x: 6, y: 4 }, { height: 2.8, thickness: 0.15, materialId: "plaster-white" });
  let next = addElements(p, walls);
  next = updateElement(next, walls[0]!.id, { height: 3, materialId: "brick" });
  const host0 = next.elements[0] as Wall;
  next = addElements(next, [
    createOpening(next.elements, host0, { elementType: "door", width: 0.9, height: 2.1, materialId: "wood-walnut" }, 1.5),
    createOpening(next.elements, walls[1]!, { elementType: "window", width: 1.5, height: 1.2, sillHeight: 1, materialId: "aluminum" }, 2),
  ]);
  next = addElements(next, [createFloor(next.elements, { x: 0, y: 0 }, { x: 6, y: 4 }, { thickness: 0.12, materialId: "concrete" })]);
  const sofa = getLibraryItem("sofa-3")!;
  if (sofa.spec.elementType !== "object") throw new Error("spec");
  next = addElements(next, [createObject(next.elements, sofa.spec, sofa.name, { x: 3, y: 2 })]);
  return { ...next, settings: { ...next.settings, displayUnit: "cm", gridSize: 0.25 } };
}

describe("salvamento e recuperação", () => {
  it("salva e recupera o projeto sem perder geometria, materiais e configurações", async () => {
    const created = await service.create({ name: "Residência Aceite", category: "residencial", site: { width: 15, depth: 25 } });
    const house = buildHouse(created);
    clockMs += 60_000;
    await service.save(house);

    // Simula fechar a aplicação: novo serviço sobre o mesmo armazenamento.
    const reopened = new ProjectService(new KeyValueProjectRepository(storage), new ActivityLog(storage), clock);
    const loaded = await reopened.open(created.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.elements).toEqual(house.elements);
    expect(loaded!.settings).toEqual({ ...house.settings });
    expect(loaded!.updatedAt).toBe("2026-10-31T12:01:00.000Z");
    const win = loaded!.elements.find((e): e is Window => e.type === "window")!;
    expect(win).toMatchObject({ width: 1.5, height: 1.2, sillHeight: 1, materialId: "aluminum" });
    expect((loaded!.elements[0] as Wall)).toMatchObject({ height: 3, materialId: "brick" });
  });

  it("lista resumos com miniatura derivada da geometria", async () => {
    const p = await service.create({ name: "A", category: "comercial", site: { width: 10, depth: 10 } });
    clockMs += 1000;
    await service.save(buildHouse(p));
    clockMs += 1000;
    await service.create({ name: "B", category: "interiores", site: { width: 10, depth: 10 } });
    const list = await service.list();
    expect(list.map((s) => s.name)).toEqual(["B", "A"]); // mais recente primeiro
    const a = list[1]!;
    expect(a.elementCount).toBe(8);
    expect(a.preview.walls).toHaveLength(4);
    expect(a.preview.bounds).toEqual({ minX: 0, minY: 0, maxX: 6, maxY: 4 });
  });

  it("duplica, atualiza e exclui", async () => {
    const p = await service.create({ name: "Original", category: "moveis", site: { width: 5, depth: 5 } });
    await service.save(buildHouse(p));
    const copy = await service.duplicate(p.id);
    expect(copy.id).not.toBe(p.id);
    expect(copy.name).toBe("Original (cópia)");
    expect(copy.elements).toHaveLength(8);
    await service.update(p.id, { favorite: true, status: "concluido" });
    expect((await service.open(p.id))?.favorite).toBe(true);
    await service.delete(p.id);
    expect(await service.open(p.id)).toBeNull();
    expect((await service.list()).map((s) => s.id)).toEqual([copy.id]);
  });

  it("registra atividade e agrupa salvamentos seguidos", async () => {
    const p = await service.create({ name: "X", category: "residencial", site: { width: 5, depth: 5 } });
    await service.save(p);
    clockMs += 60_000;
    await service.save(p);
    await service.open(p.id);
    await service.open(p.id);
    const log = service.activityLog();
    expect(log.map((e) => e.type)).toEqual(["opened", "saved", "created"]);
    expect(log[1]!.at).toBe("2026-10-31T12:01:00.000Z");
  });

  it("propaga erro de dados corrompidos em vez de esconder", async () => {
    const p = await service.create({ name: "Y", category: "residencial", site: { width: 5, depth: 5 } });
    storage.setItem(`atlas:v1:project:${p.id}`, "{corrompido");
    await expect(service.open(p.id)).rejects.toThrow(PersistenceError);
    storage.setItem("atlas:v1:index", "[{}]");
    await expect(service.list()).rejects.toThrow(/índice/);
  });

  it("falta de espaço vira erro explícito", async () => {
    const full: KeyValueStorage = {
      getItem: () => null,
      removeItem: () => undefined,
      setItem: () => {
        const e = new Error("exceeded the quota");
        e.name = "QuotaExceededError";
        throw e;
      },
    };
    const repo = new KeyValueProjectRepository(full);
    const s = new ProjectService(repo, new ActivityLog(full), clock);
    await expect(s.create({ name: "Z", category: "residencial", site: { width: 5, depth: 5 } })).rejects.toThrow(/esgotado/);
  });
});

describe("exportação e importação JSON", () => {
  it("exporta e reimporta preservando todos os dados (como novo projeto)", async () => {
    const p = buildHouse(await service.create({ name: "Exportável", category: "residencial", site: { width: 12, depth: 20 } }));
    const json = service.exportJson(p);
    const parsed = JSON.parse(json);
    expect(parsed).toMatchObject({ format: "atlas.project", version: CURRENT_FORMAT_VERSION });
    const imported = await service.importJson(json);
    expect(imported.id).not.toBe(p.id);
    expect(imported.elements).toEqual(p.elements);
    expect(imported.settings).toEqual(p.settings);
    expect(imported.name).toBe(p.name);
    expect(await service.open(imported.id)).toEqual(imported);
  });

  it("rejeita JSON inválido, formato desconhecido e projeto inconsistente", () => {
    expect(() => parseProjectJson("não é json")).toThrow(/JSON inválido/);
    expect(() => parseProjectJson(JSON.stringify({ hello: "world" }))).toThrow(/envelope/);
    const bad = { format: "atlas.project", version: 1, savedAt: "", project: { name: "sem resto" } };
    expect(() => parseProjectJson(JSON.stringify(bad))).toThrow(/Projeto inválido/);
  });

  it("rejeita versão futura do formato", () => {
    const env = { format: "atlas.project", version: CURRENT_FORMAT_VERSION + 1, savedAt: "", project: {} };
    expect(() => fromEnvelope(env)).toThrow(/versão/);
  });

  it("aplica migrações em sequência até a versão atual", async () => {
    const current = buildHouse(await service.create({ name: "Migrável", category: "residencial", site: { width: 5, depth: 5 } }));
    // Documento "v1" hipotético que guardava o nome em outro campo; migração v1→v2 o corrige.
    const { name, ...rest } = current;
    const legacy = { format: "atlas.project", version: 1, savedAt: "", project: { ...rest, title: name } };
    const migrated = fromEnvelope(
      legacy,
      { 1: (doc) => { const { title, ...others } = doc as { title: string }; return { ...others, name: title }; } },
      2,
    );
    expect(migrated.name).toBe("Migrável");
    expect(() => fromEnvelope(legacy, {}, 2)).toThrow(/migração/);
  });

  it("envelope tem data de gravação", () => {
    const env = toEnvelope({} as Project, new Date("2026-01-01T00:00:00Z"));
    expect(env.savedAt).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("migração v1 → v2 (documento real da versão anterior)", () => {
  const v1 = {
    format: "atlas.project",
    version: 1,
    savedAt: "2026-10-31T20:00:00.000Z",
    project: {
      id: "p1", name: "Projeto v1", description: "", category: "residencial", status: "em-andamento", favorite: false,
      createdAt: "2026-10-31T20:00:00.000Z", updatedAt: "2026-10-31T20:00:00.000Z",
      site: { width: 12, depth: 25 },
      settings: { displayUnit: "m", gridSize: 0.1, snapToGrid: true, defaultWallHeight: 2.8, defaultWallThickness: 0.15 },
      elements: [
        { id: "w1", type: "wall", name: "Parede 1", materialId: "plaster-white", start: { x: 0, y: 0 }, end: { x: 5, y: 0 }, baseElevation: 0, height: 2.8, thickness: 0.15 },
        { id: "w2", type: "wall", name: "Parede 2", materialId: "gypsum", start: { x: 5, y: 0 }, end: { x: 5, y: 4 }, baseElevation: 0, height: 2.8, thickness: 0.1 },
        { id: "d1", type: "door", name: "Porta 1", materialId: "wood-oak", hostId: "w1", offset: 2, width: 0.8, height: 2.1, hinge: "left", opensTo: "left" },
        { id: "f1", type: "floor", name: "Piso 1", materialId: "concrete", position: { x: 2.5, y: 2, z: 0 }, width: 5, depth: 4, thickness: 0.12, rotation: 0 },
        { id: "o1", type: "object", kind: "sofa", name: "Sofá 1", materialId: "fabric-gray", position: { x: 2, y: 2, z: 0 }, rotation: 0, length: 2.1, width: 0.9, height: 0.85 },
      ],
    },
  };

  it("cria o Térreo, associa os elementos e preserva medidas", () => {
    const p = fromEnvelope(v1);
    expect(p.levels).toEqual([{ id: "terreo", name: "Térreo", elevation: 0, height: 3 }]);
    expect(p.elements.find((e) => e.id === "w1")).toMatchObject({ levelId: "terreo", core: "ceramic-brick", end: { x: 5, y: 0 } });
    expect(p.elements.find((e) => e.id === "w2")).toMatchObject({ core: "drywall", thickness: 0.1 });
    expect(p.elements.find((e) => e.id === "d1")).not.toHaveProperty("levelId");
    expect(p.elements.find((e) => e.id === "o1")).toMatchObject({ levelId: "terreo", length: 2.1 });
  });
});

describe("criação a partir de modelo", () => {
  it("salva cópia validada com novo id", async () => {
    const { buildModernHouse } = await import("@/core/templates/modern-house");
    const tpl = buildModernHouse(new Date("2026-01-01T00:00:00Z"));
    const p = await service.createFrom(tpl);
    expect(p.id).not.toBe(tpl.id);
    expect(p.createdAt).toBe("2026-10-31T12:00:00.000Z");
    expect((await service.open(p.id))?.elements).toEqual(tpl.elements);
    expect(service.activityLog()[0]?.type).toBe("opened");
  });
});
