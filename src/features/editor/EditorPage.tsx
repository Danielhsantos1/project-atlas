"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { getProjectService } from "@/persistence/browser";
import { PersistenceError } from "@/persistence/errors";
import { downloadText, safeFileName } from "@/lib/download";
import { cn } from "@/lib/cn";
import { useEditor } from "./store";
import { TopBar } from "./panels/TopBar";
import { ToolPanel } from "./panels/ToolPanel";
import { PropertiesPanel } from "./panels/PropertiesPanel";
import { StatusBar } from "./panels/StatusBar";
import { ShortcutsDialog } from "./panels/ShortcutsDialog";
import { LevelSelector, ViewModeBar } from "./panels/ViewModeBar";
import { BudgetPanel } from "./budget/BudgetPanel";
import { EngineeringPanel } from "./engineering/EngineeringPanel";
import { useAutosave, saveNow } from "./hooks/useAutosave";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";

// WebGL e SVG interativo existem apenas no navegador.
const Viewport3D = dynamic(() => import("./viewport3d/Viewport3D"), { ssr: false, loading: () => <ViewportLoading /> });
const FloorPlan2D = dynamic(() => import("./plan2d/FloorPlan2D"), { ssr: false, loading: () => <ViewportLoading /> });

type LoadState = { kind: "loading" } | { kind: "ready" } | { kind: "missing" } | { kind: "error"; message: string };

export function EditorPage({ id }: { id: string }) {
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    getProjectService()
      .open(id)
      .then((p) => {
        if (cancelled) return;
        if (!p) return setLoad({ kind: "missing" });
        useEditor.getState().load(p);
        document.title = `${p.name} · PROJECT ATLAS`;
        setLoad({ kind: "ready" });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof PersistenceError) setLoad({ kind: "error", message: error.message });
        else throw error;
      });
    return () => {
      cancelled = true;
      useEditor.getState().unload();
    };
  }, [id]);

  if (load.kind === "loading") return <FullScreenMessage><Loader2 className="animate-spin text-accent" /> Abrindo projeto…</FullScreenMessage>;
  if (load.kind === "missing") return <FullScreenMessage>Projeto não encontrado neste navegador. <Link className="text-accent" href="/">Voltar ao dashboard</Link></FullScreenMessage>;
  if (load.kind === "error") return <FullScreenMessage><span className="text-danger">{load.message}</span> <Link className="text-accent" href="/">Voltar</Link></FullScreenMessage>;
  return <EditorWorkspace />;
}

function EditorWorkspace() {
  const view = useEditor((s) => s.view);
  const panels = useEditor((s) => s.panels);
  const walking = useEditor((s) => s.view === "3d" && s.viewMode === "walkthrough");
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [engOpen, setEngOpen] = useState(false);
  const showShortcuts = useCallback(() => setShortcutsOpen(true), []);
  useAutosave();
  useKeyboardShortcuts(showShortcuts);

  const exportJson = useCallback(async () => {
    if (!(await saveNow())) return;
    const project = useEditor.getState().project;
    if (!project) return;
    downloadText(`${safeFileName(project.name)}.atlas.json`, getProjectService().exportJson(project));
  }, []);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-ink-900">
      <TopBar onSave={() => void saveNow({ manual: true })} onExport={exportJson} onShowShortcuts={showShortcuts} onBudget={() => setBudgetOpen(true)} onEngineering={() => setEngOpen(true)} />
      <div className="relative flex min-h-0 flex-1">
        {budgetOpen && <BudgetPanel onClose={() => setBudgetOpen(false)} />}
        {engOpen && <EngineeringPanel onClose={() => setEngOpen(false)} />}
        <aside className={cn("panel w-64 shrink-0 border-r transition-[margin] duration-200", !panels.left && "-ml-64")} aria-label="Ferramentas e biblioteca">
          <ToolPanel />
        </aside>
        <main className="relative min-w-0 flex-1">
          {view === "3d" ? <Viewport3D /> : <FloorPlan2D />}
          <ViewModeBar />
          {!walking && <LevelSelector />}
        </main>
        <aside className={cn("panel w-[300px] shrink-0 border-l transition-[margin] duration-200", !panels.right && "-mr-[300px]")} aria-label="Propriedades">
          <PropertiesPanel />
        </aside>
      </div>
      <StatusBar />
      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}

function ViewportLoading() {
  return (
    <div className="flex size-full items-center justify-center gap-2 text-fg-subtle">
      <Loader2 size={16} className="animate-spin" /> Inicializando visualização…
    </div>
  );
}

function FullScreenMessage({ children }: { children: React.ReactNode }) {
  return <div className="blueprint-bg flex h-screen items-center justify-center gap-2 text-fg-muted">{children}</div>;
}
