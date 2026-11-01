"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Maximize, Ruler } from "lucide-react";
import type { BuildingObject, Floor, Opening, Roof, Room, Wall } from "@/core/model/schema";
import { roomShape, type RoomShape } from "@/core/geometry/rooms";
import { rectCorners } from "@/core/geometry/shapes";
import { ROOM_TYPE_INFO } from "@/core/model/factory";
import { isWall } from "@/core/model/schema";
import { getLibraryItem } from "@/core/library/catalog";
import {
  computeWallJoins,
  openingHoles,
  wallFrame,
  wallLocalToPlan,
  wallPlanCut,
  wallSegmentPolygon,
  type WallExtension,
} from "@/core/geometry/wall";
import { floorArea, floorCorners, projectBounds } from "@/core/geometry/shapes";
import { objectParts } from "@/core/geometry/objects";
import { add, normalize, scale as vscale, type Vec2 } from "@/core/geometry/vec";
import { formatArea, formatLength, type LengthUnit } from "@/core/units/units";
import { cn } from "@/lib/cn";
import { useEditor } from "../store";
import { useCursor } from "../cursor";

interface View {
  cx: number;
  cy: number;
  /** pixels por metro */
  s: number;
}

const ACCENT = "#2f80ff";
const WALL_FILL = "#c3cad4";
const WALL_HOVER = "#e3e8ef";
/** Altura do plano de corte da planta (m). */
const CUT_HEIGHT = 1.2;

const pts = (ps: Vec2[]) => ps.map((p) => `${p.x},${p.y}`).join(" ");

/** Ângulo legível para textos (nunca de cabeça para baixo). */
function readable(angle: number): number {
  let a = ((angle % 360) + 360) % 360;
  if (a > 90 && a <= 270) a -= 180;
  return a > 180 ? a - 360 : a;
}

