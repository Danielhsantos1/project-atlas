"use client";

import { create } from "zustand";
import type { Element, Level, Project, ProjectSettings, RoofType, RoomType, Wall } from "@/core/model/schema";
import { ProjectSchema, isWall } from "@/core/model/schema";
import { DomainError } from "@/core/model/errors";
import {
  addElements,
  deleteElements,
  duplicateElement,
  moveElement,
  addLevel,
  deleteLevel,
  resizeRoom,
  rotateElement,
  setLevelCeilingHeight,
  setWallEndpoints,
  updateElement,
  updateLevel,
  wallEndForAngle,
  wallEndForLength,
  type ElementPatch,
} from "@/core/model/operations";
import { createFloor, createLevel, createObject, createOpening, createRoof, createRoomWithWalls, createWall } from "@/core/model/factory";
import { getLibraryItem } from "@/core/library/catalog";
import { planGarage, type GarageLayout } from "@/core/planning/garage";
import { findNearestWall, orthoConstrain, snapPoint, wallEndpoints } from "@/core/geometry/snap";
import { wallLength } from "@/core/geometry/wall";
import { add, normalize, samePoint, scale, sub, type Vec2 } from "@/core/geometry/vec";
import { parseLength } from "@/core/units/units";
import { notify, reportError } from "@/ui/notifications";
import { useCursor } from "./cursor";

export interface WallPreset {
  height: number;
  thickness: number;
  materialId: string;
}
export interface FloorPreset {
  thickness: number;
  materialId: string;
}

export type Tool =
  | { kind: "select" }
  | { kind: "wall"; preset: WallPreset; anchor: Vec2 | null; chainStart: Vec2 | null; typed: string }
  | { kind: "room"; preset: WallPreset; anchor: Vec2 | null; roomType: RoomType }
  | { kind: "roof"; anchor: Vec2 | null; roofType: RoofType; pitch: number }
  | { kind: "floor"; preset: FloorPreset; anchor: Vec2 | null }
  | { kind: "place"; itemId: string; size?: OpeningSize }
  | { kind: "garage"; cars: number; layout: GarageLayout };

/** Medidas livres de porta/janela escolhidas pelo usuário antes de inserir (metros). */
export interface OpeningSize {
  width: number;
  height: number;
  sillHeight?: number;
}

export type ToolKind = Tool["kind"];
export type ViewMode = "3d" | "2d";
export type CameraPreset = "fit" | "top" | "front" | "right" | "iso";

/** Modos de visualização do viewport 3D — todos derivados do MESMO modelo. */
export type ViewMode3D = "complete" | "dollhouse" | "section" | "construction" | "facade" | "interior" | "walkthrough";
export type FacadeSide = "front" | "back" | "left" | "right";
export type Quality = "alta" | "media" | "baixa";

/** Etapas da obra (visualização conceitual — não é cronograma nem cálculo). */
export const CONSTRUCTION_STAGES = [
  "Terreno",
  "Fundação (conceitual)",
  "Estrutura",
  "Alvenaria",
  "Cobertura",
  "Instalações",
  "Acabamento",
  "Projeto finalizado",
] as const;
export type SaveStatus = "saved" | "dirty" | "saving" | "error";

const HISTORY_LIMIT = 150;
/** Raio de captura de extremidades de paredes (m). */
const ENDPOINT_TOLERANCE = 0.15;
/** Distância máxima (m) entre o clique e a face da parede para inserir abertura. */
const OPENING_PICK_DISTANCE = 0.6;

interface EditorState {
  project: Project | null;
  past: Project[];
  future: Project[];
  /** Incrementa a cada alteração do documento (controle de autosave). */
  revision: number;
  savedRevision: number;
  saveStatus: SaveStatus;
  saveError: string | null;
  selectedId: string | null;
  hoveredId: string | null;
  view: ViewMode;
  tool: Tool;
  panels: { left: boolean; right: boolean };
  camera: { preset: CameraPreset; nonce: number };
  /** Estado antes de um arraste em andamento (vira UM passo de histórico). */
  dragOrigin: Project | null;
  activeLevelId: string;
  viewMode: ViewMode3D;
  section: { height: number; axis: "none" | "x" | "y"; position: number };
  stage: number;
  facade: FacadeSide;
  interiorRoomId: string | null;
  quality: Quality;

