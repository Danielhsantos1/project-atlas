import type { Element, Project, RoomType, Wall } from "@/core/model/schema";
import { createFloor, createLevel, createObject, createOpening, createProject, createRoof, createRoomWithWalls, createWall, GROUND_LEVEL_ID } from "@/core/model/factory";
import { addElements, addLevel } from "@/core/model/operations";
import { getLibraryItem, type LibrarySpec } from "@/core/library/catalog";
import { projectOnSegment, type Vec2 } from "@/core/geometry/vec";
import type { HouseBrief } from "./interpret";
import { DomainError } from "@/core/model/errors";

interface Spec {
  type: RoomType;
  name: string;
  w: number;
  d: number;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Gera um estudo preliminar editável a partir do briefing.
 * Estratégia "faixas": frente (garagem, sala, cozinha), corredor de distribuição,
 * fundos (quartos, banheiros, serviço). Sobrados levam os quartos para cima,
 * com escada no corredor e vão na laje com guarda-corpo.
 */
export function generateHouse(brief: HouseBrief, name = "Estudo preliminar — ATLAS AI", now = new Date()): Project {
  const H = 2.8;
  let p = createProject({ name, category: "residencial", description: "Gerado pelo ATLAS AI a partir de descrição em linguagem natural. Estudo preliminar, sem aprovação técnica.", site: { width: 30, depth: 40 }, defaultWallHeight: H, defaultWallThickness: 0.15, now });
  const T = GROUND_LEVEL_ID;
  let U = T;
  if (brief.floors === 2) {
    const up = createLevel(p.levels, "Pavimento superior");
    p = addLevel(p, up);
    U = up.id;
  }

  // ---- Programa de necessidades ----
  const front: Spec[] = [];
  if (brief.garageCars > 0) front.push({ type: "garagem", name: "Garagem", w: 3 * brief.garageCars, d: 5.5 });
  front.push({ type: "sala", name: "Sala", w: brief.largeLiving ? 6 : 5, d: 5 });
  front.push({ type: "cozinha", name: "Cozinha", w: 4, d: 5 });
  if (brief.gourmet) front.push({ type: "gourmet", name: "Área gourmet", w: 4, d: 5 });

  const intimate: Spec[] = [];
  for (let i = 1; i <= brief.suites; i++) {
    intimate.push({ type: "suite", name: brief.suites > 1 ? `Suíte ${i}` : "Suíte", w: 4, d: 4 });
    intimate.push({ type: "banheiro", name: brief.suites > 1 ? `Banheiro suíte ${i}` : "Banheiro da suíte", w: 2.2, d: 4 });
  }
  for (let i = 1; i <= brief.bedrooms; i++) intimate.push({ type: "quarto", name: `Quarto ${i + (brief.suites ? 1 : 0)}`, w: 3.4, d: 4 });
  for (let i = 1; i <= brief.bathrooms; i++) intimate.push({ type: "banheiro", name: brief.bathrooms > 1 ? `Banheiro ${i}` : "Banheiro social", w: 2.2, d: 4 });

  const service: Spec[] = [];
  if (brief.laundry) service.push({ type: "lavanderia", name: "Lavanderia", w: 2.4, d: 4 });
  if (brief.office) service.push({ type: "escritorio", name: "Escritório", w: 3.2, d: 4 });

  const backGround = brief.floors === 2 ? service : [...intimate, ...service];
  const backUpper = brief.floors === 2 ? intimate : [];

  // ---- Ajuste de escala para a área desejada ----
  const natural = [...front, ...backGround, ...backUpper].reduce((s, r) => s + r.w * r.d, 0);
  const k = brief.targetArea ? Math.min(1.35, Math.max(0.8, Math.sqrt((brief.targetArea * 0.82) / natural))) : 1;
  for (const r of [...front, ...backGround, ...backUpper]) {
    r.w = r1(r.w * k);
    r.d = r1(r.d * k);
  }

  const X0 = 4;
  const Y0 = 6;
  const CORR = 1.4;
  const rowDepth = (rs: Spec[]) => Math.max(0, ...rs.map((r) => r.d));
  const rowWidth = (rs: Spec[]) => rs.reduce((s, r) => s + r.w, 0);
  const W = r1(Math.max(rowWidth(front), rowWidth(backGround), rowWidth(backUpper), brief.floors === 2 ? 9 : 0));
  // Distribui a largura excedente na última peça de cada faixa (paredes alinhadas).
  const stretch = (rs: Spec[]) => {
    const last = rs[rs.length - 1];
    if (last) last.w = r1(last.w + W - rowWidth(rs));
  };
  stretch(front);
  stretch(backGround);
  stretch(backUpper);
  const yFront = Y0;
  const yCorr = r1(Y0 + rowDepth(front));
  const yBack = r1(yCorr + CORR);

  const wallOpts = (levelId: string) => ({ height: H, thickness: 0.15, materialId: "paint-white", levelId });
  const add = (els: Element[]) => (p = addElements(p, els));
  const placeRow = (levelId: string, rs: Spec[], y: number) => {
    let x = X0;
    const placed: Array<Spec & { x: number; y: number }> = [];
    const depth = rowDepth(rs);
    for (const r of rs) {
      const { walls, room } = createRoomWithWalls(p.elements, { x, y }, { x: x + r.w, y: y + depth }, r.type, wallOpts(levelId));
      add([...walls, { ...room, name: r.name }]);
      placed.push({ ...r, x, y, d: depth });
      x = r1(x + r.w);
    }
    return placed;
  };
  const wallAt = (levelId: string, at: Vec2) =>
    p.elements.find((e): e is Wall => e.type === "wall" && e.levelId === levelId && projectOnSegment(at, e.start, e.end).distance < 1e-3) ?? null;
  const opening = (levelId: string, at: Vec2, itemId: string, override: Record<string, unknown> = {}) => {
    const item = getLibraryItem(itemId);
    const host = wallAt(levelId, at);
    if (!item || !host || (item.spec.elementType !== "door" && item.spec.elementType !== "window")) return;
    const spec = { ...item.spec, ...override } as Extract<LibrarySpec, { elementType: "door" | "window" }>;
    try {
      add([createOpening(p.elements, host, spec, projectOnSegment(at, host.start, host.end).along)]);
    } catch (error) {
      // Abertura que não cabe (cômodo pequeno): o estudo segue sem ela e o verificador avisará.
      if (!(error instanceof DomainError)) throw error;
    }
  };
  const obj = (levelId: string, itemId: string, at: Vec2, rotation = 0, override: Record<string, unknown> = {}) => {
    const item = getLibraryItem(itemId);
    if (!item || item.spec.elementType !== "object") return;
    add([{ ...createObject(p.elements, { ...item.spec, ...override } as Extract<LibrarySpec, { elementType: "object" }>, item.name, at, levelId), rotation }]);
  };

  // ---- Térreo ----
  const f = placeRow(T, front, yFront);
  // Corredor de distribuição.
  const corr = createRoomWithWalls(p.elements, { x: X0, y: yCorr }, { x: X0 + W, y: yBack }, "circulacao", wallOpts(T));
  add([...corr.walls, { ...corr.room, name: "Circulação" }]);
  const b = backGround.length ? placeRow(T, backGround, yBack) : [];

  for (const r of f) {
    const cx = r1(r.x + r.w / 2);
    if (r.type === "garagem") opening(T, { x: cx, y: yFront }, "door-garage", { width: Math.min(r.w - 0.6, 2.6 * brief.garageCars) });
    if (r.type === "sala") {
      opening(T, { x: r1(r.x + 1.1), y: yFront }, "door-90");
      opening(T, { x: r1(r.x + r.w * 0.65), y: yFront }, "window-200x220", { width: Math.min(2.4, r.w * 0.45) });
      opening(T, { x: cx, y: yCorr }, "passage-120");
      obj(T, "sofa-3", { x: cx, y: r1(yCorr - 1.2) }, 0);
    }
    if (r.type === "cozinha") {
      opening(T, { x: r.x, y: r1(yFront + r.d / 2) }, brief.integratedKitchen ? "passage-300" : "door-80", brief.integratedKitchen ? { width: Math.min(3, r.d - 1) } : {});
      opening(T, { x: cx, y: yFront }, "window-120x120");
      opening(T, { x: cx, y: yCorr }, "door-80");
      obj(T, brief.integratedKitchen ? "kitchen-island" : "countertop-kitchen", { x: cx, y: r1(yFront + r.d / 2) }, 0, { length: Math.min(2, r.w - 1.2) });
    }
    if (r.type === "gourmet") {
      opening(T, { x: r.x, y: r1(yFront + r.d / 2) }, "door-sliding-200");
      opening(T, { x: r1(r.x + r.w), y: r1(yFront + r.d / 2) }, "passage-300", { width: Math.min(2.6, r.d - 1) });
      obj(T, "grill", { x: r1(r.x + r.w / 2), y: r1(yFront + r.d - 0.5) }, 180);
    }
    if (r.type === "garagem") for (let c = 0; c < brief.garageCars; c++) obj(T, "car", { x: r1(r.x + 1.5 + c * 3), y: r1(yFront + r.d / 2) }, 90, { length: Math.min(4.5, r.d - 0.6) });
  }
  const roomsBack = (levelId: string, rs: Array<Spec & { x: number; y: number }>) => {
    for (const r of rs) {
      const cx = r1(r.x + r.w / 2);
      const isBath = r.type === "banheiro";
      const suiteBath = isBath && r.name.toLowerCase().includes("suíte");
      if (!suiteBath) opening(levelId, { x: cx, y: r.y }, isBath ? "door-70" : "door-80");
      else opening(levelId, { x: r.x, y: r1(r.y + r.d / 2) }, "door-70");
      opening(levelId, { x: cx, y: r1(r.y + r.d) }, isBath ? "window-60x60" : "window-150x120", isBath ? {} : { width: Math.min(1.5, r.w - 0.8) });
      if (r.type === "quarto" || r.type === "suite") obj(levelId, "bed-queen", { x: cx, y: r1(r.y + r.d - 1.1) }, 0);
      if (isBath) obj(levelId, "toilet", { x: r1(r.x + 0.4), y: r1(r.y + r.d - 0.5) }, 270);
    }
  };
  roomsBack(T, b);

  // ---- Pavimento superior ----
  if (brief.floors === 2) {
    const sx0 = r1(X0 + W - 4.6); // vão da escada no corredor (lado leste)
    obj(T, "stair-straight", { x: r1(X0 + W - 2.5), y: r1(yCorr + CORR / 2) }, 180, { height: p.levels[0]!.height, length: 4.2, width: 1.0 });
    const slab = (a: Vec2, c: Vec2) => add([createFloor(p.elements, a, c, { materialId: "concrete", thickness: 0.12, levelId: U })]);
    const yEnd = r1(yBack + Math.max(rowDepth(backUpper), 3));
    slab({ x: X0, y: yFront }, { x: X0 + W, y: yCorr });
    slab({ x: X0, y: yCorr }, { x: sx0, y: yBack });
    slab({ x: X0, y: yBack }, { x: X0 + W, y: yEnd });
    const up = placeRow(U, backUpper, yBack);
    const c2 = createRoomWithWalls(p.elements, { x: X0, y: yCorr }, { x: X0 + W, y: yBack }, "circulacao", wallOpts(U));
    add([...c2.walls, { ...c2.room, name: "Circulação superior", seed: { x: r1(X0 + 1), y: r1(yCorr + CORR / 2) } }]);
    // Fachada frontal do superior (sem cômodos na frente: varanda técnica fechada).
    add([createWall(p.elements, { x: X0, y: yFront }, { x: X0 + W, y: yFront }, { ...wallOpts(U), height: 1.1, materialId: "glass-clear", thickness: 0.06 })]);
    add([createWall(p.elements, { x: X0, y: yFront }, { x: X0, y: yCorr }, { ...wallOpts(U), height: 1.1, materialId: "glass-clear", thickness: 0.06 })]);
    add([createWall(p.elements, { x: X0 + W, y: yFront }, { x: X0 + W, y: yCorr }, { ...wallOpts(U), height: 1.1, materialId: "glass-clear", thickness: 0.06 })]);
    const rail = { ...wallOpts(U), height: 1.1, materialId: "glass-clear", thickness: 0.06 };
    add([createWall(p.elements, { x: sx0, y: yCorr }, { x: sx0, y: yBack }, rail)]);
    opening(U, { x: sx0, y: r1(yCorr + CORR / 2) }, "passage-120", { width: 1.0, height: 1.1 });
    opening(U, { x: r1(X0 + 1.5), y: yCorr }, "door-sliding-200", { width: 1.6, height: 2.2 });
    roomsBack(U, up);
    add([createRoof(p.elements, { x: X0, y: yFront }, { x: X0 + W, y: yEnd }, { levelId: U, baseHeight: H, roofType: "hip", pitch: 18, overhang: 0.6 })]);
  } else {
    const yEnd = r1(yBack + rowDepth(backGround));
    add([createRoof(p.elements, { x: X0, y: yFront }, { x: X0 + W, y: yEnd }, { levelId: T, baseHeight: H, roofType: "hip", pitch: 20, overhang: 0.6 })]);
  }

  // ---- Externo ----
  const backEdge = r1(yBack + Math.max(rowDepth(backGround), rowDepth(backUpper), 3));
  add([createFloor(p.elements, { x: 0, y: 0 }, { x: 30, y: 40 }, { materialId: "grass", thickness: 0.05, levelId: T })]);
  if (brief.pool) obj(T, "pool-8x4", { x: r1(X0 + Math.min(W, 12) / 2), y: r1(backEdge + 4) }, 0, { length: Math.min(8, Math.max(4, W - 2)) });
  obj(T, "tree", { x: 2, y: 2 }, 0);
  obj(T, "tree", { x: 28, y: 2 }, 0);
  return p;
}
