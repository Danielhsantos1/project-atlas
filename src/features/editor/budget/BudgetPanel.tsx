"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Calculator, Camera, Database, FileText, Ruler, Trash2, Upload, X } from "lucide-react";
import { createId } from "@/core/model/ids";
import { formatArea, formatLength } from "@/core/units/units";
import {
  BUDGET_CATEGORIES, BUDGET_CATEGORY_LABEL, BudgetRepository, DEFAULT_TAKEOFF_PARAMS, EXAMPLE_PRICE_ITEMS, PRICE_SOURCE_KIND_LABEL, PRICE_STATUS_LABEL,
  addRegion, addSupplier, buildBudget, computeProposalTotals, createBudgetSnapshot, createEmptyPriceDatabase, createProposal, generateProposalPdf,
  importSinapiCsv, isBudgetCurrent, mapPriceToService, mergePriceItems, removePrice, takeoff, upsertPrice,
  type Budget, type BudgetLine, type BudgetSnapshot, type Client, type CompanyProfile, type PriceDatabase, type Proposal, type TakeoffParams,
} from "@/budget";
import { getProjectService } from "@/persistence/browser";
import { notify, reportError } from "@/ui/notifications";
import { Button } from "@/ui/Button";
import { cn } from "@/lib/cn";
import { useEditor } from "../store";
import { buildingMetrics } from "./metrics";

type Tab = "quantitativos" | "orcamento" | "precos" | "proposta";
const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const money = (n: number | null) => (n === null ? "—" : BRL.format(n));
const num = (n: number, d = 2) => n.toLocaleString("pt-BR", { maximumFractionDigits: d, minimumFractionDigits: d });
const today = () => new Date().toISOString().slice(0, 10);
const inp = "h-7 rounded border border-ink-600 bg-ink-900 px-2 text-[12px] focus:border-accent focus:outline-none";

/** ATLAS BUDGET: quantitativos, orçamento, banco de preços e proposta — tudo derivado do modelo. */
export function BudgetPanel({ onClose }: { onClose(): void }) {
  const project = useEditor((s) => s.project)!;
  const [tab, setTab] = useState<Tab>("quantitativos");
  const repo = useMemo(() => new BudgetRepository(window.localStorage), []);
  const [db, setDb] = useState<PriceDatabase>(createEmptyPriceDatabase());
  const [params, setParams] = useState<TakeoffParams>(DEFAULT_TAKEOFF_PARAMS);
  const [bdi, setBdi] = useState(0);
  const [regionId, setRegionId] = useState<string>("");
  const [includeOptional, setIncludeOptional] = useState(false);

  useEffect(() => {
    repo.getPriceDatabase().then(setDb).catch(reportError);
  }, [repo]);

  const saveDb = (next: PriceDatabase) => {
    setDb(next);
    repo.savePriceDatabase(next).catch(reportError);
  };

  const tk = useMemo(() => takeoff(project, params), [project, params]);
  const budget = useMemo(
    () => buildBudget(tk, db, { bdiPercent: bdi, regionId: regionId || undefined, includeOptional, today: today() }),
    [tk, db, bdi, regionId, includeOptional],
  );

  const tabs: Array<[Tab, string, React.ComponentType<{ size?: number }>]> = [
    ["quantitativos", "Quantitativos", Ruler],
    ["orcamento", "Orçamento", Calculator],
    ["precos", "Banco de preços", Database],
    ["proposta", "Proposta comercial", FileText],
  ];

  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-ink-900/97 backdrop-blur" data-testid="budget-panel">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-ink-700 px-4">
        <Calculator size={17} className="text-accent" />
        <span className="text-[13px] font-semibold tracking-wide">ATLAS BUDGET</span>
        <span className="text-[12px] text-fg-muted">{project.name}</span>
        <nav className="mx-auto flex gap-1 rounded-lg border border-ink-700 bg-ink-850 p-0.5">
          {tabs.map(([id, label, Icon]) => (
            <button key={id} data-testid={`budget-tab-${id}`} onClick={() => setTab(id)} className={cn("flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px]", tab === id ? "bg-ink-700 text-fg" : "text-fg-muted hover:text-fg")}>
              <Icon size={14} /> {label}
            </button>
          ))}
        </nav>
        <button onClick={onClose} className="rounded p-1.5 text-fg-muted hover:bg-ink-750 hover:text-fg" aria-label="Fechar orçamento" data-testid="budget-close"><X size={16} /></button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {tab === "quantitativos" && <QuantitiesTab budget={budget} params={params} setParams={setParams} />}
        {tab === "orcamento" && (
          <BudgetTab budget={budget} db={db} saveDb={saveDb} bdi={bdi} setBdi={setBdi} regionId={regionId} setRegionId={setRegionId} includeOptional={includeOptional} setIncludeOptional={setIncludeOptional} repo={repo} />
        )}
        {tab === "precos" && <PricesTab db={db} saveDb={saveDb} codes={tk.lines.map((l) => ({ code: l.code, description: l.description, unit: l.unit }))} />}
        {tab === "proposta" && <ProposalTab budget={budget} repo={repo} />}
      </div>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel rounded-xl border px-4 py-3">
      <div className="text-[11.5px] text-fg-subtle">{label}</div>
      <div className="mt-1 font-mono text-[18px] text-fg">{value}</div>
    </div>
  );
}