export default function FloorPlan2D() {
  const project = useEditor((s) => s.project);
  const selectedId = useEditor((s) => s.selectedId);
  const hoveredId = useEditor((s) => s.hoveredId);
  const tool = useEditor((s) => s.tool);
  const camera = useEditor((s) => s.camera);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View | null>(null);
  const [showDims, setShowDims] = useState(true);
  const gesture = useRef<
    | { kind: "pan"; startX: number; startY: number; view: View }
    | { kind: "drag"; id: string; start: Vec2; moved: boolean }
    | { kind: "create"; startX: number; startY: number }
    | null
  >(null);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setSize({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fit = useCallback(() => {
    const st = useEditor.getState();
    const p = st.project;
    if (!p || size.w === 0) return;
    // Enquadra o pavimento ativo; gramados e calçadas que cobrem o terreno todo não contam.
    const onLevel = p.elements.filter((e) => "levelId" in e && e.levelId === st.activeLevelId && !(e.type === "floor" && (e.materialId === "grass" || e.materialId === "paving-stone")));
    const upper = p.levels.some((l) => l.elevation > (p.levels.find((x) => x.id === st.activeLevelId)?.elevation ?? 0) - 1e-9 && l.id !== p.levels[0]?.id);
    const b = projectBounds({ elements: upper || onLevel.length > 0 ? onLevel : p.elements });
    const min = b ? b.min : { x: 0, y: 0 };
    const max = b ? b.max : { x: p.site.width, y: p.site.depth };
    const bw = Math.max(max.x - min.x, 1);
    const bh = Math.max(max.y - min.y, 1);
    setView({
      cx: (min.x + max.x) / 2,
      cy: (min.y + max.y) / 2,
      s: Math.min(Math.max(Math.min(size.w / (bw * 1.35), size.h / (bh * 1.35)), 2), 1500),
    });
  }, [size.w, size.h]);

  // Enquadra ao abrir, ao pedir "enquadrar" (tecla F) e ao trocar de pavimento.
  const levelForFit = useEditor((s) => s.activeLevelId);
  useEffect(() => {
    fit();
  }, [fit, camera.nonce, levelForFit]);

  const toDomain = useCallback(
    (clientX: number, clientY: number): Vec2 | null => {
      const svg = svgRef.current;
      if (!svg || !view) return null;
      const r = svg.getBoundingClientRect();
      return { x: (clientX - r.left - size.w / 2) / view.s + view.cx, y: -(clientY - r.top - size.h / 2) / view.s + view.cy };
    },
    [view, size],
  );

  // Zoom com a roda do mouse, mantendo fixo o ponto sob o cursor.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setView((v) => {
        if (!v) return v;
        const r = svg.getBoundingClientRect();
        const sx = e.clientX - r.left - r.width / 2;
        const sy = e.clientY - r.top - r.height / 2;
        const px = sx / v.s + v.cx;
        const py = -sy / v.s + v.cy;
        const s = Math.min(Math.max(v.s * Math.pow(1.0018, -e.deltaY), 2), 3000);
        return { s, cx: px - sx / s, cy: py + sy / s };
      });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

  const hitId = (target: EventTarget | null) => (target as SVGElement | null)?.closest?.("[data-el]")?.getAttribute("data-el") ?? null;

  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    const p = toDomain(e.clientX, e.clientY);
    if (!p || !view) return;
    const s = useEditor.getState();
    if (e.button === 1 || e.button === 2 || (e.button === 0 && s.tool.kind === "select" && !hitId(e.target))) {
      if (e.button === 0) s.select(null);
      gesture.current = { kind: "pan", startX: e.clientX, startY: e.clientY, view };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0) return;
    if (s.tool.kind === "select") {
      const id = hitId(e.target)!;
      const target = s.project?.elements.find((el) => el.id === id);
      if (target?.type === "room") {
        // Ambientes não se arrastam (são definidos pelas paredes): só seleciona.
        s.select(id);
        return;
      }
      s.select(id);
      s.beginDrag();
      gesture.current = { kind: "drag", id, start: p, moved: false };
      e.currentTarget.setPointerCapture(e.pointerId);
    } else {
      const rectTool = (s.tool.kind === "room" || s.tool.kind === "floor" || s.tool.kind === "roof") && !s.tool.anchor;
      s.pointerClick(p, { shift: e.shiftKey });
      if (rectTool) {
        gesture.current = { kind: "create", startX: e.clientX, startY: e.clientY };
        e.currentTarget.setPointerCapture(e.pointerId);
      }
    }
  }

  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const p = toDomain(e.clientX, e.clientY);
    if (!p) return;
    const s = useEditor.getState();
    s.pointerMove(p, { shift: e.shiftKey });
    const g = gesture.current;
    if (g?.kind === "pan") {
      setView({ ...g.view, cx: g.view.cx - (e.clientX - g.startX) / g.view.s, cy: g.view.cy + (e.clientY - g.startY) / g.view.s });
    } else if (g?.kind === "drag") {
      const settings = s.project!.settings;
      let d = { x: p.x - g.start.x, y: p.y - g.start.y };
      if (settings.snapToGrid) {
        const step = settings.gridSize;
        d = { x: Math.round(d.x / step) * step, y: Math.round(d.y / step) * step };
      }
      if (Math.abs(d.x) > 1e-9 || Math.abs(d.y) > 1e-9 || g.moved) {
        g.moved = true;
        s.dragMove(g.id, d);
      }
    } else {
      s.hover(s.tool.kind === "select" ? hitId(e.target) : null);
    }
  }

  function onPointerUp(e: React.PointerEvent<SVGSVGElement>) {
    const g = gesture.current;
    if (g?.kind === "drag") useEditor.getState().endDrag();
    // Arrastar para criar: soltar o botão define o segundo canto.
    if (g?.kind === "create" && Math.hypot(e.clientX - g.startX, e.clientY - g.startY) > 12) {
      const p = toDomain(e.clientX, e.clientY);
      if (p) useEditor.getState().pointerClick(p, { shift: e.shiftKey });
    }
    gesture.current = null;
  }

  const activeLevelId = useEditor((s) => s.activeLevelId);
  const model = useMemo(() => {
    const els = project?.elements ?? [];
    const levels = project?.levels ?? [];
    const walls = els.filter((e): e is Wall => isWall(e) && e.levelId === activeLevelId);
    const wallIds = new Set(walls.map((w) => w.id));
    const openings = els.filter((e): e is Opening => (e.type === "door" || e.type === "window") && wallIds.has(e.hostId));
    // Pavimento imediatamente abaixo, desenhado como referência (fantasma).
    const active = levels.find((l) => l.id === activeLevelId);
    const below = levels.filter((l) => active && l.elevation < active.elevation).at(-1);
    return {
      walls,
      openings,
      joins: computeWallJoins(walls),
      floors: els.filter((e): e is Floor => e.type === "floor" && e.levelId === activeLevelId),
      objects: els.filter((e): e is BuildingObject => e.type === "object" && e.levelId === activeLevelId),
      rooms: els
        .filter((e): e is Room => e.type === "room" && e.levelId === activeLevelId)
        .map((room) => ({ room, shape: roomShape(walls, room.seed) })),
      roofs: els.filter((e): e is Roof => e.type === "roof" && e.levelId === activeLevelId),
      ghostWalls: below ? els.filter((e): e is Wall => isWall(e) && e.levelId === below.id) : [],
      wallById: new Map(walls.map((w) => [w.id, w])),
    };
  }, [project?.elements, project?.levels, activeLevelId]);

  if (!project) return null;
  const unit = project.settings.displayUnit;
  const v = view;
  const selected = project.elements.find((e) => e.id === selectedId) ?? null;
  const chainWall: Wall | null = selected
    ? isWall(selected)
      ? selected
      : selected.type === "door" || selected.type === "window"
        ? (model.wallById.get(selected.hostId) ?? null)
        : null
    : null;

  return (
    <div className="relative size-full overflow-hidden bg-[#0d1014]" data-testid="viewport-2d">
      <svg
        ref={svgRef}
        className="plan-svg size-full touch-none select-none"
        style={{ cursor: tool.kind === "select" ? (gesture.current?.kind === "pan" ? "grabbing" : "default") : "crosshair" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => {
          useCursor.getState().clear();
          useEditor.getState().hover(null);
        }}
        onDoubleClick={() => useEditor.getState().finishChain()}
        onContextMenu={(e) => e.preventDefault()}
      >
        {v && size.w > 0 && (
          <g transform={`translate(${size.w / 2} ${size.h / 2}) scale(${v.s} ${-v.s}) translate(${-v.cx} ${-v.cy})`}>
            <PlanGrid view={v} size={size} gridSize={project.settings.gridSize} />
            <rect x={0} y={0} width={project.site.width} height={project.site.depth} fill="none" stroke="#5a6b85" strokeWidth={1} strokeDasharray="6 4" />

            {model.ghostWalls.map((w) => (
              <line key={`g${w.id}`} x1={w.start.x} y1={w.start.y} x2={w.end.x} y2={w.end.y} stroke="#3a4555" strokeWidth={2} strokeDasharray="4 4" pointerEvents="none" />
            ))}
            {model.floors.map((f) => (
              <FloorShape key={f.id} floor={f} state={stateOf(f.id, selectedId, hoveredId)} s={v.s} />
            ))}
            {model.rooms.map(({ room, shape }) => (
              <RoomShapeView key={room.id} room={room} shape={shape} state={stateOf(room.id, selectedId, hoveredId)} s={v.s} />
            ))}
            {model.objects.map((o) => (
              <ObjectShape key={o.id} obj={o} state={stateOf(o.id, selectedId, hoveredId)} s={v.s} />
            ))}
            {model.walls.map((w) => (
              <WallShape key={w.id} wall={w} openings={model.openings} ext={model.joins.get(w.id)!} state={stateOf(w.id, selectedId, hoveredId)} />
            ))}
            {model.openings.map((o) => {
              const host = model.wallById.get(o.hostId);
              return host ? <OpeningShape key={o.id} opening={o} wall={host} state={stateOf(o.id, selectedId, hoveredId)} /> : null;
            })}
            {model.roofs.map((r) => (
              <RoofOutline key={r.id} roof={r} state={stateOf(r.id, selectedId, hoveredId)} />
            ))}
            {showDims && model.walls.map((w) => <WallDimension key={w.id} wall={w} s={v.s} unit={unit} />)}
            {chainWall && <OpeningChain wall={chainWall} openings={model.openings} s={v.s} unit={unit} />}
            <PlanToolPreview s={v.s} unit={unit} />
          </g>
        )}
      </svg>

      <div className="pointer-events-none absolute bottom-14 left-3 flex items-center gap-2">
        <span className="rounded-md border border-ink-700 bg-ink-850/90 px-2 py-1 text-[11.5px] text-fg-muted backdrop-blur">
          Planta baixa · corte a {formatLength(CUT_HEIGHT, unit)}
        </span>
        <button
          className={cn("pointer-events-auto flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11.5px] backdrop-blur", showDims ? "border-accent-line bg-accent-soft text-accent" : "border-ink-700 bg-ink-850/90 text-fg-muted")}
          onClick={() => setShowDims((d) => !d)}
          aria-pressed={showDims}
        >
          <Ruler size={13} /> Cotas
        </button>
      </div>

      <NorthArrow />
      {v && <ScaleBar s={v.s} unit={unit} />}
      <div className="absolute right-3 bottom-3 flex items-center gap-2">
        {v && <span className="rounded-md border border-ink-700 bg-ink-850/90 px-2 py-1 font-mono text-[11px] text-fg-muted">{Math.round(v.s)} px/m</span>}
        <button onClick={fit} className="flex items-center gap-1.5 rounded-md border border-ink-700 bg-ink-850/90 px-2 py-1 text-[11.5px] text-fg-muted hover:text-fg" title="Enquadrar (F)">
          <Maximize size={13} /> Enquadrar
        </button>
      </div>
    </div>
  );
}

