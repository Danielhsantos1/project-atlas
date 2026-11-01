"use client";

import { useMemo, useState } from "react";
import {
  AppWindow, Bath, Bed, BedDouble, BrickWall, Briefcase, Car, ChevronRight, CookingPot, DoorOpen, Flame, Footprints, Home, Layers,
  MousePointer2, Search, ShowerHead, Sofa, Sun, Triangle, WashingMachine, LayoutGrid,
} from "lucide-react";
import { LIBRARY, LIBRARY_CATEGORIES, getLibraryItem, type LibraryItem } from "@/core/library/catalog";
import { planGarage, type GarageLayout } from "@/core/planning/garage";
import { getMaterial } from "@/core/model/materials";
import { ROOM_TYPE_INFO } from "@/core/model/factory";
import type { RoofType, RoomType } from "@/core/model/schema";
import { formatLength } from "@/core/units/units";
import { cn } from "@/lib/cn";
import { useEditor, type Tool, type ToolKind } from "../store";
import { AngleField, LengthField, MaterialField, SelectField } from "./fields";

const TOOLS: Array<{ kind: ToolKind | "door" | "window"; label: string; key: string; icon: React.ComponentType<{ size?: number }> }> = [
  { kind: "select", label: "Selecionar", key: "V", icon: MousePointer2 },
  { kind: "wall", label: "Parede", key: "W", icon: BrickWall },
  { kind: "door", label: "Porta", key: "D", icon: DoorOpen },
  { kind: "window", label: "Janela", key: "J", icon: AppWindow },
  { kind: "floor", label: "Piso / laje", key: "P", icon: Layers },
  { kind: "roof", label: "Telhado", key: "H", icon: Triangle },
];

const ROOM_ICONS: Record<RoomType, React.ComponentType<{ size?: number }>> = {
  sala: Sofa, cozinha: CookingPot, quarto: Bed, suite: BedDouble, banheiro: Bath, lavabo: ShowerHead, garagem: Car,
  gourmet: Flame, lavanderia: WashingMachine, escritorio: Briefcase, circulacao: Footprints, varanda: Sun, outro: LayoutGrid,
};
const ROOM_ORDER: RoomType[] = ["sala", "cozinha", "quarto", "suite", "banheiro", "lavabo", "garagem", "gourmet", "lavanderia", "escritorio", "circulacao", "varanda"];

export const DEFAULT_DOOR = "door-80";
export const DEFAULT_WINDOW = "window-120x120";

export const ROOF_TYPE_LABEL: Record<RoofType, string> = { hip: "Quatro águas", gable: "Duas águas", shed: "Uma água", flat: "Laje plana" };

function isToolActive(tool: Tool, kind: string): boolean {
  if (kind === "door") return tool.kind === "place" && tool.itemId.startsWith("door");
  if (kind === "window") return tool.kind === "place" && tool.itemId.startsWith("window");
  return tool.kind === kind;
}

