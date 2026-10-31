import { beforeEach, describe, expect, it } from "vitest";
import { useEditor } from "./store";
import { useCursor } from "./cursor";
import { createProject } from "@/core/model/factory";
import type { Door, Opening, Wall, Window } from "@/core/model/schema";
import { wallLength } from "@/core/geometry/wall";

const S = () => useEditor.getState();
const walls = () => S().project!.elements.filter((e): e is Wall => e.type === "wall");

beforeEach(() => {
  S().load(createProject({ name: "Casa", category: "residencial", site: { width: 20, depth: 20 } }));
});

describe("editor — fluxo de modelagem", () => {
  it("ferramenta Ambiente cria 4 paredes e piso com snap na grade", () => {
    S().setTool("room");
    S().pointerClick({ x: 0.02, y: -0.03 });
    S().pointerClick({ x: 5.04, y: 4.01 });
    expect(walls()).toHaveLength(4);
    expect(walls()[0]).toMatchObject({ start: { x: 0, y: 0 }, end: { x: 5, y: 0 } });
    expect(S().project!.elements.filter((e) => e.type === "floor")).toHaveLength(1);
    expect(S().saveStatus).toBe("dirty");
    expect(S().revision).toBe(1);
  });

  it("ferramenta Parede encadeia segmentos e fecha no ponto inicial", () => {
    S().setTool("wall");
    for (const p of [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }, { x: 0.05, y: 0.04 }]) S().pointerClick(p);
    expect(walls()).toHaveLength(4);
    const tool = S().tool;
    expect(tool.kind === "wall" && tool.anchor).toBeNull();
  });

  it("comprimento digitado cria parede exata na direção do cursor", () => {
    S().setTool("wall");
    S().pointerClick({ x: 1, y: 1 });
    S().pointerMove({ x: 1, y: 9 });
    for (const k of "3,25") S().typeLength(k);
    S().typeLength("Enter");
    expect(walls()[0]).toMatchObject({ start: { x: 1, y: 1 }, end: { x: 1, y: 4.25 } });
  });

  it("comprimento digitado usa rastreamento polar de 15°", () => {
    S().setTool("wall");
    S().pointerClick({ x: 0, y: 0 });
    S().pointerMove({ x: 5, y: 0.6 }); // ~6,8° → 0°
    for (const k of "4") S().typeLength(k);
    S().typeLength("Enter");
    S().pointerMove({ x: 6.2, y: 2.1 }); // ~43,7° a partir de (4,0) → 45°
    for (const k of "2") S().typeLength(k);
    S().typeLength("Enter");
    expect(walls()[0]!.end).toEqual({ x: 4, y: 0 });
    expect(walls()[1]!.end.x).toBeCloseTo(4 + Math.SQRT2, 6);
    expect(walls()[1]!.end.y).toBeCloseTo(Math.SQRT2, 6);
  });

  it("modo ortogonal (Shift) alinha ao eixo dominante", () => {
    S().setTool("wall");
    S().pointerClick({ x: 0, y: 0 });
    S().pointerClick({ x: 3, y: 0.6 }, { shift: true });
    expect(walls()[0]!.end).toEqual({ x: 3, y: 0 });
  });

  it("altera dimensões pelo painel e desfaz/refaz", () => {
    S().setTool("room");
    S().pointerClick({ x: 0, y: 0 });
    S().pointerClick({ x: 5, y: 4 });
    const id = walls()[0]!.id;
    expect(S().setWallLength(id, 6.5)).toBe(true);
    expect(S().updateElement(id, { height: 3.2, thickness: 0.2 })).toBe(true);
    expect(wallLength(walls()[0]!)).toBe(6.5);
    expect(walls()[0]!.height).toBe(3.2);
    S().undo();
    expect(walls()[0]!.height).toBe(2.8);
    S().undo();
    expect(wallLength(walls()[0]!)).toBe(5);
    S().redo();
    S().redo();
    expect(walls()[0]).toMatchObject({ height: 3.2, thickness: 0.2 });
  });

  it("rejeita alteração inválida sem mexer no documento nem no histórico", () => {
    S().setTool("room");
    S().pointerClick({ x: 0, y: 0 });
    S().pointerClick({ x: 5, y: 4 });
    const before = S().project;
    const rev = S().revision;
    // reportError notifica erros de domínio (não relança).
    expect(S().updateElement(walls()[0]!.id, { height: -2 })).toBe(false);
    expect(S().project).toBe(before);
    expect(S().revision).toBe(rev);
  });

  it("insere porta na parede selecionada e janela clicando perto de outra parede", () => {
    S().setTool("room");
    S().pointerClick({ x: 0, y: 0 });
    S().pointerClick({ x: 5, y: 4 });
    const [w0, w1] = walls();
    S().select(w0!.id);
    S().activateLibraryItem("door-80");
    const door = S().project!.elements.find((e): e is Door => e.type === "door")!;
    expect(door).toMatchObject({ hostId: w0!.id, offset: 2.5, width: 0.8 });
    expect(S().selectedId).toBe(door.id);

    S().select(null);
    S().activateLibraryItem("window-120x120");
    expect(S().tool.kind).toBe("place");
    S().pointerClick({ x: 5.3, y: 1.7 }); // perto da parede leste
    const win = S().project!.elements.find((e): e is Window => e.type === "window")!;
    expect(win.hostId).toBe(w1!.id);
    expect(win.offset).toBeCloseTo(1.7);
    expect(S().tool.kind).toBe("select");
  });

  it("clique longe de parede não cria abertura", () => {
    S().activateLibraryItem("door-90");
    S().pointerClick({ x: 10, y: 10 });
    expect(S().project!.elements).toHaveLength(0);
  });

  it("arraste vira um único passo de histórico", () => {
    S().activateLibraryItem("table-6");
    S().pointerClick({ x: 2, y: 2 });
    const id = S().selectedId!;
    const rev = S().revision;
    S().beginDrag();
    S().dragMove(id, { x: 0.5, y: 0 });
    S().dragMove(id, { x: 1, y: 1 });
    S().endDrag();
    expect(S().revision).toBe(rev + 1);
    const obj = S().project!.elements.find((e) => e.id === id)!;
    expect(obj.type === "object" && obj.position).toMatchObject({ x: 3, y: 3 });
    S().undo();
    const back = S().project!.elements.find((e) => e.id === id)!;
    expect(back.type === "object" && back.position).toMatchObject({ x: 2, y: 2 });
  });

  it("excluir parede remove suas aberturas; duplicar seleciona a cópia", () => {
    S().setTool("room");
    S().pointerClick({ x: 0, y: 0 });
    S().pointerClick({ x: 5, y: 4 });
    S().select(walls()[0]!.id);
    S().activateLibraryItem("door-80");
    S().select(walls()[0]!.id);
    S().duplicateSelected();
    expect(walls()).toHaveLength(5);
    expect(S().project!.elements.filter((e): e is Opening => e.type === "door")).toHaveLength(2);
    S().select(walls()[0]!.id);
    S().deleteSelected();
    expect(walls()).toHaveLength(4);
    expect(S().project!.elements.filter((e) => e.type === "door")).toHaveLength(1);
    expect(S().selectedId).toBeNull();
  });

  it("controle de alterações: salvar durante edição mantém estado sujo", () => {
    S().activateLibraryItem("chair");
    S().pointerClick({ x: 1, y: 1 });
    const rev = S().revision;
    S().markSaving();
    S().activateLibraryItem("chair");
    S().pointerClick({ x: 2, y: 1 });
    S().markSaved(rev, new Date().toISOString());
    expect(S().saveStatus).toBe("dirty");
    S().markSaved(S().revision, new Date().toISOString());
    expect(S().saveStatus).toBe("saved");
  });

  it("cursor recebe o ponto com snap", () => {
    S().pointerMove({ x: 1.234, y: 2.26 });
    expect(useCursor.getState()).toMatchObject({ point: { x: 1.2, y: 2.3 }, snap: "grid" });
  });
});
