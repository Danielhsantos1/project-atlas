"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  AlertCircle, Box, Check, ChevronLeft, Cloud, Download, Focus, Keyboard, Loader2, Map as MapIcon, PanelLeft, PanelRight, Redo2, Save, Undo2,
} from "lucide-react";
import { categoryLabel } from "@/core/model/categories";
import { IconButton } from "@/ui/Button";
import { LogoMark } from "@/ui/Logo";
import { cn } from "@/lib/cn";
import { relativeTime } from "@/lib/time";
import { useEditor, type CameraPreset } from "../store";

export function TopBar({ onSave, onExport, onShowShortcuts }: { onSave(): void; onExport(): void; onShowShortcuts(): void }) {
  const project = useEditor((s) => s.project);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const view = useEditor((s) => s.view);
  const panels = useEditor((s) => s.panels);
  const { undo, redo, setView, togglePanel, requestCamera, updateProject } = useEditor.getState();
  if (!project) return null;

  return (
    <header className="panel flex h-12 shrink-0 items-center gap-2 border-b px-2">
      <Link href="/" className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-fg-muted hover:bg-ink-750 hover:text-fg" title="Voltar ao dashboard" data-testid="back-to-dashboard">
        <ChevronLeft size={16} />
        <LogoMark size={20} />
      </Link>
      <div className="h-5 w-px bg-ink-700" />
      <ProjectName name={project.name} onRename={(name) => updateProject({ name })} />
      <span className="rounded bg-ink-750 px-1.5 py-0.5 text-[11px] text-fg-muted">{categoryLabel(project.category)}</span>
      <SaveIndicator />

      <div className="ml-2 flex items-center gap-0.5">
        <IconButton label="Desfazer" shortcut="Ctrl+Z" onClick={undo} disabled={!canUndo} data-testid="undo"><Undo2 size={16} /></IconButton>
        <IconButton label="Refazer" shortcut="Ctrl+Shift+Z" onClick={redo} disabled={!canRedo} data-testid="redo"><Redo2 size={16} /></IconButton>
        <IconButton label="Salvar" shortcut="Ctrl+S" onClick={onSave} data-testid="save"><Save size={16} /></IconButton>
        <IconButton label="Exportar JSON" onClick={onExport} data-testid="export"><Download size={16} /></IconButton>
      </div>

      <div className="mx-auto flex rounded-lg border border-ink-700 bg-ink-900 p-0.5" role="tablist" aria-label="Visualização">
        {([["3d", "Modelo 3D", Box, "1"], ["2d", "Planta 2D", MapIcon, "2"]] as const).map(([v, label, Icon, key]) => (
          <button
            key={v}
            role="tab"
            aria-selected={view === v}
            data-testid={`view-${v}`}
            title={`${label} (${key})`}
            onClick={() => setView(v)}
            className={cn("flex items-center gap-1.5 rounded-md px-3 py-1 text-[12.5px] transition-colors", view === v ? "bg-ink-700 text-fg shadow-sm" : "text-fg-muted hover:text-fg")}
          >
            <Icon size={14} className={view === v ? "text-accent" : ""} />
            {label}
          </button>
        ))}
      </div>

      {view === "3d" && <CameraMenu onPick={requestCamera} />}
      <div className="flex items-center gap-0.5">
        <IconButton label="Painel esquerdo" shortcut="[" active={panels.left} onClick={() => togglePanel("left")}><PanelLeft size={16} /></IconButton>
        <IconButton label="Painel direito" shortcut="]" active={panels.right} onClick={() => togglePanel("right")}><PanelRight size={16} /></IconButton>
        <IconButton label="Atalhos de teclado" shortcut="?" onClick={onShowShortcuts}><Keyboard size={16} /></IconButton>
      </div>
    </header>
  );
}

function ProjectName({ name, onRename }: { name: string; onRename(n: string): boolean }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(name);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => setText(name), [name]);
  useEffect(() => {
    if (editing) ref.current?.select();
  }, [editing]);
  if (!editing) {
    return (
      <button onClick={() => setEditing(true)} className="max-w-64 truncate rounded px-1.5 py-1 text-[13px] font-medium hover:bg-ink-750" title="Renomear" data-testid="project-title">
        {name}
      </button>
    );
  }
  const done = () => {
    setEditing(false);
    if (text.trim() && text.trim() !== name) {
      if (!onRename(text.trim())) setText(name);
    } else setText(name);
  };
  return (
    <input
      ref={ref}
      value={text}
      maxLength={120}
      onChange={(e) => setText(e.target.value)}
      onBlur={done}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") done();
        if (e.key === "Escape") {
          setText(name);
          setEditing(false);
        }
      }}
      aria-label="Nome do projeto"
      className="h-7 w-64 rounded border border-accent bg-ink-900 px-1.5 text-[13px] focus:outline-none"
    />
  );
}

function SaveIndicator() {
  const status = useEditor((s) => s.saveStatus);
  const error = useEditor((s) => s.saveError);
  const updatedAt = useEditor((s) => s.project?.updatedAt);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  const map = {
    saved: { icon: <Check size={13} />, text: updatedAt ? `Salvo ${relativeTime(updatedAt)}` : "Salvo", cls: "text-fg-subtle" },
    dirty: { icon: <Cloud size={13} />, text: "Alterações não salvas", cls: "text-fg-muted" },
    saving: { icon: <Loader2 size={13} className="animate-spin" />, text: "Salvando…", cls: "text-accent" },
    error: { icon: <AlertCircle size={13} />, text: "Falha ao salvar", cls: "text-danger" },
  }[status];
  return (
    <span className={cn("flex items-center gap-1 text-[11.5px]", map.cls)} title={error ?? undefined} data-testid="save-status" data-status={status}>
      {map.icon}
      {map.text}
    </span>
  );
}

function CameraMenu({ onPick }: { onPick(p: CameraPreset): void }) {
  const items: Array<[CameraPreset, string, string]> = [
    ["fit", "Enquadrar", "F"],
    ["iso", "Perspectiva", "I"],
    ["top", "Superior", "T"],
    ["front", "Frontal", ""],
    ["right", "Lateral", ""],
  ];
  return (
    <div className="flex items-center gap-0.5 rounded-lg border border-ink-700 bg-ink-900 p-0.5">
      <Focus size={14} className="mx-1 text-fg-subtle" aria-hidden />
      {items.map(([p, label, key]) => (
        <button key={p} onClick={() => onPick(p)} title={key ? `${label} (${key})` : label} className="rounded-md px-2 py-1 text-[11.5px] text-fg-muted hover:bg-ink-700 hover:text-fg">
          {label}
        </button>
      ))}
    </div>
  );
}
