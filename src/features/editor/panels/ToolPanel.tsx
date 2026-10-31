"use client";

import { useMemo, useState } from "react";
import { AppWindow, BrickWall, ChevronRight, DoorOpen, Layers, MousePointer2, Search, SquareDashed } from "lucide-react";
import { LIBRARY, LIBRARY_CATEGORIES, type LibraryItem } from "@/core/library/catalog";
import { getMaterial } from "@/core/model/materials";
import { formatLength } from "@/core/units/units";
import { cn } from "@/lib/cn";
import { useEditor, type Tool, type ToolKind } from "../store";
import { LengthField, MaterialField } from "./fields";

const TOOLS: Array<{ kind: ToolKind | "door" | "window"; label: string; key: string; icon: React.ComponentType<{ size?: number }> }> = [
  { kind: "select", label: "Selecionar", key: "V", icon: MousePointer2 },
  { kind: "wall", label: "Parede", key: "W", icon: BrickWall },
  { kind: "room", label: "Ambiente", key: "A", icon: SquareDashed },
  { kind: "floor", label: "Piso", key: "P", icon: Layers },
  { kind: "door", label: "Porta", key: "D", icon: DoorOpen },
  { kind: "window", label: "Janela", key: "J", icon: AppWindow },
];

export const DEFAULT_DOOR = "door-80";
export const DEFAULT_WINDOW = "window-120x120";

function isToolActive(tool: Tool, kind: string): boolean {
  if (kind === "door") return tool.kind === "place" && tool.itemId.startsWith("door");
  if (kind === "window") return tool.kind === "place" && tool.itemId.startsWith("window");
  return tool.kind === kind;
}

export function ToolPanel() {
  const tool = useEditor((s) => s.tool);
  const unit = useEditor((s) => s.project?.settings.displayUnit ?? "m");
  const { setTool, activateLibraryItem } = useEditor.getState();

  return (
    <div className="flex h-full flex-col" data-testid="tool-panel">
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
    select: "Clique para selecionar. Arraste o gizmo (3D) ou o elemento (2D) para mover. Setas movem pela grade.",
    wall: "Clique para iniciar e para cada vértice. Digite um comprimento + Enter para medida exata. Shift = ortogonal. Duplo-clique ou Esc encerra.",
    room: "Clique em dois cantos opostos para criar 4 paredes encadeadas.",
    floor: "Clique em dois cantos opostos para criar o piso.",
    place: "Clique no modelo para inserir. Portas e janelas: clique sobre uma parede.",
  };
  return (
    <div className="mt-2.5 space-y-2.5 rounded-md bg-ink-800/70 p-2.5">
      <p className="text-[11.5px] leading-relaxed text-fg-muted" data-testid="tool-hint">{hint[tool.kind]}</p>
      {(tool.kind === "wall" || tool.kind === "room") && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <LengthField label="Altura" value={tool.preset.height} unit={unit} min={0.05} onCommit={(height) => { set({ height }); return true; }} />
            <LengthField label="Espessura" value={tool.preset.thickness} unit={unit} min={0.01} onCommit={(thickness) => { set({ thickness }); return true; }} />
          </div>
          <MaterialField value={tool.preset.materialId} onChange={(materialId) => set({ materialId })} />
          {tool.kind === "room" && (
            <label className="flex cursor-pointer items-center gap-2 text-[12px] text-fg-muted">
              <input type="checkbox" className="accent-accent" checked={tool.withFloor} onChange={(e) => set({ withFloor: e.target.checked })} />
              Criar piso no ambiente
            </label>
          )}
        </>
      )}
      {tool.kind === "floor" && (
        <>
          <LengthField label="Espessura" value={tool.preset.thickness} unit={unit} min={0.005} onCommit={(thickness) => { set({ thickness }); return true; }} />
          <MaterialField value={tool.preset.materialId} onChange={(materialId) => set({ materialId })} />
        </>
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
  const [open, setOpen] = useState<Record<string, boolean>>({ portas: true, janelas: true });
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
    <div className="flex min-h-0 flex-1 flex-col">
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
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3">
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
