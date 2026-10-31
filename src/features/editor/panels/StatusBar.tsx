"use client";

import { Magnet } from "lucide-react";
import { formatLength, LENGTH_UNITS } from "@/core/units/units";
import { cn } from "@/lib/cn";
import { useEditor } from "../store";
import { useCursor } from "../cursor";

const TOOL_LABEL = { select: "Selecionar", wall: "Parede", room: "Ambiente", floor: "Piso", place: "Inserir" } as const;

export function StatusBar() {
  const project = useEditor((s) => s.project);
  const tool = useEditor((s) => s.tool);
  const view = useEditor((s) => s.view);
  const point = useCursor((s) => s.point);
  const snap = useCursor((s) => s.snap);
  if (!project) return null;
  const { settings } = project;
  const unit = settings.displayUnit;
  const counts = project.elements.reduce<Record<string, number>>((acc, e) => ((acc[e.type] = (acc[e.type] ?? 0) + 1), acc), {});
  const f = (m: number) => formatLength(m, unit, { withUnit: false });

  return (
    <footer className="panel flex h-7 shrink-0 items-center gap-4 border-t px-3 font-mono text-[11px] text-fg-subtle" data-testid="status-bar">
      <span className="text-fg-muted">
        {TOOL_LABEL[tool.kind]}
        {tool.kind === "wall" && tool.typed && <span className="ml-1.5 text-accent">⌨ {tool.typed}</span>}
      </span>
      <span className="w-56" data-testid="cursor-coords">
        X <span className="text-fg-muted">{point ? f(point.x) : "—"}</span>
        {"  "}Y <span className="text-fg-muted">{point ? f(point.y) : "—"}</span>
        {"  "}Z <span className="text-fg-muted">{point ? f(0) : "—"}</span>
        {snap && snap !== "free" && <span className="ml-2 text-accent">{snap === "endpoint" ? "• extremidade" : "• grade"}</span>}
      </span>
      <span data-testid="element-counts">
        Paredes {counts.wall ?? 0} · Portas {counts.door ?? 0} · Janelas {counts.window ?? 0} · Pisos {counts.floor ?? 0} · Objetos {counts.object ?? 0}
      </span>
      <span className="ml-auto">{view === "3d" ? "Perspectiva · Orbitar: botão esq. · Pan: botão dir. · Zoom: roda" : "Planta · Pan: arrastar fundo · Zoom: roda"}</span>
      <button
        onClick={() => useEditor.getState().updateSettings({ snapToGrid: !settings.snapToGrid })}
        className={cn("flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-ink-700", settings.snapToGrid ? "text-accent" : "text-fg-subtle")}
        title="Atrair à grade (G)"
        aria-pressed={settings.snapToGrid}
      >
        <Magnet size={12} /> Grade {formatLength(settings.gridSize, unit)}
      </button>
      <label className="flex items-center gap-1">
        Unidade
        <select
          value={unit}
          aria-label="Unidade de exibição"
          onChange={(e) => useEditor.getState().updateSettings({ displayUnit: e.target.value as typeof unit })}
          className="cursor-pointer rounded bg-transparent px-1 text-fg-muted hover:bg-ink-700 focus:outline-none"
        >
          {LENGTH_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
      </label>
    </footer>
  );
}
