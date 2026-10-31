"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { FilePlus2, Search, Upload } from "lucide-react";
import { CATEGORIES } from "@/core/model/categories";
import type { ProjectCategory } from "@/core/model/schema";
import { Button } from "@/ui/Button";
import { Select, TextInput } from "@/ui/Field";
import { cn } from "@/lib/cn";
import { ProjectCard } from "./ProjectCard";
import { NewProjectDialog } from "./NewProjectDialog";
import { useProjects } from "./store";

type Filter = "todos" | "favoritos" | "andamento" | "concluidos";
type Sort = "recentes" | "nome" | "criacao";

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "todos", label: "Todos" },
  { id: "favoritos", label: "Favoritos" },
  { id: "andamento", label: "Em andamento" },
  { id: "concluidos", label: "Concluídos" },
];

export function ProjectsLibraryPage() {
  const router = useRouter();
  const params = useSearchParams();
  const filter = (params.get("filter") as Filter | null) ?? "todos";
  const { summaries, loaded, loadError, refresh, importFile } = useProjects();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<ProjectCategory | "">("");
  const [sort, setSort] = useState<Sort>("recentes");
  const [dialogOpen, setDialogOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = summaries.filter((s) => {
      if (filter === "favoritos" && !s.favorite) return false;
      if (filter === "andamento" && s.status !== "em-andamento") return false;
      if (filter === "concluidos" && s.status !== "concluido") return false;
      if (category && s.category !== category) return false;
      return !q || s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q);
    });
    return filtered.sort((a, b) =>
      sort === "nome" ? a.name.localeCompare(b.name, "pt-BR") : sort === "criacao" ? b.createdAt.localeCompare(a.createdAt) : b.updatedAt.localeCompare(a.updatedAt),
    );
  }, [summaries, filter, category, query, sort]);

  return (
    <div className="mx-auto max-w-[1400px] px-8 py-7">
      <header className="flex items-end justify-between">
        <div>
          <div className="label-caps">Biblioteca</div>
          <h1 className="mt-1 text-[24px] font-semibold tracking-tight">Projetos</h1>
        </div>
        <div className="flex gap-2">
          <input ref={fileRef} type="file" accept="application/json,.json" className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) await importFile(f);
            }}
          />
          <Button icon={<Upload size={15} />} onClick={() => fileRef.current?.click()}>Importar JSON</Button>
          <Button variant="primary" icon={<FilePlus2 size={15} />} onClick={() => setDialogOpen(true)}>Novo projeto</Button>
        </div>
      </header>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg border border-ink-700 bg-ink-850 p-0.5">
          {FILTERS.map((f) => (
            <button key={f.id} onClick={() => router.replace(f.id === "todos" ? "/projects" : `/projects?filter=${f.id}`)}
              className={cn("rounded-md px-3 py-1.5 text-[12.5px] transition-colors", filter === f.id ? "bg-ink-700 text-fg" : "text-fg-muted hover:text-fg")}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative w-72">
          <Search size={14} className="absolute top-1/2 left-2.5 -translate-y-1/2 text-fg-subtle" />
          <TextInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por nome ou descrição" className="pl-8" />
        </div>
        <Select value={category} onChange={(e) => setCategory(e.target.value as ProjectCategory | "")} className="w-48" aria-label="Categoria">
          <option value="">Todas as categorias</option>
          {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </Select>
        <Select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="w-44" aria-label="Ordenação">
          <option value="recentes">Modificados recentemente</option>
          <option value="criacao">Data de criação</option>
          <option value="nome">Nome (A–Z)</option>
        </Select>
        <span className="ml-auto text-[12px] text-fg-subtle">{list.length} de {summaries.length} projetos</span>
      </div>

      {loadError && <div role="alert" className="mt-5 rounded-lg border border-danger/40 bg-danger/10 px-4 py-3">{loadError}</div>}

      <div className="mt-5 grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
        {list.map((p) => <ProjectCard key={p.id} project={p} />)}
      </div>
      {loaded && list.length === 0 && (
        <p className="mt-16 text-center text-fg-muted">
          {summaries.length === 0 ? "Nenhum projeto criado ainda." : "Nenhum projeto corresponde aos filtros."}
        </p>
      )}
      <NewProjectDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </div>
  );
}
