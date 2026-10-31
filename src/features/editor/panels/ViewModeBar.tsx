"use client";

import { Box, Building2, Eye, Hammer, Home, Map as MapIcon, PersonStanding, Plus, Scissors, Sofa } from "lucide-react";
import { roomShape } from "@/core/geometry/rooms";
import { levelWalls } from "@/core/model/operations";
import { cn } from "@/lib/cn";
import { CONSTRUCTION_STAGES, useEditor, type FacadeSide, type ViewMode3D } from "../store";

const MODES: Array<{ id: ViewMode3D | "plan"; label: string; icon: React.ComponentType<{ size?: number }>; testId: string }> = [
  { id: "complete", label: "Casa completa", icon: Home, testId: "view-3d" },
  { id: "dollhouse", label: "Casa aberta", icon: Box, testId: "view-dollhouse" },
  { id: "plan", label: "Planta", icon: MapIcon, testId: "view-2d" },
  { id: "section", label: "Corte", icon: Scissors, testId: "view-section" },
  { id: "construction", label: "Construção", icon: Hammer, testId: "view-construction" },
  { id: "facade", label: "Fachadas", icon: Building2, testId: "view-facade" },
  { id: "interior", label: "Interiores", icon: Sofa, testId: "view-interior" },
];

const FACADES: Array<[FacadeSide, string]> = [
  ["front", "Frontal (sul)"],
  ["back", "Posterior (norte)"],
  ["left", "Lateral esquerda (oeste)"],
  ["right", "Lateral direita (leste)"],
];

/** Barra de modos de visualização — todos sobre o mesmo modelo. */
export function ViewModeBar() {
  const view = useEditor((s) => s.view);
  const mode = useEditor((s) => s.viewMode);
  const s = useEditor.getState();
  const current = view === "2d" ? "plan" : mode;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex flex-col items-center gap-2">
      <div className="pointer-events-auto flex items-center gap-1 rounded-xl border border-ink-600 bg-ink-850/92 p-1 shadow-xl shadow-black/40 backdrop-blur">
        {MODES.map((m) => (
          <button
            key={m.id}
            data-testid={m.testId}
            onClick={() => (m.id === "plan" ? s.setView("2d") : s.setViewMode(m.id))}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] transition-colors",
              current === m.id ? "bg-ink-700 text-fg" : "text-fg-muted hover:bg-ink-750 hover:text-fg",
            )}
            aria-pressed={current === m.id}
          >
            <span className={current === m.id ? "text-accent" : ""}>
              <m.icon size={14} />
            </span>
            {m.label}
          </button>
        ))}
        <button
          data-testid="enter-building"
          onClick={() => s.setViewMode("walkthrough")}
          className={cn(
            "ml-1 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold text-white transition-colors",
            current === "walkthrough" ? "bg-accent-strong" : "bg-accent hover:bg-accent-hover",
          )}
        >
          <PersonStanding size={15} /> Entrar na construção
        </button>
      </div>
      {view === "3d" && <ModeControls mode={mode} />}
    </div>
  );
}

