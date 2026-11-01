"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Compass, Download, FileText, HardHat, Layers, X } from "lucide-react";
import { addElements } from "@/core/model/operations";
import { BudgetRepository } from "@/budget";
import { engineeringSummary, toModelElements, ROOF_COVER_TYPES, type EngineeringParams, type EngineeringSummary } from "@/engineering";
import { buildMemorial } from "@/memorial/build";
import { generateMemorialPdf } from "@/memorial/pdf";
import { MEMORIAL_STATUS } from "@/memorial/document";
import { downloadBytes, safeFileName } from "@/lib/download";
import { Button } from "@/ui/Button";
import { cn } from "@/lib/cn";
import { notify, reportError } from "@/ui/notifications";
import { useEditor } from "../store";

const n = (v: number, d = 2) => v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
const inp = "h-7 w-full rounded border border-ink-600 bg-ink-900 px-2 text-[12px] focus:border-accent focus:outline-none";

interface Form {
  rain: string;
  soil: string;
  cover: string;
  people: number;
  perCapita: number;
  days: number;
  fck: number;
  maxSpan: number;
}
const DEFAULT_FORM: Form = { rain: "", soil: "", cover: "auto", people: 2, perCapita: 150, days: 2, fck: 25, maxSpan: 5 };

const parsePositive = (s: string): number | undefined => {
  const v = Number(s.replace(",", "."));
  return s.trim() !== "" && Number.isFinite(v) && v > 0 ? v : undefined;
};

function toParams(f: Form): EngineeringParams {
  const rain = parsePositive(f.rain);
  const soil = parsePositive(f.soil);
  return {
    ...(rain !== undefined ? { rainIntensityMmH: rain } : {}),
    ...(soil !== undefined ? { soilAllowableKPa: soil } : {}),
    roof: f.cover !== "auto" ? { coverType: f.cover as never } : {},
    water: { peoplePerBedroom: f.people, perCapitaLPerDay: f.perCapita, reserveDays: f.days },
    structure: { fckMPa: f.fck, maxSpan: f.maxSpan },
  };
}

type Tab = "entradas" | "resultados" | "memorial";

/** Painel Engenharia: entradas do local, resultados de pré-dimensionamento e memorial. */
export function EngineeringPanel({ onClose }: { onClose(): void }) {
  const project = useEditor((s) => s.project)!;
  const [tab, setTab] = useState<Tab>("entradas");
  const storageKey = `atlas:v1:eng:${project.id}`;
  const [form, setForm] = useState<Form>(DEFAULT_FORM);
  const [company, setCompany] = useState("");

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) setForm({ ...DEFAULT_FORM, ...(JSON.parse(raw) as Partial<Form>) });
    } catch {
      // Entradas salvas ilegíveis: recomeça dos padrões (não afeta o projeto).
    }
    new BudgetRepository(window.localStorage).getCompanyProfile().then((c) => setCompany(c?.name ?? "")).catch(reportError);
  }, [storageKey]);

  const update = (patch: Partial<Form>) => {
    const next = { ...form, ...patch };
    setForm(next);
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      notify("info", "Não foi possível salvar as entradas de engenharia neste navegador.");
    }
  };

  const summary = useMemo<EngineeringSummary>(() => engineeringSummary(project, toParams(form)), [project, form]);

  const tabs: Array<[Tab, string, React.ComponentType<{ size?: number }>]> = [
    ["entradas", "Entradas do local", Compass],
    ["resultados", "Resultados", HardHat],
    ["memorial", "Memorial e exportações", FileText],
  ];

  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-ink-900/97 backdrop-blur" data-testid="engineering-panel">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-ink-700 px-4">
        <HardHat size={17} className="text-accent" />
        <span className="text-[13px] font-semibold tracking-wide">ENGENHARIA DE OBRA</span>
        <span className="rounded bg-warning/15 px-2 py-0.5 text-[11px] text-warning">pré-dimensionamento — não validado</span>
        <nav className="mx-auto flex gap-1 rounded-lg border border-ink-700 bg-ink-850 p-0.5">
          {tabs.map(([id, label, Icon]) => (
            <button key={id} data-testid={`eng-tab-${id}`} onClick={() => setTab(id)} className={cn("flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px]", tab === id ? "bg-ink-700 text-fg" : "text-fg-muted hover:text-fg")}>
              <Icon size={14} /> {label}
            </button>
          ))}
        </nav>
        <button onClick={onClose} className="rounded p-1.5 text-fg-muted hover:bg-ink-750 hover:text-fg" aria-label="Fechar engenharia" data-testid="eng-close"><X size={16} /></button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 text-[12.5px]">
        {summary.missingInputs.length > 0 && (
          <div className="mb-4 rounded-lg border border-danger/40 bg-danger/10 p-3 text-danger" role="alert" data-testid="eng-pending">
            <div className="mb-1 flex items-center gap-1.5 font-semibold"><AlertTriangle size={14} /> Pendências — o cálculo correspondente não foi feito</div>
            <ul className="list-inside list-disc space-y-0.5">{summary.missingInputs.map((m) => <li key={m}>{m}</li>)}</ul>
          </div>
        )}
        {tab === "entradas" && <Inputs form={form} update={update} />}
        {tab === "resultados" && <Results summary={summary} />}
        {tab === "memorial" && <MemorialTab summary={summary} company={company} />}
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-fg-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-fg-subtle">{hint}</span>}
    </label>
  );
}