function Warnings({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="rounded-lg border border-warning/30 bg-warning/8 p-3 text-[12px] text-warning" role="alert" data-testid="budget-warnings">
      <div className="mb-1 flex items-center gap-1.5 font-semibold"><AlertTriangle size={14} /> Informações incompletas ou a revisar</div>
      <ul className="list-inside list-disc space-y-0.5">{items.map((w) => <li key={w}>{w}</li>)}</ul>
    </div>
  );
}

function QuantitiesTab({ budget, params, setParams }: { budget: Budget; params: TakeoffParams; setParams(p: TakeoffParams): void }) {
  const project = useEditor((s) => s.project)!;
  const m = useMemo(() => buildingMetrics(project), [project]);
  const tk = useMemo(() => takeoff(project, params), [project, params]);
  const unit = project.settings.displayUnit;
  return (
    <div className="space-y-5" data-testid="quantities-tab">
      <div className="grid grid-cols-4 gap-3">
        <Kpi label="Área construída (eixos)" value={formatArea(m.builtArea)} />
        <Kpi label="Área de piso (útil)" value={formatArea(m.usefulArea)} />
        <Kpi label="Área de paredes (1 face, líquida)" value={formatArea(m.wallNetArea)} />
        <Kpi label="Perímetro externo" value={formatLength(m.externalPerimeter, unit)} />
        <Kpi label="Cômodos" value={String(m.rooms)} />
        <Kpi label="Portas / janelas" value={`${m.doors} / ${m.windows}`} />
        <Kpi label="Área de cobertura" value={formatArea(m.roofArea)} />
        <Kpi label="Custo estimado (com preços cadastrados)" value={money(budget.total)} />
      </div>
      <Warnings items={[...m.openRooms.map((r) => `Ambiente "${r}" não está fechado por paredes.`), ...tk.warnings]} />
      <div className="flex flex-wrap items-end gap-4 rounded-lg border border-ink-700 p-3 text-[12px] text-fg-muted">
        <span className="font-medium text-fg">Parâmetros de referência (editáveis, não normativos):</span>
        <label className="flex items-center gap-2">Perda de piso (%) <input className={cn(inp, "w-16")} type="number" min={0} max={50} value={params.floorLossPercent} onChange={(e) => setParams({ ...params, floorLossPercent: Number(e.target.value) })} /></label>
        <label className="flex items-center gap-2">Demãos de tinta <input className={cn(inp, "w-14")} type="number" min={1} max={5} value={params.paintCoats} onChange={(e) => setParams({ ...params, paintCoats: Number(e.target.value) })} /></label>
        <label className="flex items-center gap-2">Rendimento (m²/L/demão) <input className={cn(inp, "w-16")} type="number" min={1} max={30} value={params.paintYieldM2PerLiterPerCoat} onChange={(e) => setParams({ ...params, paintYieldM2PerLiterPerCoat: Number(e.target.value) })} /></label>
      </div>
      <section>
        <h3 className="mb-2 text-[13px] font-semibold">Materiais e serviços levantados do modelo ({tk.lines.length})</h3>
        <table className="w-full text-[12px]" data-testid="takeoff-table">
          <thead className="text-left text-fg-subtle"><tr><th className="py-1.5">Código</th><th>Descrição</th><th className="text-right">Quantidade</th><th>Un.</th><th>Categoria</th><th>Memória de cálculo</th></tr></thead>
          <tbody>
            {tk.lines.map((l) => (
              <tr key={l.code} className="border-t border-ink-750">
                <td className="py-1.5 font-mono text-[11px] text-fg-subtle">{l.code}</td>
                <td>{l.description}{l.optional ? <span className="ml-1 text-fg-subtle">(opcional)</span> : null}</td>
                <td className="text-right font-mono">{num(l.quantity, 3)}</td>
                <td className="pl-2">{l.unit}</td>
                <td className="text-fg-muted">{BUDGET_CATEGORY_LABEL[l.category]}</td>
                <td className="max-w-80 truncate text-fg-subtle" title={l.basis}>{l.basis}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section>
        <h3 className="mb-2 text-[13px] font-semibold">Custo estimado por categoria</h3>
        <CategoryTotals budget={budget} />
      </section>
    </div>
  );
}

function CategoryTotals({ budget }: { budget: Budget }) {
  return (
    <div className="grid grid-cols-4 gap-2 text-[12px]">
      {BUDGET_CATEGORIES.map((c) => (
        <div key={c} className="flex justify-between rounded-md border border-ink-700 px-3 py-2">
          <span className="text-fg-muted">{BUDGET_CATEGORY_LABEL[c]}</span>
          <span className="font-mono">{money(budget.totalsByCategory[c])}</span>
        </div>
      ))}
    </div>
  );
}

function PriceEditor({ line, onSave }: { line: BudgetLine; onSave(m: number | null, l: number | null, e: number | null): void }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ m: line.unitMaterial ?? "", l: line.unitLabor ?? "", e: line.unitEquipment ?? "" });
  if (!open) return <button className="text-[11.5px] text-accent hover:underline" onClick={() => setOpen(true)} data-testid={`edit-price-${line.code}`}>editar</button>;
  const parse = (x: string | number) => (x === "" ? null : Number(String(x).replace(",", ".")));
  return (
    <span className="flex items-center gap-1">
      <input aria-label="Material" placeholder="Mat." className={cn(inp, "w-16")} value={v.m} onChange={(e) => setV({ ...v, m: e.target.value })} />
      <input aria-label="Mão de obra" placeholder="M.O." className={cn(inp, "w-16")} value={v.l} onChange={(e) => setV({ ...v, l: e.target.value })} />
      <input aria-label="Equipamento" placeholder="Eq." className={cn(inp, "w-14")} value={v.e} onChange={(e) => setV({ ...v, e: e.target.value })} />
      <button className="rounded bg-accent px-2 py-0.5 text-[11px] text-white" onClick={() => { onSave(parse(v.m), parse(v.l), parse(v.e)); setOpen(false); }}>ok</button>
    </span>
  );
}

const STATUS_STYLE: Record<BudgetLine["priceStatus"], string> = {
  ok: "bg-success/12 text-success",
  exemplo: "bg-warning/15 text-warning",
  desatualizado: "bg-warning/15 text-warning",
  "sem-preco": "bg-danger/15 text-danger",
};

function BudgetTab(props: {
  budget: Budget; db: PriceDatabase; saveDb(db: PriceDatabase): void; bdi: number; setBdi(n: number): void; regionId: string; setRegionId(s: string): void;
  includeOptional: boolean; setIncludeOptional(b: boolean): void; repo: BudgetRepository;
}) {
  const { budget, db, saveDb } = props;
  const project = useEditor((s) => s.project)!;
  const [snapshots, setSnapshots] = useState<BudgetSnapshot[]>([]);
  useEffect(() => {
    props.repo.listSnapshots(project.id).then(setSnapshots).catch(reportError);
  }, [props.repo, project.id]);

  const savePrice = (line: BudgetLine, m: number | null, l: number | null, e: number | null) => {
    const region = db.regions.find((r) => r.id === props.regionId)?.name ?? "não informada";
    saveDb(upsertPrice(db, {
      id: line.priceStatus !== "exemplo" && line.priceItemId ? line.priceItemId : createId(),
      serviceCode: line.code, description: line.description, unit: line.unit, material: m, labor: l, equipment: e, currency: "BRL",
      source: { kind: "usuario", name: "Informado pelo usuário", date: today(), region }, supplierId: null, notes: "",
    }));
  };

  return (
    <div className="space-y-4" data-testid="budget-tab">
      {db.items.length === 0 && (
        <div className="flex items-center gap-4 rounded-lg border border-accent-line bg-accent-soft p-4 text-[12.5px]">
          <span className="flex-1">Nenhum preço cadastrado. Cadastre preços reais no <b>Banco de preços</b> ou carregue os dados de exemplo (claramente identificados como EXEMPLO, não utilizáveis como orçamento real).</span>
          <Button variant="primary" data-testid="load-example-prices" onClick={() => saveDb(mergePriceItems(db, EXAMPLE_PRICE_ITEMS(today())))}>Carregar preços de EXEMPLO</Button>
        </div>
      )}
      {budget.examplePrices > 0 && (
        <div className="rounded-lg border-2 border-warning/60 bg-warning/10 p-3 text-[12.5px] font-medium text-warning" data-testid="example-banner">
          ATENÇÃO: {budget.examplePrices} linha(s) usam preços de EXEMPLO — valores ilustrativos, não utilizar como orçamento real.
        </div>
      )}
      <div className="flex flex-wrap items-center gap-4 text-[12px] text-fg-muted">
        <label className="flex items-center gap-2">BDI (%) <input className={cn(inp, "w-16")} type="number" min={0} max={100} value={props.bdi} onChange={(e) => props.setBdi(Number(e.target.value))} /></label>
        <label className="flex items-center gap-2">Região
          <select className={inp} value={props.regionId} onChange={(e) => props.setRegionId(e.target.value)}>
            <option value="">Sem fator regional</option>
            {db.regions.map((r) => <option key={r.id} value={r.id}>{r.name} (×{r.factor})</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2"><input type="checkbox" className="accent-accent" checked={props.includeOptional} onChange={(e) => props.setIncludeOptional(e.target.checked)} /> Incluir itens opcionais (equipamentos, mobiliário)</label>
        <span className="ml-auto">{budget.missingPrices} sem preço · {budget.examplePrices} exemplo · {budget.stalePrices} desatualizados</span>
      </div>
      <table className="w-full text-[12px]" data-testid="budget-table">
        <thead className="text-left text-fg-subtle"><tr><th className="py-1.5">Descrição</th><th className="text-right">Qtd.</th><th>Un.</th><th className="text-right">Material</th><th className="text-right">M. obra</th><th className="text-right">Equip.</th><th className="text-right">Total</th><th>Preço</th><th /></tr></thead>
        <tbody>
          {budget.lines.map((l) => (
            <tr key={l.code} className="border-t border-ink-750 align-middle">
              <td className="py-1.5">{l.description}<div className="font-mono text-[10.5px] text-fg-subtle">{l.code}{l.priceSource ? ` · ${PRICE_SOURCE_KIND_LABEL[l.priceSource.kind]} · ${l.priceSource.date}` : ""}</div></td>
              <td className="text-right font-mono">{num(l.quantity, 2)}</td>
              <td className="pl-2">{l.unit}</td>
              <td className="text-right font-mono">{money(l.unitMaterial)}</td>
              <td className="text-right font-mono">{money(l.unitLabor)}</td>
              <td className="text-right font-mono">{money(l.unitEquipment)}</td>
              <td className="text-right font-mono">{l.priceStatus === "sem-preco" ? "—" : money(l.total)}</td>
              <td className="pl-2"><span className={cn("rounded px-1.5 py-0.5 text-[10.5px]", STATUS_STYLE[l.priceStatus])}>{l.priceStatus === "sem-preco" ? "Preencher preço" : PRICE_STATUS_LABEL[l.priceStatus]}</span></td>
              <td className="pl-2">{l.origin === "modelo" && <PriceEditor line={l} onSave={(m, lb, e) => savePrice(l, m, lb, e)} />}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <CategoryTotals budget={budget} />
      <div className="flex items-center justify-end gap-6 border-t border-ink-700 pt-3 text-[13px]">
        <span>Subtotal <b className="font-mono">{money(budget.subtotal)}</b></span>
        <span>BDI <b className="font-mono">{money(budget.bdi)}</b></span>
        <span className="text-[15px]">Total <b className="font-mono text-accent" data-testid="budget-total">{money(budget.total)}</b></span>
        <Button data-testid="save-budget-version" onClick={async () => {
          try {
            const snap = createBudgetSnapshot(project, budget, { label: `Orçamento ${new Date().toLocaleString("pt-BR")}` });
            await props.repo.saveSnapshot(snap);
            setSnapshots(await props.repo.listSnapshots(project.id));
            notify("success", "Versão do orçamento salva e vinculada à revisão atual do projeto.");
          } catch (e) { reportError(e); }
        }}>Salvar versão do orçamento</Button>
      </div>
      {snapshots.length > 0 && (
        <section className="text-[12px]">
          <h3 className="mb-1 font-semibold">Versões salvas</h3>
          {snapshots.map((s) => (
            <div key={s.id} className="flex items-center gap-3 border-t border-ink-750 py-1.5">
              <span>{s.label}</span><span className="font-mono text-fg-subtle">rev. {s.revisionHash.slice(0, 8)}</span>
              <span className="font-mono">{money(s.budget.total)}</span>
              {isBudgetCurrent(s, project) ? <span className="text-success">corresponde ao projeto atual</span> : <span className="text-warning">projeto alterado depois desta versão</span>}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

function PricesTab({ db, saveDb, codes }: { db: PriceDatabase; saveDb(db: PriceDatabase): void; codes: Array<{ code: string; description: string; unit: string }> }) {
  const [sup, setSup] = useState({ name: "", contact: "", phone: "", email: "", region: "" });
  const [reg, setReg] = useState({ name: "", factor: "1" });
  const [uf, setUf] = useState("SP");
  const [importMsg, setImportMsg] = useState<string | null>(null);
  return (
    <div className="space-y-5 text-[12px]" data-testid="prices-tab">
      <div className="grid grid-cols-3 gap-4">
        <section className="rounded-lg border border-ink-700 p-3">
          <h3 className="mb-2 font-semibold">Fornecedores ({db.suppliers.length})</h3>
          {db.suppliers.map((s) => <div key={s.id} className="text-fg-muted">{s.name} · {s.region}</div>)}
          <div className="mt-2 grid grid-cols-2 gap-1">
            {(["name", "contact", "phone", "email", "region"] as const).map((k) => <input key={k} className={inp} placeholder={{ name: "Nome", contact: "Contato", phone: "Telefone", email: "E-mail", region: "Região" }[k]} value={sup[k]} onChange={(e) => setSup({ ...sup, [k]: e.target.value })} />)}
            <Button size="sm" disabled={!sup.name.trim()} onClick={() => { try { saveDb(addSupplier(db, sup).db); setSup({ name: "", contact: "", phone: "", email: "", region: "" }); } catch (e) { reportError(e); } }}>Cadastrar</Button>
          </div>
        </section>
        <section className="rounded-lg border border-ink-700 p-3">
          <h3 className="mb-2 font-semibold">Custos regionais ({db.regions.length})</h3>
          {db.regions.map((r) => <div key={r.id} className="text-fg-muted">{r.name} · fator ×{r.factor}</div>)}
          <div className="mt-2 flex gap-1">
            <input className={cn(inp, "flex-1")} placeholder="Região (ex.: Curitiba/PR)" value={reg.name} onChange={(e) => setReg({ ...reg, name: e.target.value })} />
            <input className={cn(inp, "w-16")} placeholder="Fator" value={reg.factor} onChange={(e) => setReg({ ...reg, factor: e.target.value })} />
            <Button size="sm" disabled={!reg.name.trim()} onClick={() => { try { saveDb(addRegion(db, { name: reg.name, factor: Number(reg.factor.replace(",", ".")) }).db); setReg({ name: "", factor: "1" }); } catch (e) { reportError(e); } }}>Adicionar</Button>
          </div>
        </section>
        <section className="rounded-lg border border-ink-700 p-3">
          <h3 className="mb-2 font-semibold">Importar tabela (formato SINAPI, CSV ;)</h3>
          <p className="mb-2 text-fg-subtle">Colunas: código; descrição; unidade; preço. Itens importados precisam ser vinculados a um serviço do modelo.</p>
          <div className="flex items-center gap-2">
            <input className={cn(inp, "w-14")} value={uf} onChange={(e) => setUf(e.target.value.toUpperCase())} aria-label="UF" />
            <label className="flex cursor-pointer items-center gap-1.5 rounded border border-ink-600 px-2 py-1 hover:text-fg"><Upload size={13} /> Arquivo CSV
              <input type="file" accept=".csv,text/csv" className="hidden" onChange={async (e) => {
                const f = e.target.files?.[0]; e.target.value = "";
                if (!f) return;
                const r = importSinapiCsv(await f.text(), { uf, date: today() });
                saveDb(mergePriceItems(db, r.items));
                setImportMsg(`${r.items.length} item(ns) importado(s); ${r.errors.length} linha(s) com erro${r.errors[0] ? ` (ex.: linha ${r.errors[0].line}: ${r.errors[0].message})` : ""}.`);
              }} />
            </label>
          </div>
          {importMsg && <p className="mt-2 text-fg-muted">{importMsg}</p>}
        </section>
      </div>
      <table className="w-full" data-testid="price-table">
        <thead className="text-left text-fg-subtle"><tr><th className="py-1.5">Descrição</th><th>Serviço vinculado</th><th>Un.</th><th className="text-right">Material</th><th className="text-right">M. obra</th><th className="text-right">Equip.</th><th>Fonte</th><th>Data</th><th>Região</th><th /></tr></thead>
        <tbody>
          {db.items.map((p) => (
            <tr key={p.id} className="border-t border-ink-750">
              <td className="py-1.5">{p.description}</td>
              <td>
                {p.serviceCode ?? (
                  <select className={inp} value="" onChange={(e) => saveDb(mapPriceToService(db, p.id, e.target.value || null))}>
                    <option value="">Vincular a…</option>
                    {codes.map((c) => <option key={c.code} value={c.code}>{c.description} ({c.unit})</option>)}
                  </select>
                )}
              </td>
              <td>{p.unit}</td>
              <td className="text-right font-mono">{money(p.material)}</td>
              <td className="text-right font-mono">{money(p.labor)}</td>
              <td className="text-right font-mono">{money(p.equipment)}</td>
              <td className={p.source.kind === "exemplo" ? "text-warning" : ""}>{PRICE_SOURCE_KIND_LABEL[p.source.kind]}{p.source.kind === "exemplo" ? " ⚠" : ""}</td>
              <td className="font-mono">{p.source.date}</td>
              <td>{p.source.region}</td>
              <td><button className="text-fg-subtle hover:text-danger" aria-label="Remover preço" onClick={() => saveDb(removePrice(db, p.id))}><Trash2 size={13} /></button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProposalTab({ budget, repo }: { budget: Budget; repo: BudgetRepository }) {
  const project = useEditor((s) => s.project)!;
  const [company, setCompany] = useState<CompanyProfile>({ name: "", document: "", address: "", phone: "", email: "" });
  const [clients, setClients] = useState<Client[]>([]);
  const [clientId, setClientId] = useState("");
  const [newClient, setNewClient] = useState({ name: "", contact: "", phone: "", email: "" });
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const rooms = project.elements.filter((e) => e.type === "room").map((r) => r.name);
  const [form, setForm] = useState({
    scope: `Execução da obra "${project.name}" conforme modelo do PROJECT ATLAS, compreendendo: ${rooms.join(", ")}.`,
    margin: 20, discount: 0, payment: "30% na assinatura, 70% em parcelas conforme medição.", deadline: 180, validity: 15, notes: "",
  });
  const [images, setImages] = useState<string[]>([]);

  useEffect(() => {
    Promise.all([repo.getCompanyProfile(), repo.listClients(), repo.listProposals(project.id)])
      .then(([c, cl, pr]) => {
        if (c) setCompany(c);
        setClients(cl);
        setClientId(cl[0]?.id ?? "");
        setProposals(pr);
      })
      .catch(reportError);
  }, [repo, project.id]);

  let totals: ReturnType<typeof computeProposalTotals> | null = null;
  let totalsError: string | null = null;
  try { totals = computeProposalTotals(budget, form.margin, form.discount); } catch (e) { totalsError = e instanceof Error ? e.message : String(e); }

  const capture = () => {
    const canvas = document.querySelector<HTMLCanvasElement>("[data-testid=viewport-3d] canvas");
    if (!canvas) { notify("info", "Abra uma vista 3D (ex.: Casa completa) para capturar imagens."); return; }
    setImages((imgs) => [...imgs, canvas.toDataURL("image/jpeg", 0.85)].slice(-4));
  };

  const download = (p: Proposal) => {
    const client = clients.find((c) => c.id === p.clientId);
    if (!client) { notify("error", "Cliente da proposta não encontrado."); return; }
    const bytes = generateProposalPdf({ proposal: p, company, client, totals: computeProposalTotals(p.budget, p.marginPercent, p.discountPercent) });
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
    const a = document.createElement("a");
    a.href = url; a.download = `${p.number}.pdf`; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  return (
    <div className="grid grid-cols-[1fr_360px] gap-6 text-[12.5px]" data-testid="proposal-tab">
      <div className="space-y-4">
        <section className="rounded-lg border border-ink-700 p-3">
          <h3 className="mb-2 font-semibold">Empresa</h3>
          <div className="grid grid-cols-3 gap-2">
            {(["name", "document", "phone", "email", "address"] as const).map((k) => (
              <input key={k} data-testid={`company-${k}`} className={cn(inp, k === "address" ? "col-span-2" : "")} placeholder={{ name: "Nome da empresa", document: "CNPJ", phone: "Telefone", email: "E-mail", address: "Endereço" }[k]} value={company[k] ?? ""} onChange={(e) => setCompany({ ...company, [k]: e.target.value })} />
            ))}
            <Button size="sm" onClick={() => repo.saveCompanyProfile(company).then(() => notify("success", "Dados da empresa salvos.")).catch(reportError)}>Salvar empresa</Button>
          </div>
        </section>
        <section className="rounded-lg border border-ink-700 p-3">
          <h3 className="mb-2 font-semibold">Cliente</h3>
          <select className={cn(inp, "mb-2 w-full")} value={clientId} onChange={(e) => setClientId(e.target.value)} data-testid="client-select">
            <option value="">Selecione…</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <div className="grid grid-cols-5 gap-2">
            {(["name", "contact", "phone", "email"] as const).map((k) => (
              <input key={k} data-testid={`client-${k}`} className={inp} placeholder={{ name: "Nome do cliente", contact: "Contato", phone: "Telefone", email: "E-mail" }[k]} value={newClient[k]} onChange={(e) => setNewClient({ ...newClient, [k]: e.target.value })} />
            ))}
            <Button size="sm" data-testid="client-add" disabled={!newClient.name.trim()} onClick={async () => {
              try {
                const c: Client = { id: createId(), ...newClient, document: "", address: "", createdAt: new Date().toISOString() };
                await repo.saveClient(c);
                setClients(await repo.listClients()); setClientId(c.id); setNewClient({ name: "", contact: "", phone: "", email: "" });
              } catch (e) { reportError(e); }
            }}>Cadastrar</Button>
          </div>
        </section>
        <section className="space-y-2 rounded-lg border border-ink-700 p-3">
          <h3 className="font-semibold">Escopo e condições</h3>
          <textarea className="w-full rounded border border-ink-600 bg-ink-900 p-2 text-[12px]" rows={3} value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })} aria-label="Escopo" />
          <div className="grid grid-cols-4 gap-2">
            <label>Margem (%)<input className={cn(inp, "w-full")} type="number" value={form.margin} onChange={(e) => setForm({ ...form, margin: Number(e.target.value) })} data-testid="proposal-margin" /></label>
            <label>Desconto (%)<input className={cn(inp, "w-full")} type="number" value={form.discount} onChange={(e) => setForm({ ...form, discount: Number(e.target.value) })} /></label>
            <label>Prazo (dias)<input className={cn(inp, "w-full")} type="number" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: Number(e.target.value) })} /></label>
            <label>Validade (dias)<input className={cn(inp, "w-full")} type="number" value={form.validity} onChange={(e) => setForm({ ...form, validity: Number(e.target.value) })} /></label>
          </div>
          <input className={cn(inp, "w-full")} value={form.payment} onChange={(e) => setForm({ ...form, payment: e.target.value })} aria-label="Condições de pagamento" />
          <textarea className="w-full rounded border border-ink-600 bg-ink-900 p-2 text-[12px]" rows={2} placeholder="Observações" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </section>
        <section className="rounded-lg border border-ink-700 p-3">
          <div className="mb-2 flex items-center justify-between"><h3 className="font-semibold">Imagens do projeto ({images.length}/4)</h3>
            <Button size="sm" icon={<Camera size={13} />} onClick={capture} data-testid="capture-image">Capturar vista 3D atual</Button></div>
          <div className="flex gap-2">{images.map((src, i) => (
            <div key={i} className="relative"><img src={src} alt={`Vista ${i + 1}`} className="h-20 rounded border border-ink-600" />
              <button className="absolute top-0.5 right-0.5 rounded bg-ink-900/80 p-0.5" onClick={() => setImages(images.filter((_, j) => j !== i))} aria-label="Remover imagem"><X size={11} /></button></div>
          ))}</div>
        </section>
      </div>
      <aside className="space-y-3">
        <div className="panel rounded-xl border p-4">
          <h3 className="mb-2 font-semibold">Resumo da proposta</h3>
          {totals ? (
            <div className="space-y-1 font-mono text-[12px]">
              <div className="flex justify-between"><span>Custo (orçamento)</span><span>{money(totals.cost)}</span></div>
              <div className="flex justify-between"><span>Margem</span><span>{money(totals.marginValue)}</span></div>
              <div className="flex justify-between"><span>Desconto</span><span>−{money(totals.discountValue)}</span></div>
              <div className="flex justify-between border-t border-ink-700 pt-1 text-[14px] text-accent"><span>Total</span><span data-testid="proposal-total">{money(totals.total)}</span></div>
            </div>
          ) : <p className="text-danger">{totalsError}</p>}
          {budget.missingPrices > 0 && <p className="mt-2 text-warning">{budget.missingPrices} item(ns) sem preço não entram no total.</p>}
          {budget.examplePrices > 0 && <p className="mt-1 font-medium text-warning">Contém preços de EXEMPLO (indicado no PDF).</p>}
          <Button variant="primary" className="mt-3 w-full" data-testid="generate-pdf" disabled={!clientId || !company.name.trim() || !totals} onClick={async () => {
            try {
              const p = createProposal({ project, client: { id: clientId }, budget, existingNumbers: proposals, scope: form.scope, marginPercent: form.margin, discountPercent: form.discount, paymentTerms: form.payment, deadlineDays: form.deadline, validityDays: form.validity, notes: form.notes, images });
              await repo.saveCompanyProfile(company);
              await repo.saveProposal({ ...p, status: "emitida" });
              setProposals(await repo.listProposals(project.id));
              download({ ...p, status: "emitida" });
              await getProjectService().save(project);
              notify("success", `Proposta ${p.number} gerada.`);
            } catch (e) { reportError(e); }
          }}>Gerar proposta em PDF</Button>
          {(!clientId || !company.name.trim()) && <p className="mt-2 text-[11.5px] text-fg-subtle">Informe a empresa e selecione um cliente.</p>}
        </div>
        {proposals.length > 0 && (
          <div className="panel rounded-xl border p-4">
            <h3 className="mb-2 font-semibold">Propostas emitidas</h3>
            {proposals.map((p) => (
              <div key={p.id} className="flex items-center justify-between border-t border-ink-750 py-1.5">
                <span>{p.number}<span className="ml-2 font-mono text-[10.5px] text-fg-subtle">rev. {p.version.revisionHash.slice(0, 8)}</span></span>
                <button className="text-accent hover:underline" onClick={() => download(p)}>PDF</button>
              </div>
            ))}
          </div>
        )}
      </aside>
    </div>
  );
}
