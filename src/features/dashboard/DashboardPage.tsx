"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Boxes, Clock, FilePlus2, FolderOpen, Layers, Loader, Star, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { CATEGORIES, categoryLabel } from "@/core/model/categories";
import type { ProjectCategory } from "@/core/model/schema";
import type { ActivityEvent } from "@/persistence/activity";
import { Button } from "@/ui/Button";
import { relativeTime } from "@/lib/time";
import { ProjectCard } from "@/features/projects/ProjectCard";
import { NewProjectDialog } from "@/features/projects/NewProjectDialog";
import { CategoryIcon } from "@/features/projects/CategoryIcon";
import { useProjects } from "@/features/projects/store";

const ACTIVITY_LABEL: Record<ActivityEvent["type"], string> = {
  created: "criou",
  opened: "abriu",
  saved: "salvou",
  duplicated: "duplicou",
  deleted: "excluiu",
  imported: "importou",
  exported: "exportou",
};

export function DashboardPage() {
  const router = useRouter();
  const { summaries, activity, loaded, loadError, refresh, importFile } = useProjects();
  const [dialog, setDialog] = useState<{ open: boolean; category?: ProjectCategory }>({ open: false });
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const kpis = useMemo(() => {
    const weekAgo = Date.now() - 7 * 86400_000;
    return {
      total: summaries.length,
      active: summaries.filter((s) => s.status === "em-andamento").length,
      favorites: summaries.filter((s) => s.favorite).length,
      elements: summaries.reduce((acc, s) => acc + s.elementCount, 0),
      weekActivity: activity.filter((a) => new Date(a.at).getTime() >= weekAgo).length,
    };
  }, [summaries, activity]);

  const recent = summaries.slice(0, 6);
  const favorites = summaries.filter((s) => s.favorite).slice(0, 3);
  const inProgress = summaries.filter((s) => s.status === "em-andamento").slice(0, 5);

  return (
    <div className="mx-auto max-w-[1400px] px-8 py-7">
      <header className="flex items-end justify-between gap-6">
        <div>
          <div className="label-caps">Visão geral</div>
          <h1 className="mt-1 text-[24px] font-semibold tracking-tight">Seu estúdio de projetos</h1>
          <p className="mt-1 text-fg-muted">
            {new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}
          </p>
        </div>
        <div className="flex gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) {
                const p = await importFile(f);
                if (p) router.push(`/editor/${p.id}`);
              }
            }}
          />
          <Button icon={<Upload size={15} />} onClick={() => fileRef.current?.click()}>
            Importar JSON
          </Button>
          <Button variant="primary" icon={<FilePlus2 size={15} />} onClick={() => setDialog({ open: true })} data-testid="new-project">
            Novo projeto
          </Button>
        </div>
      </header>

      {loadError && (
        <div role="alert" className="mt-5 rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-[13px] text-[#ffd6d7]">
          Não foi possível ler seus projetos: {loadError}
        </div>
      )}

      <section className="mt-6 grid grid-cols-5 gap-3" aria-label="Indicadores">
        <Kpi icon={<Layers size={16} />} label="Projetos" value={kpis.total} />
        <Kpi icon={<Loader size={16} />} label="Em andamento" value={kpis.active} />
        <Kpi icon={<Star size={16} />} label="Favoritos" value={kpis.favorites} />
        <Kpi icon={<Boxes size={16} />} label="Elementos modelados" value={kpis.elements} />
        <Kpi icon={<Clock size={16} />} label="Ações nos últimos 7 dias" value={kpis.weekActivity} />
      </section>

      <div className="mt-8 grid grid-cols-[1fr_320px] gap-8">
        <div className="min-w-0 space-y-8">
          <section>
            <SectionTitle title="Projetos recentes" href={summaries.length > 0 ? "/projects" : undefined} />
            {!loaded ? (
              <div className="h-40 animate-pulse rounded-xl bg-ink-850" />
            ) : recent.length === 0 ? (
              <EmptyState onCreate={() => setDialog({ open: true })} />
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-4">
                {recent.map((p) => (
                  <ProjectCard key={p.id} project={p} />
                ))}
              </div>
            )}
          </section>

          <section>
            <SectionTitle title="Começar por categoria" />
            <div className="grid grid-cols-3 gap-2.5 xl:grid-cols-5">
              {CATEGORIES.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setDialog({ open: true, category: c.id })}
                  className="group flex items-center gap-3 rounded-lg border border-ink-700 bg-ink-850 px-3 py-3 text-left transition-colors hover:border-accent-line hover:bg-ink-800"
                >
                  <span className="flex size-8 items-center justify-center rounded-md bg-ink-750 text-fg-muted transition-colors group-hover:bg-accent-soft group-hover:text-accent">
                    <CategoryIcon category={c.id} size={16} />
                  </span>
                  <span className="text-[12.5px] font-medium">{c.label}</span>
                </button>
              ))}
            </div>
          </section>
        </div>

        <aside className="space-y-6">
          <Panel title="Em andamento">
            {inProgress.length === 0 ? (
              <p className="text-[12px] text-fg-subtle">Nenhum projeto em andamento.</p>
            ) : (
              <ul className="space-y-1">
                {inProgress.map((p) => (
                  <li key={p.id}>
                    <Link href={`/editor/${p.id}`} className="flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-ink-750">
                      <CategoryIcon category={p.category} size={14} className="text-fg-subtle" />
                      <span className="min-w-0 flex-1 truncate text-[12.5px]">{p.name}</span>
                      <span className="text-[11px] text-fg-subtle">{relativeTime(p.updatedAt)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {favorites.length > 0 && (
            <Panel title="Favoritos">
              <ul className="space-y-1">
                {favorites.map((p) => (
                  <li key={p.id}>
                    <Link href={`/editor/${p.id}`} className="flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-ink-750">
                      <Star size={13} className="text-warning" fill="currentColor" />
                      <span className="min-w-0 flex-1 truncate text-[12.5px]">{p.name}</span>
                      <span className="text-[11px] text-fg-subtle">{categoryLabel(p.category)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          <Panel title="Atividade">
            {activity.length === 0 ? (
              <p className="text-[12px] text-fg-subtle">Sua atividade aparecerá aqui.</p>
            ) : (
              <ol className="relative space-y-3 border-l border-ink-700 pl-4">
                {activity.slice(0, 10).map((a) => (
                  <li key={a.id} className="relative text-[12px] leading-snug">
                    <span className="absolute top-1.5 -left-[19.5px] size-1.5 rounded-full bg-accent" />
                    <span className="text-fg-muted">Você {ACTIVITY_LABEL[a.type]} </span>
                    <span className="text-fg">{a.projectName}</span>
                    <div className="text-[11px] text-fg-subtle">{relativeTime(a.at)}</div>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </aside>
      </div>

      <NewProjectDialog open={dialog.open} initialCategory={dialog.category} onClose={() => setDialog({ open: false })} />
    </div>
  );
}

function Kpi({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="panel rounded-xl border px-4 py-3.5">
      <div className="flex items-center gap-2 text-fg-subtle">
        {icon}
        <span className="text-[12px]">{label}</span>
      </div>
      <div className="mt-2 font-mono text-[26px] leading-none font-medium tracking-tight tabular-nums">{value.toLocaleString("pt-BR")}</div>
    </div>
  );
}

function SectionTitle({ title, href }: { title: string; href?: string }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="text-[14px] font-semibold">{title}</h2>
      {href && (
        <Link href={href} className="flex items-center gap-1 text-[12px] text-fg-muted hover:text-accent">
          Ver todos <ArrowRight size={13} />
        </Link>
      )}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="panel rounded-xl border p-4">
      <h3 className="label-caps mb-3">{title}</h3>
      {children}
    </section>
  );
}

function EmptyState({ onCreate }: { onCreate(): void }) {
  return (
    <div className="blueprint-bg flex flex-col items-center rounded-xl border border-dashed border-ink-600 px-6 py-12 text-center">
      <FolderOpen size={28} className="text-accent" />
      <h3 className="mt-3 text-[15px] font-semibold">Nenhum projeto ainda</h3>
      <p className="mt-1 max-w-sm text-fg-muted">Crie seu primeiro projeto para abrir o editor 3D e começar a modelar paredes, portas, janelas e pisos.</p>
      <Button variant="primary" className="mt-5" icon={<FilePlus2 size={15} />} onClick={onCreate}>
        Criar primeiro projeto
      </Button>
    </div>
  );
}