  setActiveLevel(id: string): void;
  addLevelAbove(): void;
  updateLevel(id: string, patch: Partial<Omit<Level, "id">>): boolean;
  deleteLevel(id: string): void;
  setViewMode(mode: ViewMode3D): void;
  setSection(patch: Partial<EditorState["section"]>): void;
  setStage(stage: number): void;
  setFacade(side: FacadeSide): void;
  setInteriorRoom(id: string | null): void;
  setQuality(q: Quality): void;
  resizeRoom(id: string, axis: "x" | "y", size: number): boolean;
  setRoomTool(roomType: RoomType): void;
  /** Define medidas livres para a próxima porta/janela inserida (null = usar as da biblioteca). */
  setPlaceSize(size: OpeningSize | null): void;
  setGarageTool(cars: number, layout: GarageLayout): void;
  setCeilingHeight(levelId: string, height: number): boolean;

  load(project: Project): void;
  unload(): void;
  /** Aplica uma alteração ao documento com histórico. Retorna false se rejeitada. */
  commit(mutate: (p: Project) => Project, select?: string | null): boolean;
  undo(): void;
  redo(): void;

  select(id: string | null): void;
  hover(id: string | null): void;
  setView(view: ViewMode): void;
  togglePanel(side: "left" | "right"): void;
  requestCamera(preset: CameraPreset): void;

  updateElement(id: string, patch: ElementPatch): boolean;
  setWallLength(id: string, length: number): boolean;
  setWallAngle(id: string, angle: number): boolean;
  deleteSelected(): void;
  duplicateSelected(): void;
  rotateSelected(deg: number): void;
  nudgeSelected(delta: Vec2): void;
  moveBy(id: string, delta: Vec2): boolean;
  beginDrag(): void;
  dragMove(id: string, delta: Vec2): void;
  endDrag(): void;

  updateProject(patch: Partial<Pick<Project, "name" | "description" | "category" | "status" | "site">>): boolean;
  updateSettings(patch: Partial<ProjectSettings>): boolean;

  setTool(kind: ToolKind): void;
  setToolOptions(patch: Partial<WallPreset & FloorPreset & { roomType: RoomType; roofType: RoofType; pitch: number }>): void;
  activateLibraryItem(itemId: string): void;
  cancelTool(): void;
  pointerMove(raw: Vec2, mods?: { shift?: boolean }): void;
  pointerClick(raw: Vec2, mods?: { shift?: boolean }): void;
  finishChain(): void;
  typeLength(key: string): boolean;

  markSaving(): void;
  markSaved(revision: number, updatedAt: string): void;
  markSaveError(message: string): void;
}

const selectTool: Tool = { kind: "select" };

function defaultWallPreset(p: Project): WallPreset {
  return { height: p.settings.defaultWallHeight, thickness: p.settings.defaultWallThickness, materialId: "plaster-white" };
}

