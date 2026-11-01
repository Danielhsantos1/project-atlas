"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, Building2, FilePlus2, FolderOpen, Home, LayoutTemplate, Sofa, Sparkles } from "lucide-react";
import type { ProjectCategory } from "@/core/model/schema";
import { buildModernHouse } from "@/core/templates/modern-house";
import { interpretRequest, AI_DISCLAIMER, type Interpretation } from "@/ai/interpret";
import { generateHouse } from "@/ai/generate";
import { Dialog } from "@/ui/Dialog";
import { Button } from "@/ui/Button";
import { useProjects } from "@/features/projects/store";
import { NewProjectDialog } from "@/features/projects/NewProjectDialog";

const EXAMPLE = "Quero uma casa térrea de 150 metros quadrados, com três quartos, uma suíte, cozinha integrada, sala ampla, garagem para dois carros e piscina.";

/** Tela inicial ATLAS HOME BUILDER: caminhos simples, sem exigir conhecimento técnico. */
export function HomeBuilderHero() {
  const router = useRouter();
  const createFrom = useProjects((s) => s.createFrom);
  const [newDialog, setNewDialog] = useState<{ open: boolean; category?: ProjectCategory }>({ open: false });
  const [aiOpen, setAiOpen] = useState(false);
  const [tplOpen, setTplOpen] = useState(false);

  const cards = [
    { id: "ai", icon: Bot, title: "Criar minha casa", text: "Descreva a casa dos seus sonhos e receba um estudo inicial editável.", action: () => setAiOpen(true), primary: true },
    { id: "zero", icon: FilePlus2, title: "Começar do zero", text: "Desenhe cômodo a cômodo com ferramentas visuais.", action: () => setNewDialog({ open: true, category: "residencial" }) },
    { id: "tpl", icon: LayoutTemplate, title: "Escolher um modelo", text: "Comece de uma residência pronta e personalize.", action: () => setTplOpen(true) },
    { id: "open", icon: FolderOpen, title: "Abrir projeto existente", text: "Continue de onde parou.", action: () => router.push("/projects") },
    { id: "com", icon: Building2, title: "Criar projeto comercial", text: "Lojas, escritórios e salas comerciais.", action: () => setNewDialog({ open: true, category: "comercial" }) },
    { id: "int", icon: Sofa, title: "Criar ambientes internos", text: "Layout de interiores, móveis e acabamentos.", action: () => setNewDialog({ open: true, category: "interiores" }) },
  ];

  return (
    <section className="relative overflow-hidden rounded-2xl border border-ink-700 bg-gradient-to-br from-ink-800 via-ink-850 to-[#0d1830] p-7" aria-label="ATLAS Home Builder">
      <div className="blueprint-bg pointer-events-none absolute inset-0 opacity-60" />
      <div className="relative">
        <div className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.18em] text-accent"><Home size={14} /> ATLAS HOME BUILDER</div>
        <h1 className="mt-2 max-w-2xl text-[28px] leading-tight font-semibold tracking-tight">Construa a casa dos seus sonhos — visualmente, com precisão de projeto.</h1>
        <p className="mt-2 max-w-2xl text-fg-muted">Desenhe cômodos, veja em 3D na hora, caminhe por dentro e gere quantitativos e orçamento a partir do mesmo modelo.</p>
        <div className="mt-6 grid grid-cols-3 gap-3">
          {cards.map((c) => (
            <button
              key={c.id}
              onClick={c.action}
              data-testid={`home-${c.id}`}
              className={`group flex items-start gap-3 rounded-xl border p-4 text-left transition-all hover:-translate-y-0.5 ${c.primary ? "border-accent-line bg-accent-soft hover:bg-accent/20" : "border-ink-600 bg-ink-850/80 hover:border-ink-500"}`}
            >
              <span className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${c.primary ? "bg-accent text-white" : "bg-ink-750 text-fg-muted group-hover:text-accent"}`}>
                <c.icon size={19} />
              </span>
              <span>
                <span className="block text-[14px] font-semibold">{c.title}</span>
                <span className="mt-0.5 block text-[12px] leading-snug text-fg-muted">{c.text}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      <NewProjectDialog open={newDialog.open} initialCategory={newDialog.category} onClose={() => setNewDialog({ open: false })} />
      <AiDialog open={aiOpen} onClose={() => setAiOpen(false)} onCreate={async (interp) => {
        const p = await createFrom(generateHouse(interp.brief, `Minha casa — ${new Date().toLocaleDateString("pt-BR")}`));
        if (p) router.push(`/editor/${p.id}`);
      }} />
      <Dialog open={tplOpen} onClose={() => setTplOpen(false)} title="Escolher um modelo" description="Modelos são projetos completos e totalmente editáveis." width="lg">
        <button
          data-testid="template-modern-house"
          onClick={async () => {
            const p = await createFrom(buildModernHouse());
            if (p) router.push(`/editor/${p.id}`);
          }}
          className="flex w-full items-start gap-4 rounded-xl border border-ink-600 p-4 text-left hover:border-accent-line hover:bg-accent-soft"
        >
          <span className="flex size-12 items-center justify-center rounded-lg bg-accent-soft text-accent"><Building2 size={22} /></span>
          <span>
            <span className="block text-[14px] font-semibold">Residência moderna de dois pavimentos</span>
            <span className="mt-1 block text-[12.5px] text-fg-muted">Garagem para 2 carros, sala e cozinha com ilha integradas, 3 quartos (1 suíte), 2 banheiros + social, escada, área gourmet, piscina, jardim e muros. ~250 m² de área útil.</span>
          </span>
        </button>
      </Dialog>
    </section>
  );
}

function AiDialog({ open, onClose, onCreate }: { open: boolean; onClose(): void; onCreate(i: Interpretation): Promise<void> }) {
  const [text, setText] = useState(EXAMPLE);
  const [interp, setInterp] = useState<Interpretation | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onClose={onClose} title="ATLAS AI — Criar minha casa" description="Descreva com suas palavras. O assistente monta um estudo inicial que você ajusta no editor." width="lg">
      <textarea
        value={text}
        onChange={(e) => { setText(e.target.value); setInterp(null); }}
        rows={4}
        data-testid="ai-input"
        className="w-full rounded-md border border-ink-600 bg-ink-900 px-3 py-2 text-[13px] focus:border-accent focus:outline-none"
      />
      <div className="mt-3 flex justify-end gap-2">
        <Button icon={<Sparkles size={14} />} onClick={() => setInterp(interpretRequest(text))} data-testid="ai-interpret">Interpretar</Button>
      </div>
      {interp && (
        <div className="mt-4 grid grid-cols-2 gap-4 text-[12.5px]">
          <div>
            <div className="label-caps mb-1.5">Entendi</div>
            <ul className="space-y-1">{interp.understood.map((u) => <li key={u} className="text-fg">✓ {u}</li>)}</ul>
          </div>
          <div>
            <div className="label-caps mb-1.5">Suposições</div>
            <ul className="space-y-1 text-fg-muted">{interp.assumptions.length ? interp.assumptions.map((a) => <li key={a}>• {a}</li>) : <li>Nenhuma.</li>}</ul>
          </div>
          <p className="col-span-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-[12px] text-warning">{AI_DISCLAIMER}</p>
          <div className="col-span-2 flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button variant="primary" disabled={busy} data-testid="ai-create" onClick={async () => { setBusy(true); await onCreate(interp); setBusy(false); }}>
              Gerar estudo e abrir no editor
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