function Inputs({ form, update }: { form: Form; update(p: Partial<Form>): void }) {
  return (
    <div className="grid max-w-4xl grid-cols-2 gap-6" data-testid="eng-inputs">
      <section className="space-y-3 rounded-xl border border-ink-700 p-4">
        <h3 className="font-semibold">Dados do local (obrigatórios para completar o cálculo)</h3>
        <Field label="Intensidade de chuva de projeto (mm/h)" hint="Sem valor padrão: consulte dados pluviométricos locais e a norma de águas pluviais (NBR 10844).">
          <input data-testid="eng-rain" className={inp} value={form.rain} onChange={(e) => update({ rain: e.target.value })} placeholder="ex.: informar valor do local" inputMode="decimal" />
        </Field>
        <Field label="Tensão admissível do solo (kPa)" hint="Sem valor padrão: depende da sondagem SPT e do projeto de fundações.">
          <input data-testid="eng-soil" className={inp} value={form.soil} onChange={(e) => update({ soil: e.target.value })} placeholder="ex.: informar valor da sondagem" inputMode="decimal" />
        </Field>
      </section>
      <section className="space-y-3 rounded-xl border border-ink-700 p-4">
        <h3 className="font-semibold">Parâmetros de projeto (padrões de referência editáveis)</h3>
        <Field label="Tipo de cobertura">
          <select className={inp} value={form.cover} onChange={(e) => update({ cover: e.target.value })} data-testid="eng-cover">
            <option value="auto">Inferir do material do telhado</option>
            {ROOF_COVER_TYPES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-3 gap-2">
          <Field label="Pessoas/dormitório"><input type="number" min={1} className={inp} value={form.people} onChange={(e) => update({ people: Number(e.target.value) || 1 })} /></Field>
          <Field label="Consumo (L/hab·dia)"><input type="number" min={50} className={inp} value={form.perCapita} onChange={(e) => update({ perCapita: Number(e.target.value) || 150 })} /></Field>
          <Field label="Reserva (dias)"><input type="number" min={1} className={inp} value={form.days} onChange={(e) => update({ days: Number(e.target.value) || 2 })} /></Field>
          <Field label="fck (MPa)"><input type="number" min={20} className={inp} value={form.fck} onChange={(e) => update({ fck: Number(e.target.value) || 25 })} /></Field>
          <Field label="Vão máx. (m)"><input type="number" min={2} step={0.5} className={inp} value={form.maxSpan} onChange={(e) => update({ maxSpan: Number(e.target.value) || 5 })} /></Field>
        </div>
        <p className="text-[11px] text-fg-subtle">Demais coeficientes (cargas, γ, taxas de aço) estão listados como premissas nos resultados e no memorial.</p>
      </section>
    </div>
  );
}

function Results({ summary }: { summary: EngineeringSummary }) {
  const project = useEditor((s) => s.project)!;
  const { water, structure, roofs } = summary;
  const commit = useEditor.getState().commit;
  return (
    <div className="space-y-6" data-testid="eng-results">
      {roofs && roofs.length > 0 && (
        <section>
          <h3 className="mb-2 text-[14px] font-semibold">Cobertura e calhas</h3>
          {roofs.map((r) => (
            <div key={r.roofId} className="mb-3 rounded-xl border border-ink-700 p-4">
              <div className="grid grid-cols-5 gap-3 font-mono">
                <Stat label="Tipo" value={r.cover.label} />
                <Stat label="Inclinação" value={`${n(r.pitchPercent, 1)}% (${n(r.pitchDeg, 1)}°)`} />
                <Stat label="Altura da cumeeira" value={`${n(r.riseM)} m`} />
                <Stat label="Área inclinada" value={`${n(r.inclinedAreaM2)} m²`} />
                <Stat label="Telhas (c/ perda)" value={r.tiles.count !== null ? `${n(r.tiles.count, 0)} un` : "chapas"} />
              </div>
              <p className={cn("mt-2", r.pitchCheck.ok ? "text-fg-muted" : "text-warning")} data-testid="roof-pitch-check">{r.pitchCheck.message}</p>
              {r.gutters ? (
                <table className="mt-2 w-full">
                  <thead className="text-left text-fg-subtle"><tr><th>Lado</th><th className="text-right">Área contrib. (m²)</th><th className="text-right">Vazão (L/min)</th><th className="text-right">Condutores</th><th>Calha</th></tr></thead>
                  <tbody>{r.gutters.sides.map((s) => (
                    <tr key={s.id} className="border-t border-ink-750"><td className="py-1">{s.label}</td><td className="text-right font-mono">{n(s.contributingAreaM2)}</td><td className="text-right font-mono">{n(s.flowLMin)}</td><td className="text-right font-mono">{s.leaders}</td><td>{s.diameterMm ? `Ø${s.diameterMm} mm` : <span className="text-danger">nenhuma atende</span>}</td></tr>
                  ))}</tbody>
                </table>
              ) : r.cover.id !== "flat-slab" && <p className="mt-2 text-danger">Calhas pendentes: informe a intensidade de chuva.</p>}
            </div>
          ))}
        </section>
      )}
      {water && (
        <section>
          <h3 className="mb-2 text-[14px] font-semibold">Água fria: caixa d&apos;água e pressão</h3>
          <div className="rounded-xl border border-ink-700 p-4">
            <div className="grid grid-cols-5 gap-3 font-mono">
              <Stat label="Ocupantes" value={String(water.occupants)} />
              <Stat label="Volume necessário" value={`${n(water.volume.requiredL, 0)} L`} />
              <Stat label="Reservatório" value={water.volume.tanks.map((t) => `${n(t, 0)} L`).join(" + ")} />
              <Stat label="Base (cota)" value={`${n(water.pressure.tankBaseElevation)} m`} />
              <Stat label="Carga na laje" value={`${n(water.tankLoad.totalKN, 1)} kN`} />
            </div>
            {water.location && <p className="mt-2 text-fg-muted" data-testid="tank-location">Melhor ponto: x = {n(water.location.x)} m, y = {n(water.location.y)} m. {water.location.reason}</p>}
            <p className="mt-1 text-fg-muted">{water.pressure.recommendation}</p>
            <table className="mt-2 w-full">
              <thead className="text-left text-fg-subtle"><tr><th>Ponto</th><th className="text-right">P. estática (mca)</th><th className="text-right">P. dinâmica (mca)</th><th>Situação</th></tr></thead>
              <tbody>{water.fixtures.map((f) => (
                <tr key={f.objectId} className="border-t border-ink-750"><td className="py-1">{f.name}</td><td className="text-right font-mono">{n(f.staticMca)}</td><td className="text-right font-mono">{n(f.dynamicMca)}</td><td className={f.status === "ok" ? "text-success" : "text-warning"}>{f.status}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </section>
      )}
      {structure && (
        <section>
          <h3 className="mb-2 text-[14px] font-semibold">Estrutura: pré-dimensionamento</h3>
          <div className="rounded-xl border border-ink-700 p-4">
            <div className="grid grid-cols-5 gap-3 font-mono">
              <Stat label="Pilares" value={String(structure.columns.length)} />
              <Stat label="Vigas" value={String(structure.beams.length + structure.baldrame.length)} />
              <Stat label="Lajes" value={String(structure.slabs.length)} />
              <Stat label="Concreto (s/ sapatas)" value={`${n(structure.quantities.concreteM3.total)} m³`} />
              <Stat label="Aço (s/ sapatas)" value={`${n(structure.quantities.steelKg.total, 0)} kg`} />
            </div>
            {!structure.foundation && <p className="mt-2 text-danger">Fundação pendente: informe a tensão admissível do solo.</p>}
            <div className="mt-3 flex items-center gap-3">
              <Button
                data-testid="eng-launch-structure"
                icon={<Layers size={14} />}
                onClick={() => {
                  const els = toModelElements(project, structure);
                  if (commit((p) => addElements(p, els))) notify("success", `${els.length} elementos estruturais lançados no modelo (pilares e vigas). Use desfazer para remover.`);
                }}
              >
                Lançar pilares e vigas no modelo
              </Button>
              <span className="text-fg-subtle">Insere objetos editáveis nas posições calculadas.</span>
            </div>
          </div>
        </section>
      )}
      {summary.warnings.length > 0 && (
        <section className="rounded-xl border border-warning/30 bg-warning/8 p-4 text-warning">
          <h3 className="mb-1 font-semibold">Avisos ({summary.warnings.length})</h3>
          <ul className="list-inside list-disc space-y-0.5">{summary.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-sans text-[11px] text-fg-subtle">{label}</div>
      <div className="mt-0.5 text-[13px] text-fg">{value}</div>
    </div>
  );
}

function MemorialTab({ summary, company }: { summary: EngineeringSummary; company: string }) {
  const project = useEditor((s) => s.project)!;
  const [client, setClient] = useState("");
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const generate = () => {
    setBusy(true);
    try {
      const doc = buildMemorial({ project, summary, company, ...(client ? { client } : {}), ...(address ? { address } : {}) });
      const { bytes, pages } = generateMemorialPdf(doc);
      downloadBytes(`${safeFileName(project.name)}-memorial-de-calculo.pdf`, bytes, "application/pdf");
      notify("success", `Memorial gerado (${pages} páginas) como RASCUNHO para revisão do engenheiro.`);
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="max-w-3xl space-y-4" data-testid="eng-memorial">
      <div className="rounded-xl border border-warning/40 bg-warning/10 p-4 text-warning">
        <b>{MEMORIAL_STATUS}</b>
        <p className="mt-1 text-[12px]">O memorial reúne fórmulas, premissas, quadros e pendências. Os campos de responsável técnico, CREA/CAU, ART/RRT e assinatura saem em branco: o documento só tem valor depois de revisado e assinado por profissional habilitado.</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Cliente (opcional)"><input className={inp} value={client} onChange={(e) => setClient(e.target.value)} /></Field>
        <Field label="Endereço da obra (opcional)"><input className={inp} value={address} onChange={(e) => setAddress(e.target.value)} /></Field>
      </div>
      {!company && <p className="text-fg-subtle">Dica: cadastre o nome da empresa em Orçamento → Proposta comercial para ele aparecer na capa.</p>}
      <Button variant="primary" icon={<Download size={14} />} disabled={busy} onClick={generate} data-testid="eng-generate-memorial">Gerar memorial de cálculo (PDF)</Button>
      {summary.missingInputs.length > 0 && <p className="text-danger">O memorial será gerado com as pendências listadas na capa.</p>}
    </div>
  );
}