export function ToolPanel() {
  const tool = useEditor((s) => s.tool);
  const unit = useEditor((s) => s.project?.settings.displayUnit ?? "m");
  const { setTool, activateLibraryItem, setRoomTool } = useEditor.getState();

  return (
    <div className="flex h-full flex-col overflow-y-auto" data-testid="tool-panel">
      <div className="border-b border-ink-700 p-2.5">
        <div className="label-caps mb-2 flex items-center gap-1.5 px-1"><Home size={12} /> Construir cômodos</div>
        <button
          onClick={() => useEditor.getState().setGarageTool(2, "lado-a-lado")}
          data-testid="tool-garage"
          aria-pressed={tool.kind === "garage"}
          className={cn("mb-1.5 flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left text-[12px] transition-colors", tool.kind === "garage" ? "border-accent-line bg-accent-soft text-fg" : "border-ink-600 text-fg-muted hover:border-ink-500 hover:text-fg")}
        >
          <Car size={16} className={tool.kind === "garage" ? "text-accent" : ""} />
          <span className="flex-1">Garagem por nº de carros</span>
          <span className="text-[10.5px] text-fg-subtle">assistente</span>
        </button>
        <div className="grid grid-cols-4 gap-1">
          {ROOM_ORDER.map((t) => {
            const Icon = ROOM_ICONS[t];
            const active = tool.kind === "room" && tool.roomType === t;
            return (
              <button
                key={t}
                data-testid={`room-${t}`}
                aria-pressed={active}
                title={`Desenhar ${ROOM_TYPE_INFO[t].label}: clique em dois cantos ou arraste`}
                onClick={() => setRoomTool(t)}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-md border px-0.5 py-1.5 text-[10.5px] leading-tight transition-colors",
                  active ? "border-accent-line bg-accent-soft text-fg" : "border-transparent text-fg-muted hover:border-ink-600 hover:bg-ink-750 hover:text-fg",
                )}
              >
                <span style={{ color: active ? undefined : ROOM_TYPE_INFO[t].color }} className={active ? "text-accent" : ""}>
                  <Icon size={17} />
                </span>
                <span className="truncate">{ROOM_TYPE_INFO[t].label}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="border-b border-ink-700 p-2.5">
        <div className="label-caps mb-2 px-1">Ferramentas</div>
        <div className="grid grid-cols-3 gap-1.5">
          {TOOLS.map((t) => {
            const active = isToolActive(tool, t.kind);
            return (
              <button
                key={t.kind}
                data-testid={`tool-${t.kind}`}
                aria-pressed={active}
                title={`${t.label} (${t.key})`}
                onClick={() =>
                  t.kind === "door" ? activateLibraryItem(DEFAULT_DOOR) : t.kind === "window" ? activateLibraryItem(DEFAULT_WINDOW) : setTool(t.kind)
                }
                className={cn(
                  "relative flex flex-col items-center gap-1 rounded-md border py-2 text-[11px] transition-colors",
                  active ? "border-accent-line bg-accent-soft text-fg" : "border-transparent text-fg-muted hover:border-ink-600 hover:bg-ink-750 hover:text-fg",
                )}
              >
                <span className={active ? "text-accent" : ""}>
                  <t.icon size={17} />
                </span>
                {t.label}
                <span className="absolute top-1 right-1.5 font-mono text-[9px] text-fg-subtle">{t.key}</span>
              </button>
            );
          })}
        </div>
        <ToolOptions tool={tool} unit={unit} />
      </div>
      <Library activeItemId={tool.kind === "place" ? tool.itemId : null} onPick={activateLibraryItem} />
    </div>
  );
}

function ToolOptions({ tool, unit }: { tool: Tool; unit: "m" | "cm" | "mm" }) {
  const set = useEditor.getState().setToolOptions;
  const hint: Record<Tool["kind"], string> = {
    select: "Clique em um cômodo, parede ou objeto para editar. Arraste o gizmo (3D) ou o elemento (2D) para mover.",
    wall: "Clique para iniciar e para cada vértice. Digite um comprimento + Enter para medida exata. Shift = ortogonal. Duplo-clique ou Esc encerra.",
    room: "Clique em dois cantos opostos (ou arraste). Lados encostados em cômodos existentes reaproveitam a parede.",
    floor: "Clique em dois cantos opostos para criar o piso ou laje.",
    roof: "Clique em dois cantos opostos sobre a casa. O beiral é acrescentado automaticamente.",
    place: "Clique no modelo para inserir. Portas e janelas: clique sobre uma parede.",
    garage: "Clique no ponto da garagem (canto inferior esquerdo). Cômodo, vagas e portões são criados com as medidas calculadas.",
  };
  return (
    <div className="mt-2.5 space-y-2.5 rounded-md bg-ink-800/70 p-2.5">
      <p className="text-[11.5px] leading-relaxed text-fg-muted" data-testid="tool-hint">{hint[tool.kind]}</p>
      {(tool.kind === "wall" || tool.kind === "room") && (
        <>
          {tool.kind === "room" && (
            <SelectField label="Tipo de cômodo" value={tool.roomType} options={ROOM_ORDER.map((t) => ({ value: t, label: ROOM_TYPE_INFO[t].label }))} onChange={(roomType) => set({ roomType })} />
          )}
          <div className="grid grid-cols-2 gap-2">
            <LengthField label="Altura" value={tool.preset.height} unit={unit} min={0.05} onCommit={(height) => { set({ height }); return true; }} />
            <LengthField label="Espessura" value={tool.preset.thickness} unit={unit} min={0.01} onCommit={(thickness) => { set({ thickness }); return true; }} />
          </div>
          <MaterialField value={tool.preset.materialId} onChange={(materialId) => set({ materialId })} label="Acabamento das paredes" />
        </>
      )}
      {tool.kind === "floor" && (
        <>
          <LengthField label="Espessura" value={tool.preset.thickness} unit={unit} min={0.005} onCommit={(thickness) => { set({ thickness }); return true; }} />
          <MaterialField value={tool.preset.materialId} onChange={(materialId) => set({ materialId })} />
        </>
      )}
      {tool.kind === "place" && <PlaceSizeOptions tool={tool} unit={unit} />}
      {tool.kind === "garage" && <GarageOptions tool={tool} />}
      {tool.kind === "roof" && (
        <div className="grid grid-cols-2 gap-2">
          <SelectField label="Tipo" value={tool.roofType} options={(Object.keys(ROOF_TYPE_LABEL) as RoofType[]).map((r) => ({ value: r, label: ROOF_TYPE_LABEL[r] }))} onChange={(roofType) => set({ roofType })} />
          <AngleField label="Inclinação" value={tool.pitch} onCommit={(pitch) => { set({ pitch }); return pitch >= 0 && pitch <= 60; }} />
        </div>
      )}
    </div>
  );
}

/** Medidas livres para a próxima porta/janela (sobrepõem as da biblioteca). */
function PlaceSizeOptions({ tool, unit }: { tool: Extract<Tool, { kind: "place" }>; unit: "m" | "cm" | "mm" }) {
  const item = getLibraryItem(tool.itemId);
  const setSize = useEditor.getState().setPlaceSize;
  if (!item || (item.spec.elementType !== "door" && item.spec.elementType !== "window")) return null;
  const spec = item.spec;
  const cur = tool.size ?? { width: spec.width, height: spec.height, sillHeight: spec.elementType === "window" ? spec.sillHeight : undefined };
  const custom = tool.size !== undefined;
  const update = (patch: Partial<typeof cur>) => { setSize({ ...cur, ...patch }); return true; };
  return (
    <div className="space-y-2 rounded-md border border-ink-600 p-2" data-testid="place-size">
      <label className="flex cursor-pointer items-center gap-2 text-[12px] text-fg-muted">
        <input type="checkbox" className="accent-accent" checked={custom} onChange={(e) => setSize(e.target.checked ? cur : null)} data-testid="custom-size-toggle" />
        Usar tamanho personalizado
      </label>
      {custom && (
        <div className="grid grid-cols-2 gap-2">
          <LengthField label="Largura" value={cur.width} unit={unit} min={0.2} onCommit={(width) => update({ width })} testId="size-width" />
          <LengthField label="Altura" value={cur.height} unit={unit} min={0.2} onCommit={(height) => update({ height })} testId="size-height" />
          {spec.elementType === "window" && (
            <LengthField label="Peitoril" value={cur.sillHeight ?? 0} unit={unit} min={0} onCommit={(sillHeight) => update({ sillHeight })} testId="size-sill" />
          )}
        </div>
      )}
    </div>
  );
}

/** Assistente de garagem: nº de carros e disposição → dimensões calculadas. */
export function GarageOptions({ tool }: { tool: Extract<Tool, { kind: "garage" }> }) {
  const set = useEditor.getState().setGarageTool;
  let plan: ReturnType<typeof planGarage> | null = null;
  try { plan = planGarage(tool.cars, tool.layout); } catch { plan = null; }
  return (
    <div className="space-y-2" data-testid="garage-options">
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-[11px] text-fg-subtle">Veículos
          <input type="number" min={1} max={12} value={tool.cars} data-testid="garage-cars" onChange={(e) => set(Math.min(12, Math.max(1, Math.round(Number(e.target.value) || 1))), tool.layout)} className="mt-1 h-7 w-full rounded border border-ink-600 bg-ink-900 px-2 font-mono text-[12px] text-fg focus:border-accent focus:outline-none" />
        </label>
        <SelectField label="Disposição" value={tool.layout} options={[{ value: "lado-a-lado", label: "Lado a lado" }, { value: "em-fila", label: "Em fila" }, { value: "duas-fileiras", label: "Duas fileiras" }]} onChange={(layout: GarageLayout) => set(tool.cars, layout)} />
      </div>
      {plan && (
        <div className="rounded bg-ink-900 p-2 font-mono text-[11.5px] text-fg-muted" data-testid="garage-result">
          {plan.width.toFixed(2).replace(".", ",")} × {plan.depth.toFixed(2).replace(".", ",")} m · {plan.area.toFixed(2).replace(".", ",")} m²
          {plan.notes.map((n) => <p key={n} className="mt-1 font-sans text-[11px] text-fg-subtle">{n}</p>)}
        </div>
      )}
    </div>
  );
}

function specSummary(item: LibraryItem, unit: "m" | "cm" | "mm"): string {
  const s = item.spec;
  const f = (m: number) => formatLength(m, unit, { withUnit: false });
  switch (s.elementType) {
    case "wall": return `e ${f(s.thickness)} · h ${f(s.height)}`;
    case "floor": return `e ${f(s.thickness)}`;
    case "door": return `${f(s.width)} × ${f(s.height)}`;
    case "window": return `${f(s.width)} × ${f(s.height)} · p ${f(s.sillHeight)}`;
    case "object": return `${f(s.length)} × ${f(s.width)} × ${f(s.height)}`;
  }
}

function Library({ activeItemId, onPick }: { activeItemId: string | null; onPick(id: string): void }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({ portas: true, janelas: true, estrutura: true });
  const unit = useEditor((s) => s.project?.settings.displayUnit ?? "m");
  const q = query.trim().toLowerCase();
  const groups = useMemo(
    () =>
      LIBRARY_CATEGORIES.map((c) => ({
        ...c,
        items: LIBRARY.filter((i) => i.category === c.id && (!q || i.name.toLowerCase().includes(q) || i.description.toLowerCase().includes(q))),
      })).filter((g) => g.items.length > 0),
    [q],
  );

  return (
    <div className="flex flex-col">
      <div className="p-2.5 pb-2">
        <div className="label-caps mb-2 px-1">Biblioteca</div>
        <div className="relative">
          <Search size={13} className="absolute top-1/2 left-2 -translate-y-1/2 text-fg-subtle" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            placeholder="Buscar objetos"
            aria-label="Buscar na biblioteca"
            className="h-7 w-full rounded border border-ink-600 bg-ink-900 pr-2 pl-7 text-[12px] placeholder:text-fg-subtle focus:border-accent focus:outline-none"
          />
        </div>
      </div>
      <div className="px-1.5 pb-3">
        {groups.map((g) => {
          const expanded = q.length > 0 || open[g.id];
          return (
            <div key={g.id} className="mb-0.5">
              <button onClick={() => setOpen((o) => ({ ...o, [g.id]: !o[g.id] }))} className="flex w-full items-center gap-1.5 rounded px-1.5 py-1.5 text-[12px] font-medium text-fg-muted hover:text-fg" aria-expanded={expanded}>
                <ChevronRight size={13} className={cn("transition-transform", expanded && "rotate-90")} />
                {g.label}
                <span className="ml-auto text-[10.5px] text-fg-subtle">{g.items.length}</span>
              </button>
              {expanded && (
                <ul className="mb-1 space-y-0.5 pl-2">
                  {g.items.map((item) => (
                    <li key={item.id}>
                      <button
                        onClick={() => onPick(item.id)}
                        data-testid={`lib-${item.id}`}
                        title={item.description}
                        className={cn(
                          "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors",
                          activeItemId === item.id ? "bg-accent-soft ring-1 ring-accent-line" : "hover:bg-ink-750",
                        )}
                      >
                        <span className="size-3 shrink-0 rounded-sm border border-white/10" style={{ background: getMaterial(item.spec.materialId).color }} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12px]">{item.name}</span>
                          <span className="block truncate font-mono text-[10.5px] text-fg-subtle">{specSummary(item, unit)}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