type ShapeState = "none" | "hover" | "selected";
const stateOf = (id: string, sel: string | null, hov: string | null): ShapeState => (id === sel ? "selected" : id === hov ? "hover" : "none");

/** Texto em pixels de tela posicionado em coordenadas do projeto. */
function Txt({ at, s, angle = 0, size = 11, fill = "#e8ebf0", children, weight }: { at: Vec2; s: number; angle?: number; size?: number; fill?: string; children: React.ReactNode; weight?: number }) {
  return (
    <text
      transform={`translate(${at.x} ${at.y}) scale(${1 / s} ${-1 / s}) rotate(${-angle})`}
      fontSize={size}
      fill={fill}
      fontWeight={weight}
      textAnchor="middle"
      dominantBaseline="central"
      style={{ fontFamily: "var(--font-geist-mono)", paintOrder: "stroke", stroke: "#0d1014", strokeWidth: 3 }}
    >
      {children}
    </text>
  );
}

function PlanGrid({ view, size, gridSize }: { view: View; size: { w: number; h: number }; gridSize: number }) {
  const minor = [gridSize, 0.5, 1, 5, 10, 50, 100].find((st) => st >= gridSize && st * view.s >= 9) ?? 100;
  const major = [1, 5, 10, 50, 100, 500].find((st) => st >= minor * 4 && st * view.s >= 60) ?? 500;
  const x0 = view.cx - size.w / 2 / view.s;
  const x1 = view.cx + size.w / 2 / view.s;
  const y0 = view.cy - size.h / 2 / view.s;
  const y1 = view.cy + size.h / 2 / view.s;
  const lines = (step: number) => {
    let d = "";
    for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) d += `M${x} ${y0}V${y1}`;
    for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) d += `M${x0} ${y}H${x1}`;
    return d;
  };
  return (
    <g pointerEvents="none">
      <path d={lines(minor)} stroke="#1a1f26" strokeWidth={1} />
      <path d={lines(major)} stroke="#252d38" strokeWidth={1} />
      <path d={`M${x0} 0H${x1}`} stroke="#ff4d5e" strokeOpacity={0.5} strokeWidth={1} />
      <path d={`M0 ${y0}V${y1}`} stroke="#4cd964" strokeOpacity={0.5} strokeWidth={1} />
    </g>
  );
}