function ModeControls({ mode }: { mode: ViewMode3D }) {
  const s = useEditor.getState();
  const section = useEditor((st) => st.section);
  const stage = useEditor((st) => st.stage);
  const facade = useEditor((st) => st.facade);
  const interiorRoomId = useEditor((st) => st.interiorRoomId);
  const project = useEditor((st) => st.project);
  const active = useEditor((st) => st.activeLevelId);
  const box = "pointer-events-auto flex items-center gap-3 rounded-lg border border-ink-600 bg-ink-850/92 px-3 py-1.5 text-[12px] text-fg-muted backdrop-blur";

  if (mode === "section") {
    return (
      <div className={box}>
        <label className="flex items-center gap-2">
          Corte horizontal
          <input type="range" min={0.3} max={4} step={0.05} value={section.height} onChange={(e) => s.setSection({ height: Number(e.target.value) })} className="accent-accent" aria-label="Altura do corte horizontal" />
          <span className="w-12 font-mono text-fg">{section.height.toFixed(2).replace(".", ",")} m</span>
        </label>
        <select value={section.axis} onChange={(e) => s.setSection({ axis: e.target.value as "none" | "x" | "y" })} className="rounded bg-ink-750 px-1.5 py-1 text-fg" aria-label="Corte vertical">
          <option value="none">Sem corte vertical</option>
          <option value="x">Corte vertical em X</option>
          <option value="y">Corte vertical em Y</option>
        </select>
        {section.axis !== "none" && (
          <label className="flex items-center gap-2">
            <input type="range" min={-5} max={Math.max(project?.site.width ?? 20, project?.site.depth ?? 20) + 5} step={0.1} value={section.position} onChange={(e) => s.setSection({ position: Number(e.target.value) })} className="accent-accent" aria-label="Posição do corte vertical" />
            <span className="w-14 font-mono text-fg">{section.position.toFixed(1).replace(".", ",")} m</span>
          </label>
        )}
      </div>
    );
  }
  if (mode === "construction") {
    return (
      <div className={box}>
        <span>Etapa</span>
        <input type="range" min={1} max={8} step={1} value={stage} onChange={(e) => s.setStage(Number(e.target.value))} className="w-56 accent-accent" aria-label="Etapa da obra" data-testid="stage-slider" />
        <span className="w-48 font-medium text-fg">{stage}. {CONSTRUCTION_STAGES[stage - 1]}</span>
        {stage === 6 && <span className="text-warning">Instalações ainda não são modeladas nesta versão.</span>}
        {stage === 2 && <span className="text-fg-subtle">Fundação apenas ilustrativa, sem dimensionamento.</span>}
      </div>
    );
  }
  if (mode === "facade") {
    return (
      <div className={box}>
        {FACADES.map(([id, label]) => (
          <button key={id} onClick={() => s.setFacade(id)} className={cn("rounded px-2 py-0.5", facade === id ? "bg-accent-soft text-accent" : "hover:text-fg")}>
            {label}
          </button>
        ))}
        <span className="text-fg-subtle">Projeção ortogonal</span>
      </div>
    );
  }
  if (mode === "interior" && project) {
    const rooms = project.elements.filter((e) => e.type === "room" && e.levelId === active && roomShape(levelWalls(project, active), e.seed));
    return (
      <div className={box}>
        <Eye size={13} />
        <select value={interiorRoomId ?? ""} onChange={(e) => s.setInteriorRoom(e.target.value || null)} className="rounded bg-ink-750 px-1.5 py-1 text-fg" aria-label="Ambiente">
          <option value="">Todo o pavimento</option>
          {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </div>
    );
  }
  if (mode === "dollhouse") {
    return <div className={box}>Telhado e partes superiores ocultos · pavimentos acima do ativo ocultos</div>;
  }
  return null;
}

/** Seletor de pavimentos (lado esquerdo do viewport). */
export function LevelSelector() {
  const project = useEditor((s) => s.project);
  const active = useEditor((s) => s.activeLevelId);
  if (!project) return null;
  const s = useEditor.getState();
  return (
    <div className="absolute top-20 left-3 z-10 flex flex-col gap-1 rounded-lg border border-ink-600 bg-ink-850/92 p-1 backdrop-blur" data-testid="level-selector">
      {[...project.levels].reverse().map((l) => (
        <button
          key={l.id}
          onClick={() => s.setActiveLevel(l.id)}
          title={`${l.name} · cota ${l.elevation.toFixed(2).replace(".", ",")} m`}
          className={cn("rounded-md px-2.5 py-1.5 text-left text-[11.5px]", l.id === active ? "bg-accent-soft text-fg ring-1 ring-accent-line" : "text-fg-muted hover:bg-ink-750 hover:text-fg")}
        >
          {l.name}
        </button>
      ))}
      <button onClick={s.addLevelAbove} className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[11.5px] text-accent hover:bg-ink-750" title="Adicionar pavimento acima">
        <Plus size={12} /> Pavimento
      </button>
    </div>
  );
}
