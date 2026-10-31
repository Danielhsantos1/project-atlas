"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Copy, Download, MoreHorizontal, PlayCircle, Star, Trash2 } from "lucide-react";
import type { ProjectSummary } from "@/persistence/summary";
import { STATUS_LABEL, categoryLabel } from "@/core/model/categories";
import { relativeTime } from "@/lib/time";
import { cn } from "@/lib/cn";
import { ConfirmDialog } from "@/ui/Dialog";
import { PlanPreview } from "./PlanPreview";
import { CategoryIcon } from "./CategoryIcon";
import { useProjects } from "./store";

export function ProjectCard({ project }: { project: ProjectSummary }) {
  const { update, duplicate, remove, exportProject } = useProjects();
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [menuOpen]);

  const menuItem = "flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-[12.5px] text-fg-muted hover:bg-ink-700 hover:text-fg";

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-xl border border-ink-700 bg-ink-850 transition-all duration-200 hover:-translate-y-0.5 hover:border-ink-500 hover:shadow-xl hover:shadow-black/40" data-testid="project-card">
      <Link href={`/editor/${project.id}`} className="blueprint-bg relative block aspect-[16/10] overflow-hidden border-b border-ink-700" aria-label={`Abrir ${project.name}`}>
        <div className="absolute inset-3">
          <PlanPreview preview={project.preview} site={project.site} />
        </div>
        {project.elementCount === 0 && (
          <span className="absolute inset-x-0 bottom-3 text-center text-[11px] text-fg-subtle">Projeto vazio — terreno {project.site.width} × {project.site.depth} m</span>
        )}
      </Link>

      <button
        onClick={() => update(project.id, { favorite: !project.favorite })}
        className={cn(
          "absolute top-2 right-2 rounded-md p-1.5 backdrop-blur transition-colors",
          project.favorite ? "bg-ink-900/70 text-warning" : "bg-ink-900/50 text-fg-subtle opacity-0 group-hover:opacity-100 hover:text-fg",
        )}
        aria-label={project.favorite ? "Remover dos favoritos" : "Adicionar aos favoritos"}
        title={project.favorite ? "Remover dos favoritos" : "Favoritar"}
      >
        <Star size={14} fill={project.favorite ? "currentColor" : "none"} />
      </button>

      <div className="flex items-start gap-2 p-3">
        <div className="min-w-0 flex-1">
          <Link href={`/editor/${project.id}`} className="block truncate text-[13.5px] font-medium hover:text-accent">
            {project.name}
          </Link>
          <div className="mt-1 flex items-center gap-1.5 text-[11.5px] text-fg-subtle">
            <CategoryIcon category={project.category} size={12} />
            <span>{categoryLabel(project.category)}</span>
            <span>·</span>
            <span>{project.elementCount} elementos</span>
          </div>
          <div className="mt-2 flex items-center gap-2 text-[11px]">
            <span className={cn("rounded-full px-1.5 py-0.5", project.status === "concluido" ? "bg-success/12 text-success" : project.status === "arquivado" ? "bg-ink-700 text-fg-subtle" : "bg-accent-soft text-accent")}>
              {STATUS_LABEL[project.status]}
            </span>
            <span className="text-fg-subtle" title={new Date(project.updatedAt).toLocaleString("pt-BR")}>
              {relativeTime(project.updatedAt)}
            </span>
          </div>
        </div>

        <div className="relative" ref={menuRef}>
          <button onClick={() => setMenuOpen((v) => !v)} className="rounded-md p-1 text-fg-subtle hover:bg-ink-700 hover:text-fg" aria-label="Ações do projeto" data-testid="project-menu">
            <MoreHorizontal size={16} />
          </button>
          {menuOpen && (
            <div className="absolute right-0 bottom-8 z-20 w-48 animate-pop-in rounded-lg border border-ink-600 bg-ink-800 p-1 shadow-2xl shadow-black/60" onClick={() => setMenuOpen(false)}>
              <button className={menuItem} onClick={() => duplicate(project.id)}>
                <Copy size={14} /> Duplicar
              </button>
              <button className={menuItem} onClick={() => exportProject(project.id)}>
                <Download size={14} /> Exportar JSON
              </button>
              {project.status !== "concluido" ? (
                <button className={menuItem} onClick={() => update(project.id, { status: "concluido" })}>
                  <CheckCircle2 size={14} /> Marcar como concluído
                </button>
              ) : (
                <button className={menuItem} onClick={() => update(project.id, { status: "em-andamento" })}>
                  <PlayCircle size={14} /> Reabrir (em andamento)
                </button>
              )}
              <div className="my-1 h-px bg-ink-700" />
              <button className={cn(menuItem, "text-danger hover:text-danger")} onClick={() => setConfirmDelete(true)} data-testid="delete-project">
                <Trash2 size={14} /> Excluir…
              </button>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Excluir projeto?"
        message={
          <>
            O projeto <strong className="text-fg">{project.name}</strong> e todos os seus {project.elementCount} elementos serão removidos deste
            navegador. Esta ação não pode ser desfeita. Se quiser manter uma cópia, exporte o JSON antes.
          </>
        }
        confirmLabel="Excluir definitivamente"
        danger
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false);
          void remove(project.id);
        }}
      />
    </div>
  );
}