function FloorShape({ floor, state, s }: { floor: Floor; state: ShapeState; s: number }) {
  return (
    <g data-el={floor.id}>
      <polygon
        points={pts(floorCorners(floor))}
        fill={state === "selected" ? "rgb(47 128 255 / 0.16)" : state === "hover" ? "#1e2836" : "#161d27"}
        stroke={state === "selected" ? ACCENT : "#34404f"}
        strokeWidth={state === "selected" ? 2 : 1}
      />
      <Txt at={floor.position} s={s} size={10.5} fill="#6c7584">{formatArea(floorArea(floor))}</Txt>
    </g>
  );
}

function ObjectShape({ obj, state, s }: { obj: BuildingObject; state: ShapeState; s: number }) {
  const parts = objectParts(obj);
  const stroke = state === "selected" ? ACCENT : state === "hover" ? "#e8ebf0" : "#9aa3b2";
  return (
    <g data-el={obj.id}>
      <g transform={`translate(${obj.position.x} ${obj.position.y}) rotate(${obj.rotation})`}>
        <rect x={-obj.length / 2} y={-obj.width / 2} width={obj.length} height={obj.width} fill={state === "selected" ? "rgb(47 128 255 / 0.12)" : "rgb(255 255 255 / 0.02)"} stroke={state === "selected" ? ACCENT : "none"} strokeDasharray="4 3" />
        {parts.map((p, i) =>
          p.shape === "box" ? (
            <rect key={i} x={p.x - p.sx / 2} y={p.y - p.sy / 2} width={p.sx} height={p.sy} fill="none" stroke={stroke} strokeWidth={1} />
          ) : (
            <ellipse key={i} cx={p.x} cy={p.y} rx={p.sx / 2} ry={p.sy / 2} fill="none" stroke={stroke} strokeWidth={1} />
          ),
        )}
      </g>
      {state !== "none" && <Txt at={{ x: obj.position.x, y: obj.position.y }} s={s} size={10} fill={stroke}>{obj.name}</Txt>}
    </g>
  );
}