export const useEditor = create<EditorState>((set, get) => {
  /** Ponto efetivo do cursor: snap em extremidades/grade + modo ortogonal (Shift). */
  function resolvePoint(raw: Vec2, shift: boolean): ReturnType<typeof snapPoint> {
    const { project, tool } = get();
    if (!project) return { point: raw, kind: "free" };
    const anchor = "anchor" in tool ? tool.anchor : null;
    const base = shift && anchor ? orthoConstrain(anchor, raw) : raw;
    const walls = project.elements.filter((e): e is Wall => isWall(e) && e.levelId === get().activeLevelId);
    const snapped = snapPoint(base, {
      gridSize: project.settings.gridSize,
      snapToGrid: project.settings.snapToGrid,
      endpoints: wallEndpoints(walls),
      tolerance: ENDPOINT_TOLERANCE,
    });
    if (shift && anchor && snapped.kind !== "endpoint") {
      return { ...snapped, point: orthoConstrain(anchor, snapped.point) };
    }
    return snapped;
  }

  function addWallSegment(from: Vec2, to: Vec2, preset: WallPreset): boolean {
    return get().commit((p) => addElements(p, [createWall(p.elements, from, to, { ...preset, levelId: get().activeLevelId })]));
  }

  function selectedElement(): Element | null {
    const { project, selectedId } = get();
    return project?.elements.find((e) => e.id === selectedId) ?? null;
  }

  return {
    project: null,
    past: [],
    future: [],
    revision: 0,
    savedRevision: 0,
    saveStatus: "saved",
    saveError: null,
    selectedId: null,
    hoveredId: null,
    view: "3d",
    tool: selectTool,
    panels: { left: true, right: true },
    camera: { preset: "fit", nonce: 0 },
    dragOrigin: null,
    activeLevelId: "terreo",
    viewMode: "complete",
    section: { height: 1.2, axis: "none", position: 0 },
    stage: 8,
    facade: "front",
    interiorRoomId: null,
    quality: "alta",

    setActiveLevel(id) {
      if (get().project?.levels.some((l) => l.id === id)) set({ activeLevelId: id, selectedId: null });
    },
    addLevelAbove() {
      const p = get().project;
      if (!p) return;
      const level = createLevel(p.levels);
      if (get().commit((proj) => addLevel(proj, level))) {
        set({ activeLevelId: level.id });
        notify("success", `${level.name} criado na cota ${level.elevation.toFixed(2).replace(".", ",")} m.`);
      }
    },
    updateLevel: (id, patch) => get().commit((p) => updateLevel(p, id, patch)),
    deleteLevel(id) {
      if (get().commit((p) => deleteLevel(p, id), null)) {
        set({ activeLevelId: get().project!.levels[0]!.id });
      }
    },
    setViewMode(mode) {
      set({ viewMode: mode, view: "3d" });
      if (mode !== "walkthrough" && mode !== "facade") get().requestCamera(mode === "dollhouse" ? "iso" : "fit");
    },
    setSection: (patch) => set({ section: { ...get().section, ...patch } }),
    setStage: (stage) => set({ stage: Math.min(8, Math.max(1, Math.round(stage))) }),
    setFacade: (facade) => set({ facade }),
    setInteriorRoom: (id) => set({ interiorRoomId: id }),
    setQuality: (quality) => set({ quality }),
    resizeRoom: (id, axis, size) => get().commit((p) => resizeRoom(p, id, axis, size)),
    setPlaceSize(size) {
      const { tool } = get();
      if (tool.kind !== "place") return;
      set({ tool: { ...tool, ...(size ? { size } : { size: undefined }) } });
    },
    setGarageTool(cars, layout) {
      if (!get().project) return;
      useCursor.getState().clear();
      set({ tool: { kind: "garage", cars, layout }, selectedId: null });
    },
    setCeilingHeight: (levelId, height) => get().commit((p) => setLevelCeilingHeight(p, levelId, height)),
    setRoomTool(roomType) {
      const p = get().project;
      if (!p) return;
      useCursor.getState().clear();
      set({ tool: { kind: "room", preset: defaultWallPreset(p), anchor: null, roomType }, selectedId: null });
    },

    load(project) {
      set({
        project,
        past: [],
        future: [],
        revision: 0,
        savedRevision: 0,
        saveStatus: "saved",
        saveError: null,
        selectedId: null,
        hoveredId: null,
        tool: selectTool,
        dragOrigin: null,
        camera: { preset: "fit", nonce: get().camera.nonce + 1 },
        activeLevelId: project.levels[0]?.id ?? "terreo",
        viewMode: "complete",
        interiorRoomId: null,
      });
    },

    unload() {
      set({ project: null, past: [], future: [], selectedId: null, hoveredId: null, tool: selectTool });
    },

    commit(mutate, select) {
      const { project, past, revision } = get();
      if (!project) return false;
      let next: Project;
      try {
        next = mutate(project);
      } catch (error) {
        reportError(error);
        return false;
      }
      if (next === project) return true;
      set({
        project: next,
        past: [...past, project].slice(-HISTORY_LIMIT),
        future: [],
        revision: revision + 1,
        saveStatus: "dirty",
        ...(select !== undefined ? { selectedId: select } : {}),
      });
      return true;
    },

    undo() {
      const { past, project, future, revision, selectedId } = get();
      const prev = past[past.length - 1];
      if (!prev || !project) return;
      set({
        project: prev,
        past: past.slice(0, -1),
        future: [project, ...future],
        revision: revision + 1,
        saveStatus: "dirty",
        selectedId: prev.elements.some((e) => e.id === selectedId) ? selectedId : null,
      });
    },

    redo() {
      const { past, project, future, revision, selectedId } = get();
      const next = future[0];
      if (!next || !project) return;
      set({
        project: next,
        past: [...past, project],
        future: future.slice(1),
        revision: revision + 1,
        saveStatus: "dirty",
        selectedId: next.elements.some((e) => e.id === selectedId) ? selectedId : null,
      });
    },

    select: (id) => set({ selectedId: id }),
    hover: (id) => {
      if (get().hoveredId !== id) set({ hoveredId: id });
    },
    setView: (view) => set({ view }),
    togglePanel: (side) => set({ panels: { ...get().panels, [side]: !get().panels[side] } }),
    requestCamera: (preset) => set({ camera: { preset, nonce: get().camera.nonce + 1 } }),

    updateElement: (id, patch) => get().commit((p) => updateElement(p, id, patch)),

    setWallLength(id, length) {
      return get().commit((p) => {
        const wall = p.elements.find((e) => e.id === id) as Wall;
        return setWallEndpoints(p, id, { end: wallEndForLength(wall, length) });
      });
    },

    setWallAngle(id, angle) {
      return get().commit((p) => {
        const wall = p.elements.find((e) => e.id === id) as Wall;
        return setWallEndpoints(p, id, { end: wallEndForAngle(wall, angle) });
      });
    },

    deleteSelected() {
      const { selectedId } = get();
      if (!selectedId) return;
      get().commit((p) => deleteElements(p, [selectedId]).project, null);
    },

    duplicateSelected() {
      const { selectedId } = get();
      if (!selectedId) return;
      let newId: string | null = null;
      const ok = get().commit((p) => {
        const r = duplicateElement(p, selectedId);
        newId = r.newId;
        return r.project;
      });
      if (ok && newId) set({ selectedId: newId });
    },

    rotateSelected(deg) {
      const el = selectedElement();
      if (!el) return;
      if (el.type === "door" || el.type === "window") {
        notify("info", "Portas e janelas seguem a parede. Use “Dobradiça” e “Abre para” no painel.");
        return;
      }
      get().commit((p) => rotateElement(p, el.id, deg));
    },

    nudgeSelected(delta) {
      const { selectedId } = get();
      if (selectedId) get().commit((p) => moveElement(p, selectedId, delta));
    },

    moveBy: (id, delta) => get().commit((p) => moveElement(p, id, delta)),

    beginDrag() {
      set({ dragOrigin: get().project });
    },

    dragMove(id, delta) {
      const { dragOrigin } = get();
      if (!dragOrigin) return;
      try {
        set({ project: moveElement(dragOrigin, id, delta) });
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
        // Posição inválida durante o arraste: mantém a última posição válida.
      }
    },

    endDrag() {
      const { dragOrigin, project, past, revision } = get();
      if (!dragOrigin) return;
      if (project && project !== dragOrigin) {
        set({ past: [...past, dragOrigin].slice(-HISTORY_LIMIT), future: [], revision: revision + 1, saveStatus: "dirty" });
      }
      set({ dragOrigin: null });
    },

    updateProject(patch) {
      return get().commit((p) => {
        const parsed = ProjectSchema.safeParse({ ...p, ...patch });
        if (!parsed.success) throw new DomainError(parsed.error.issues[0]?.message ?? "Valor inválido.");
        return parsed.data;
      });
    },

    updateSettings(patch) {
      return get().commit((p) => {
        const parsed = ProjectSchema.safeParse({ ...p, settings: { ...p.settings, ...patch } });
        if (!parsed.success) throw new DomainError(parsed.error.issues[0]?.message ?? "Configuração inválida.");
        return parsed.data;
      });
    },

    setTool(kind) {
      const { project } = get();
      if (!project) return;
      useCursor.getState().clear();
      switch (kind) {
        case "select":
          set({ tool: selectTool });
          break;
        case "wall":
          set({ tool: { kind, preset: defaultWallPreset(project), anchor: null, chainStart: null, typed: "" }, selectedId: null });
          break;
        case "room":
          set({ tool: { kind, preset: defaultWallPreset(project), anchor: null, roomType: "sala" }, selectedId: null });
          break;
        case "roof":
          set({ tool: { kind, anchor: null, roofType: "hip", pitch: 20 }, selectedId: null });
          break;
        case "floor":
          set({ tool: { kind, preset: { thickness: 0.12, materialId: "concrete" }, anchor: null }, selectedId: null });
          break;
        case "place":
          break; // use activateLibraryItem
      }
    },

    setToolOptions(patch) {
      const { tool } = get();
      if (tool.kind === "roof") {
        set({ tool: { ...tool, ...(patch.roofType ? { roofType: patch.roofType } : {}), ...(patch.pitch !== undefined ? { pitch: patch.pitch } : {}) } });
      } else if (tool.kind === "wall" || tool.kind === "room") {
        const { roomType, roofType: _r, pitch: _p, ...preset } = patch;
        set({
          tool: {
            ...tool,
            preset: { ...tool.preset, ...(preset as Partial<WallPreset>) },
            ...(tool.kind === "room" && roomType ? { roomType } : {}),
          } as Tool,
        });
      } else if (tool.kind === "floor") {
        set({ tool: { ...tool, preset: { ...tool.preset, ...(patch as Partial<FloorPreset>) } } });
      }
    },

    activateLibraryItem(itemId) {
      const item = getLibraryItem(itemId);
      const { project } = get();
      if (!item || !project) return;
      const spec = item.spec;
      useCursor.getState().clear();
      switch (spec.elementType) {
        case "wall":
          set({
            tool: { kind: "wall", preset: { height: spec.height, thickness: spec.thickness, materialId: spec.materialId }, anchor: null, chainStart: null, typed: "" },
            selectedId: null,
          });
          return;
        case "floor":
          set({ tool: { kind: "floor", preset: { thickness: spec.thickness, materialId: spec.materialId }, anchor: null }, selectedId: null });
          return;
        case "door":
        case "window": {
          // Com uma parede selecionada, insere direto no centro dela.
          const sel = selectedElement();
          if (sel && isWall(sel)) {
            let newId = "";
            get().commit((p) => {
              const opening = createOpening(p.elements, sel, spec, wallLength(sel) / 2);
              newId = opening.id;
              return addElements(p, [opening]);
            });
            if (newId) set({ selectedId: newId, tool: selectTool });
            return;
          }
          set({ tool: { kind: "place", itemId }, selectedId: null });
          return;
        }
        case "object":
          set({ tool: { kind: "place", itemId }, selectedId: null });
          return;
      }
    },

    cancelTool() {
      const { tool } = get();
      if ("anchor" in tool && tool.anchor) {
        set({ tool: { ...tool, anchor: null, ...(tool.kind === "wall" ? { chainStart: null, typed: "" } : {}) } as Tool });
      } else if (tool.kind !== "select") {
        set({ tool: selectTool });
        useCursor.getState().clear();
      } else {
        set({ selectedId: null });
      }
    },

    pointerMove(raw, mods) {
      const r = resolvePoint(raw, !!mods?.shift);
      useCursor.getState().set(r.point, r.kind);
    },

    pointerClick(raw, mods) {
      const { tool, project } = get();
      if (!project) return;
      const p = resolvePoint(raw, !!mods?.shift).point;

      switch (tool.kind) {
        case "select":
          return;

        case "wall": {
          if (!tool.anchor) {
            set({ tool: { ...tool, anchor: p, chainStart: p, typed: "" } });
            return;
          }
          if (samePoint(p, tool.anchor)) {
            get().finishChain();
            return;
          }
          if (!addWallSegment(tool.anchor, p, tool.preset)) return;
          const closed = tool.chainStart && samePoint(p, tool.chainStart);
          set({ tool: { ...tool, anchor: closed ? null : p, chainStart: closed ? null : tool.chainStart, typed: "" } });
          return;
        }

        case "room": {
          if (!tool.anchor) {
            set({ tool: { ...tool, anchor: p } });
            return;
          }
          const a = tool.anchor;
          let roomId = "";
          const ok = get().commit((proj) => {
            const { walls, room } = createRoomWithWalls(proj.elements, a, p, tool.roomType, { ...tool.preset, levelId: get().activeLevelId });
            roomId = room.id;
            return addElements(proj, [...walls, room]);
          });
          if (ok) set({ tool: { ...tool, anchor: null }, selectedId: roomId });
          return;
        }

        case "roof": {
          if (!tool.anchor) {
            set({ tool: { ...tool, anchor: p } });
            return;
          }
          const a = tool.anchor;
          const level = project.levels.find((l) => l.id === get().activeLevelId);
          const wallTop = Math.max(0, ...project.elements.filter((e): e is Wall => isWall(e) && e.levelId === get().activeLevelId).map((w) => w.baseElevation + w.height));
          let id = "";
          const ok = get().commit((proj) => {
            const roof = createRoof(proj.elements, a, p, { levelId: get().activeLevelId, baseHeight: wallTop || (level?.height ?? 3), roofType: tool.roofType, pitch: tool.pitch });
            id = roof.id;
            return addElements(proj, [roof]);
          });
          if (ok) set({ tool: selectTool, selectedId: id });
          return;
        }

        case "floor": {
          if (!tool.anchor) {
            set({ tool: { ...tool, anchor: p } });
            return;
          }
          const a = tool.anchor;
          let id = "";
          const ok = get().commit((proj) => {
            const floor = createFloor(proj.elements, a, p, { ...tool.preset, levelId: get().activeLevelId });
            id = floor.id;
            return addElements(proj, [floor]);
          });
          if (ok) set({ tool: selectTool, selectedId: id });
          return;
        }

        case "garage": {
          const plan = planGarage(tool.cars, tool.layout);
          const a = p;
          const b = { x: p.x + plan.width, y: p.y + plan.depth };
          let id = "";
          const ok = get().commit((proj) => {
            const { walls, room } = createRoomWithWalls(proj.elements, a, b, "garagem", { ...defaultWallPreset(proj), levelId: get().activeLevelId });
            let next = addElements(proj, [...walls, { ...room, name: `Garagem (${plan.cars} carro${plan.cars > 1 ? "s" : ""})` }]);
            id = room.id;
            const carItem = getLibraryItem("car");
            const gateItem = getLibraryItem("door-garage");
            if (carItem?.spec.elementType === "object") {
              for (const bay of plan.bays) {
                next = addElements(next, [{ ...createObject(next.elements, { ...carItem.spec, length: Math.min(carItem.spec.length, plan.depth - 0.6, 4.7) }, carItem.name, { x: a.x + bay.x, y: a.y + bay.y }, get().activeLevelId), rotation: bay.rotation }]);
              }
            }
            // Portões na parede frontal (menor Y): a parede pode ter sido segmentada por vizinhos; procura a que contém o ponto.
            if (gateItem?.spec.elementType === "door") {
              for (const gate of plan.gates) {
                const gx = a.x + gate.x;
                const wall = next.elements.find((e): e is Wall => isWall(e) && e.levelId === get().activeLevelId && Math.abs(e.start.y - a.y) < 1e-4 && Math.abs(e.end.y - a.y) < 1e-4 && Math.min(e.start.x, e.end.x) <= gx + 1e-6 && Math.max(e.start.x, e.end.x) >= gx - 1e-6);
                if (wall) next = addElements(next, [createOpening(next.elements, wall, { ...gateItem.spec, width: gate.width }, Math.abs(gx - Math.min(wall.start.x, wall.end.x)))]);
              }
            }
            return next;
          });
          if (ok) set({ tool: selectTool, selectedId: id });
          return;
        }

        case "place": {
          const item = getLibraryItem(tool.itemId);
          if (!item) return;
          const spec = item.spec;
          if (spec.elementType === "door" || spec.elementType === "window") {
            const hit = findNearestWall(project.elements.filter((e): e is Wall => isWall(e) && e.levelId === get().activeLevelId), raw, OPENING_PICK_DISTANCE);
            if (!hit) {
              notify("info", `Clique sobre uma parede para inserir: ${item.name}.`);
              return;
            }
            let id = "";
            const ok = get().commit((proj) => {
              const sized = tool.size ? { ...spec, width: tool.size.width, height: tool.size.height, ...(spec.elementType === "window" ? { sillHeight: tool.size.sillHeight ?? spec.sillHeight } : {}) } : spec;
              const opening = createOpening(proj.elements, hit.wall, sized as typeof spec, hit.along);
              id = opening.id;
              return addElements(proj, [opening]);
            });
            if (ok) set({ tool: selectTool, selectedId: id });
            return;
          }
          if (spec.elementType === "object") {
            let id = "";
            const ok = get().commit((proj) => {
              const obj = createObject(proj.elements, spec, item.name, p, get().activeLevelId);
              id = obj.id;
              return addElements(proj, [obj]);
            });
            if (ok) set({ tool: selectTool, selectedId: id });
          }
          return;
        }
      }
    },

    finishChain() {
      const { tool } = get();
      if (tool.kind === "wall") set({ tool: { ...tool, anchor: null, chainStart: null, typed: "" } });
    },

    /**
     * Entrada numérica durante o desenho de paredes (estilo CAD):
     * digite o comprimento e Enter para criar o segmento na direção do cursor.
     * Retorna true se a tecla foi consumida.
     */
    typeLength(key) {
      const { tool, project } = get();
      if (tool.kind !== "wall" || !tool.anchor || !project) return false;
      if (/^[0-9.,]$/.test(key) || (/^[mc]$/.test(key) && tool.typed.length > 0)) {
        set({ tool: { ...tool, typed: tool.typed + key } });
        return true;
      }
      if (key === "Backspace" && tool.typed) {
        set({ tool: { ...tool, typed: tool.typed.slice(0, -1) } });
        return true;
      }
      if (key === "Enter" && tool.typed) {
        const parsed = parseLength(tool.typed, project.settings.displayUnit);
        if (!parsed.ok || parsed.meters <= 0) {
          notify("error", parsed.ok ? "O comprimento deve ser positivo." : parsed.error);
          set({ tool: { ...tool, typed: "" } });
          return true;
        }
        const cursor = useCursor.getState().point;
        let dir = cursor ? normalize(sub(cursor, tool.anchor)) : { x: 1, y: 0 };
        if (dir.x === 0 && dir.y === 0) dir = { x: 1, y: 0 };
        // Rastreamento polar: direção arredondada a múltiplos de 15°.
        const step = Math.PI / 12;
        const angle = Math.round(Math.atan2(dir.y, dir.x) / step) * step;
        dir = { x: Math.cos(angle), y: Math.sin(angle) };
        const end = add(tool.anchor, scale(dir, parsed.meters));
        const rounded = { x: Math.round(end.x * 1e6) / 1e6, y: Math.round(end.y * 1e6) / 1e6 };
        if (addWallSegment(tool.anchor, rounded, tool.preset)) {
          const closed = tool.chainStart && samePoint(rounded, tool.chainStart, 1e-3);
          set({ tool: { ...tool, anchor: closed ? null : rounded, chainStart: closed ? null : tool.chainStart, typed: "" } });
        }
        return true;
      }
      return false;
    },

    markSaving: () => set({ saveStatus: "saving", saveError: null }),
    markSaved(revision, updatedAt) {
      const { project } = get();
      set({
        savedRevision: revision,
        saveStatus: get().revision === revision ? "saved" : "dirty",
        saveError: null,
        project: project ? { ...project, updatedAt } : project,
      });
    },
    markSaveError: (message) => set({ saveStatus: "error", saveError: message }),
  };
});

/** Elemento selecionado (seletor reutilizável). */
export const selectSelectedElement = (s: Pick<EditorState, "project" | "selectedId">): Element | null =>
  s.project?.elements.find((e) => e.id === s.selectedId) ?? null;
