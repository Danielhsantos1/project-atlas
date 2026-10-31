"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CATEGORIES } from "@/core/model/categories";
import type { ProjectCategory } from "@/core/model/schema";
import { Dialog } from "@/ui/Dialog";
import { Button } from "@/ui/Button";
import { FieldLabel, TextInput } from "@/ui/Field";
import { cn } from "@/lib/cn";
import { CategoryIcon } from "./CategoryIcon";
import { useProjects } from "./store";

interface Props {
  open: boolean;
  onClose(): void;
  initialCategory?: ProjectCategory;
}

const num = (s: string) => Number(s.replace(",", "."));

export function NewProjectDialog({ open, onClose, initialCategory = "residencial" }: Props) {
  const router = useRouter();
  const create = useProjects((s) => s.create);
  const [name, setName] = useState("");
  const [category, setCategory] = useState<ProjectCategory>(initialCategory);
  const [width, setWidth] = useState("12");
  const [depth, setDepth] = useState("25");
  const [wallHeight, setWallHeight] = useState("2,80");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setCategory(initialCategory);
      setName("");
      setDescription("");
    }
  }, [open, initialCategory]);

  const errors: string[] = [];
  if (!name.trim()) errors.push("Dê um nome ao projeto.");
  if (!(num(width) > 0 && num(width) <= 10000) || !(num(depth) > 0 && num(depth) <= 10000)) errors.push("Dimensões do terreno devem estar entre 0 e 10.000 m.");
  if (!(num(wallHeight) >= 0.5 && num(wallHeight) <= 30)) errors.push("Pé-direito deve estar entre 0,5 e 30 m.");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (errors.length || busy) return;
    setBusy(true);
    const project = await create({
      name,
      category,
      description,
      site: { width: num(width), depth: num(depth) },
      defaultWallHeight: num(wallHeight),
    });
    setBusy(false);
    if (project) {
      onClose();
      router.push(`/editor/${project.id}`);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Novo projeto" description="Defina a categoria e as dimensões iniciais. Tudo pode ser alterado depois." width="lg">
      <form id="new-project" onSubmit={submit} className="space-y-5">
        <div>
          <FieldLabel htmlFor="np-name">Nome do projeto</FieldLabel>
          <TextInput id="np-name" data-autofocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Residência Vila Nova" maxLength={120} data-testid="project-name-input" />
        </div>

        <div>
          <FieldLabel>Categoria</FieldLabel>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Categoria">
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={category === c.id}
                onClick={() => setCategory(c.id)}
                data-testid={`category-${c.id}`}
                className={cn(
                  "flex items-start gap-2.5 rounded-lg border p-2.5 text-left transition-colors",
                  category === c.id ? "border-accent bg-accent-soft" : "border-ink-600 bg-ink-900 hover:border-ink-500",
                )}
              >
                <CategoryIcon category={c.id} size={16} className={cn("mt-0.5 shrink-0", category === c.id ? "text-accent" : "text-fg-subtle")} />
                <span>
                  <span className="block text-[12.5px] font-medium">{c.label}</span>
                  <span className="block text-[11px] leading-snug text-fg-subtle">{c.description}</span>
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <FieldLabel htmlFor="np-w">Terreno — largura (m)</FieldLabel>
            <TextInput id="np-w" inputMode="decimal" value={width} onChange={(e) => setWidth(e.target.value)} />
          </div>
          <div>
            <FieldLabel htmlFor="np-d">Terreno — profundidade (m)</FieldLabel>
            <TextInput id="np-d" inputMode="decimal" value={depth} onChange={(e) => setDepth(e.target.value)} />
          </div>
          <div>
            <FieldLabel htmlFor="np-h">Pé-direito padrão (m)</FieldLabel>
            <TextInput id="np-h" inputMode="decimal" value={wallHeight} onChange={(e) => setWallHeight(e.target.value)} />
          </div>
        </div>

        <div>
          <FieldLabel htmlFor="np-desc">Descrição (opcional)</FieldLabel>
          <textarea id="np-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={2000}
            className="w-full rounded-md border border-ink-600 bg-ink-900 px-2.5 py-2 text-[13px] placeholder:text-fg-subtle focus:border-accent focus:outline-none" placeholder="Cliente, endereço, observações…" />
        </div>

        {errors.length > 0 && name.length > 0 && <p className="text-[12px] text-warning">{errors[0]}</p>}

        <div className="flex justify-end gap-2 border-t border-ink-700 pt-4">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" type="submit" disabled={errors.length > 0 || busy} data-testid="create-project-submit">
            Criar e abrir editor
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