function centroid(poly: Vec2[]): Vec2 {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    const k = p.x * q.y - q.x * p.y;
    a += k;
    cx += (p.x + q.x) * k;
    cy += (p.y + q.y) * k;
  }
  return Math.abs(a) < 1e-9 ? poly[0]! : { x: cx / (3 * a), y: cy / (3 * a) };
}

function RoomShapeView({ room, shape, state, s }: { room: Room; shape: RoomShape | null; state: ShapeState; s: number }) {
  const color = ROOM_TYPE_INFO[room.roomType].color;
  if (!shape) {
    return (
      <g data-el={room.id}>
        <circle cx={room.seed.x} cy={room.seed.y} r={8 / s} fill="#f5b544" />
        <Txt at={{ x: room.seed.x, y: room.seed.y - 18 / s }} s={s} size={10.5} fill="#f5b544">{room.name} (aberto)</Txt>
      </g>
    );
  }
  const c = centroid(shape.inner);
  return (
    <g data-el={room.id} data-testid="plan-room">
      <polygon points={pts(shape.inner)} fill={color} fillOpacity={state === "selected" ? 0.32 : state === "hover" ? 0.22 : 0.13} stroke={state === "selected" ? ACCENT : "none"} strokeWidth={2} />
      <Txt at={{ x: c.x, y: c.y + 8 / s }} s={s} size={12} weight={600} fill="#e8ebf0">{room.name}</Txt>
      <Txt at={{ x: c.x, y: c.y - 8 / s }} s={s} size={10.5} fill="#a1a9b6">{formatArea(shape.area)}</Txt>
    </g>
  );
}

function RoofOutline({ roof, state }: { roof: Roof; state: ShapeState }) {
  const corners = rectCorners(roof.position, roof.width + roof.overhang * 2, roof.depth + roof.overhang * 2, roof.rotation);
  const color = state === "selected" ? ACCENT : state === "hover" ? "#e8ebf0" : "#b8664a";
  return (
    <g data-el={roof.id}>
      <polygon points={pts(corners)} fill="none" stroke={color} strokeWidth={2.5} strokeDasharray="10 5" />
    </g>
  );
}

function WallShape({ wall, openings, ext, state }: { wall: Wall; openings: Opening[]; ext: WallExtension; state: ShapeState }) {
  const spans = wallPlanCut(wall, openings, ext, CUT_HEIGHT);
  const fill = state === "selected" ? ACCENT : state === "hover" ? WALL_HOVER : WALL_FILL;
  return (
    <g data-el={wall.id}>
      {spans.map((sp, i) => (
        <polygon key={i} points={pts(wallSegmentPolygon(wall, sp.u0, sp.u1))} fill={fill} stroke={fill} strokeWidth={0.5} />
      ))}
    </g>
  );
}

function OpeningShape({ opening, wall, state }: { opening: Opening; wall: Wall; state: ShapeState }) {
  const f = wallFrame(wall);
  const t = wall.thickness / 2;
  const hole = openingHoles(wall, [opening])[0];
  if (!hole) return null;
  const { u0, u1 } = hole;
  const color = state === "selected" ? ACCENT : state === "hover" ? "#ffffff" : "#d5dae2";
  const L = (u: number, n: number) => wallLocalToPlan(f, u, n);
  const cut = hole.v0 <= CUT_HEIGHT && hole.v1 >= CUT_HEIGHT;

  let symbol: React.ReactNode;
  if (opening.type === "door" && opening.style === "opening") {
    symbol = (
      <>
        <line {...seg(L(u0, -t), L(u0, t))} stroke={color} strokeWidth={1} strokeDasharray="3 3" />
        <line {...seg(L(u1, -t), L(u1, t))} stroke={color} strokeWidth={1} strokeDasharray="3 3" />
      </>
    );
  } else if (opening.type === "door" && opening.style === "sliding") {
    const mid = (u0 + u1) / 2;
    symbol = (
      <>
        <line {...seg(L(u0, t / 4), L(mid + 0.05, t / 4))} stroke={color} strokeWidth={2} />
        <line {...seg(L(mid - 0.05, -t / 4), L(u1, -t / 4))} stroke={color} strokeWidth={2} />
        <line {...seg(L(u0, -t), L(u0, t))} stroke={color} strokeWidth={1} />
        <line {...seg(L(u1, -t), L(u1, t))} stroke={color} strokeWidth={1} />
      </>
    );
  } else if (opening.type === "door") {
    const side = opening.opensTo === "left" ? 1 : -1;
    const hingeU = opening.hinge === "left" ? u0 : u1;
    const otherU = opening.hinge === "left" ? u1 : u0;
    const w = u1 - u0;
    const pivot = L(hingeU, side * t);
    const leafEnd = L(hingeU, side * (t + w));
    // Arco de abertura (polilinha) do fim da folha até o batente oposto.
    const arc: Vec2[] = [];
    const a0 = { x: f.normal.x * side, y: f.normal.y * side };
    const a1 = vscale(f.dir, Math.sign(otherU - hingeU));
    for (let i = 0; i <= 18; i++) {
      const k = i / 18;
      const dir = normalize({ x: a0.x * Math.cos((k * Math.PI) / 2) + a1.x * Math.sin((k * Math.PI) / 2), y: a0.y * Math.cos((k * Math.PI) / 2) + a1.y * Math.sin((k * Math.PI) / 2) });
      arc.push(add(pivot, vscale(dir, w)));
    }
    symbol = (
      <>
        <line x1={pivot.x} y1={pivot.y} x2={leafEnd.x} y2={leafEnd.y} stroke={color} strokeWidth={2} />
        <polyline points={pts(arc)} fill="none" stroke={color} strokeWidth={1} strokeDasharray="3 3" />
        <line {...seg(L(u0, -t), L(u0, t))} stroke={color} strokeWidth={1} />
        <line {...seg(L(u1, -t), L(u1, t))} stroke={color} strokeWidth={1} />
      </>
    );
  } else {
    const dash = cut ? undefined : "5 3";
    symbol = (
      <>
        <polygon points={pts([L(u0, t), L(u1, t), L(u1, -t), L(u0, -t)])} fill={cut ? "#0d1014" : "none"} stroke={color} strokeWidth={1} strokeDasharray={dash} />
        <line {...seg(L(u0, t / 3), L(u1, t / 3))} stroke={color} strokeWidth={1} strokeDasharray={dash} />
        <line {...seg(L(u0, -t / 3), L(u1, -t / 3))} stroke={color} strokeWidth={1} strokeDasharray={dash} />
      </>
    );
  }
  return (
    <g data-el={opening.id}>
      <polygon points={pts(wallSegmentPolygon(wall, u0, u1))} fill="transparent" />
      {symbol}
    </g>
  );
}

const seg = (a: Vec2, b: Vec2) => ({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });

/** Cota do comprimento da parede, do lado direito do eixo (externo em ambientes anti-horários). */
function WallDimension({ wall, s, unit }: { wall: Wall; s: number; unit: LengthUnit }) {
  const f = wallFrame(wall);
  const px = (n: number) => n / s;
  const off = -(wall.thickness / 2 + px(22));
  return <DimLine f={f} u0={0} u1={f.length} n={off} faceN={-wall.thickness / 2} s={s} label={formatLength(f.length, unit)} />;
}

/** Cotas parciais (afastamentos e larguras das aberturas) da parede ativa. */
function OpeningChain({ wall, openings, s, unit }: { wall: Wall; openings: Opening[]; s: number; unit: LengthUnit }) {
  const f = wallFrame(wall);
  const holes = openingHoles(wall, openings).sort((a, b) => a.u0 - b.u0);
  if (holes.length === 0) return null;
  const marks = [0, ...holes.flatMap((h) => [h.u0, h.u1]), f.length];
  const n = wall.thickness / 2 + 22 / s;
  return (
    <g pointerEvents="none">
      {marks.slice(0, -1).map((u, i) => {
        const u1 = marks[i + 1]!;
        if (u1 - u < 1e-6) return null;
        return <DimLine key={i} f={f} u0={u} u1={u1} n={n} faceN={wall.thickness / 2} s={s} label={formatLength(u1 - u, unit)} color={ACCENT} />;
      })}
    </g>
  );
}

function DimLine({ f, u0, u1, n, faceN, s, label, color = "#8d97a6" }: { f: ReturnType<typeof wallFrame>; u0: number; u1: number; n: number; faceN: number; s: number; label: string; color?: string }) {
  const px = (k: number) => k / s;
  const dirN = Math.sign(n) || 1;
  const a = wallLocalToPlan(f, u0, n);
  const b = wallLocalToPlan(f, u1, n);
  const tick = normalize(add(f.dir, f.normal));
  const t = (p: Vec2) => seg(add(p, vscale(tick, px(4))), add(p, vscale(tick, -px(4))));
  const lenPx = (u1 - u0) * s;
  return (
    <g pointerEvents="none">
      <line {...seg(a, b)} stroke={color} strokeWidth={1} />
      <line {...seg(wallLocalToPlan(f, u0, faceN + dirN * px(3)), wallLocalToPlan(f, u0, n + dirN * px(4)))} stroke={color} strokeWidth={0.75} />
      <line {...seg(wallLocalToPlan(f, u1, faceN + dirN * px(3)), wallLocalToPlan(f, u1, n + dirN * px(4)))} stroke={color} strokeWidth={0.75} />
      <line {...t(a)} stroke={color} strokeWidth={1.5} />
      <line {...t(b)} stroke={color} strokeWidth={1.5} />
      {lenPx > 34 && (
        <Txt at={wallLocalToPlan(f, (u0 + u1) / 2, n + dirN * px(9))} s={s} angle={readable(f.angle)} size={10.5} fill={color === ACCENT ? ACCENT : "#c8ced8"}>
          {label}
        </Txt>
      )}
    </g>
  );
}

function PlanToolPreview({ s, unit }: { s: number; unit: LengthUnit }) {
  const tool = useEditor((st) => st.tool);
  const point = useCursor((st) => st.point);
  const snap = useCursor((st) => st.snap);
  if (!point || tool.kind === "select") return null;
  const px = (k: number) => k / s;
  const markerColor = snap === "endpoint" ? "#3ccf91" : ACCENT;
  const marker = (
    <g pointerEvents="none">
      <line x1={point.x - px(9)} y1={point.y} x2={point.x + px(9)} y2={point.y} stroke={markerColor} strokeWidth={1} />
      <line x1={point.x} y1={point.y - px(9)} x2={point.x} y2={point.y + px(9)} stroke={markerColor} strokeWidth={1} />
      <circle cx={point.x} cy={point.y} r={px(4)} fill="none" stroke={markerColor} strokeWidth={1.5} />
    </g>
  );

  if (tool.kind === "wall" && tool.anchor) {
    const f = wallFrame({ start: tool.anchor, end: point });
    const len = f.length;
    const fake = { start: tool.anchor, end: point, thickness: tool.preset.thickness } as Wall;
    return (
      <g pointerEvents="none">
        {len > 0.01 && <polygon points={pts(wallSegmentPolygon(fake, 0, len))} fill="rgb(47 128 255 / 0.35)" stroke={ACCENT} strokeWidth={1} />}
        {marker}
        <Txt at={wallLocalToPlan(f, len / 2, tool.preset.thickness / 2 + px(14))} s={s} angle={readable(f.angle)} fill={ACCENT} weight={600}>
          {tool.typed ? `${tool.typed} ↵` : formatLength(len, unit)}
        </Txt>
      </g>
    );
  }
  if ((tool.kind === "room" || tool.kind === "floor") && tool.anchor) {
    const a = tool.anchor;
    return (
      <g pointerEvents="none">
        <rect x={Math.min(a.x, point.x)} y={Math.min(a.y, point.y)} width={Math.abs(point.x - a.x)} height={Math.abs(point.y - a.y)} fill="rgb(47 128 255 / 0.1)" stroke={ACCENT} strokeWidth={1.5} strokeDasharray="6 4" />
        {marker}
        <Txt at={{ x: (a.x + point.x) / 2, y: (a.y + point.y) / 2 }} s={s} fill={ACCENT} weight={600}>
          {formatLength(Math.abs(point.x - a.x), unit)} × {formatLength(Math.abs(point.y - a.y), unit)}
        </Txt>
      </g>
    );
  }
  if (tool.kind === "place") {
    const spec = getLibraryItem(tool.itemId)?.spec;
    if (spec?.elementType === "object") {
      return (
        <g pointerEvents="none">
          <rect x={point.x - spec.length / 2} y={point.y - spec.width / 2} width={spec.length} height={spec.width} fill="rgb(47 128 255 / 0.15)" stroke={ACCENT} strokeDasharray="4 3" />
          {marker}
        </g>
      );
    }
  }
  return marker;
}

function NorthArrow() {
  return (
    <div className="pointer-events-none absolute top-24 right-3 flex flex-col items-center rounded-md border border-ink-700 bg-ink-850/90 px-2 py-1.5 backdrop-blur" aria-label="Norte">
      <svg width="18" height="22" viewBox="0 0 18 22" aria-hidden>
        <path d="M9 1 15 19 9 15 3 19z" fill="#e8ebf0" />
        <path d="M9 1v14L3 19z" fill="#6c7584" />
      </svg>
      <span className="mt-0.5 text-[10px] font-semibold text-fg-muted">N</span>
    </div>
  );
}

/** Escala gráfica + escala numérica aproximada (tela a 96 dpi). */
function ScaleBar({ s, unit }: { s: number; unit: LengthUnit }) {
  const nice = [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500];
  const len = nice.find((n) => n * s >= 70) ?? 500;
  const w = len * s;
  const ratio = Math.round(1 / (s * 0.0254 / 96));
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 rounded-md border border-ink-700 bg-ink-850/90 px-2.5 py-1.5 backdrop-blur">
      <div className="flex h-2 border-x border-b border-fg-muted" style={{ width: w }}>
        <div className="h-full w-1/2 bg-fg-muted/70" />
      </div>
      <div className="mt-1 flex justify-between gap-4 font-mono text-[10.5px] text-fg-muted" style={{ width: Math.max(w, 110) }}>
        <span>{formatLength(len, unit)}</span>
        <span>≈ 1:{ratio.toLocaleString("pt-BR")}</span>
      </div>
    </div>
  );
}

