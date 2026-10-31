"use client";

import { useEffect, useState, type ReactNode } from "react";
import { MATERIALS, getMaterial } from "@/core/model/materials";
import { formatLength, parseLength, type LengthUnit } from "@/core/units/units";
import { cn } from "@/lib/cn";

const fieldBox =
  "h-7 w-full rounded border border-ink-600 bg-ink-900 px-2 font-mono text-[12px] text-fg transition-colors hover:border-ink-500 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25";

export function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="border-b border-ink-700 px-3.5 py-3">
      <div className="mb-2.5 flex items-center justify-between">
        <h3 className="label-caps">{title}</h3>
        {action}
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

export function Row({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="grid grid-cols-[92px_1fr] items-center gap-2" title={hint}>
      <span className="truncate text-[12px] text-fg-muted">{label}</span>
      {children}
    </div>
  );
}

export function Grid2({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-x-3 gap-y-2">{children}</div>;
}

/** Campo editável com confirmação em Enter/blur e reversão em Esc. */
function CommitInput({ display, onCommit, parse, suffix, testId, ariaLabel }: {
  display: string;
  onCommit(value: number): boolean;
  parse(text: string): { ok: true; value: number } | { ok: false; error: string };
  suffix?: string;
  testId?: string;
  ariaLabel: string;
}) {
  const [text, setText] = useState(display);
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setText(display);
  }, [display, focused]);

  function commit() {
    if (text === display) return;
    const r = parse(text);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setError(null);
    if (!onCommit(r.value)) setText(display);
  }

  return (
    <div className="relative">
      <input
        aria-label={ariaLabel}
        data-testid={testId}
        className={cn(fieldBox, suffix && "pr-8", error && "border-danger focus:border-danger")}
        value={text}
        onFocus={(e) => {
          setFocused(true);
          e.target.select();
        }}
        onBlur={() => {
          setFocused(false);
          commit();
        }}
        onChange={(e) => {
          setText(e.target.value);
          setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            commit();
            (e.target as HTMLInputElement).blur();
          } else if (e.key === "Escape") {
            setText(display);
            setError(null);
            (e.target as HTMLInputElement).blur();
          }
          e.stopPropagation();
        }}
        title={error ?? undefined}
      />
      {suffix && <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 font-mono text-[10.5px] text-fg-subtle">{suffix}</span>}
      {error && <p className="mt-1 text-[11px] text-danger" role="alert">{error}</p>}
    </div>
  );
}

export function LengthField({ label, value, unit, onCommit, testId, min }: {
  label: string;
  value: number;
  unit: LengthUnit;
  onCommit(meters: number): boolean;
  testId?: string;
  /** Valor mínimo em metros (inclusive). */
  min?: number;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-fg-subtle">{label}</span>
      <CommitInput
        ariaLabel={label}
        testId={testId}
        display={formatLength(value, unit, { withUnit: false, grouping: false, decimals: unit === "m" ? 3 : unit === "cm" ? 1 : 0 })}
        suffix={unit}
        onCommit={onCommit}
        parse={(t) => {
          const r = parseLength(t, unit);
          if (!r.ok) return { ok: false, error: r.error };
          if (min !== undefined && r.meters < min) return { ok: false, error: `Mínimo: ${formatLength(min, unit)}` };
          return { ok: true, value: r.meters };
        }}
      />
    </label>
  );
}

export function AngleField({ label, value, onCommit }: { label: string; value: number; onCommit(deg: number): boolean }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-fg-subtle">{label}</span>
      <CommitInput
        ariaLabel={label}
        display={value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}
        suffix="°"
        onCommit={onCommit}
        parse={(t) => {
          const n = Number(t.trim().replace(",", "."));
          return Number.isFinite(n) && t.trim() !== "" ? { ok: true, value: n } : { ok: false, error: "Ângulo inválido." };
        }}
      />
    </label>
  );
}

export function TextField({ label, value, onCommit, testId }: { label: string; value: string; onCommit(v: string): boolean; testId?: string }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => {
    if (text.trim() !== value && !onCommit(text.trim())) setText(value);
  };
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-fg-subtle">{label}</span>
      <input
        aria-label={label}
        data-testid={testId}
        className={cn(fieldBox, "font-sans")}
        value={text}
        maxLength={120}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setText(value);
            (e.target as HTMLInputElement).blur();
          }
          e.stopPropagation();
        }}
      />
    </label>
  );
}

const GROUPS = [...new Set(MATERIALS.map((m) => m.group))];

export function MaterialField({ value, onChange, label = "Material" }: { value: string; onChange(id: string): void; label?: string }) {
  const mat = getMaterial(value);
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-fg-subtle">{label}</span>
      <div className="relative">
        <span className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 rounded-sm border border-white/15" style={{ background: mat.color, opacity: Math.max(mat.opacity, 0.5) }} />
        <select
          aria-label={label}
          data-testid="material-select"
          className={cn(fieldBox, "cursor-pointer appearance-none pl-7 font-sans")}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          {GROUPS.map((g) => (
            <optgroup key={g} label={g}>
              {MATERIALS.filter((m) => m.group === g).map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
    </label>
  );
}

export function SelectField<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: ReadonlyArray<{ value: T; label: string }>; onChange(v: T): void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-fg-subtle">{label}</span>
      <select aria-label={label} className={cn(fieldBox, "cursor-pointer font-sans")} value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

export function ReadOnly({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="mb-1 block text-[11px] text-fg-subtle">{label}</span>
      <div className="flex h-7 items-center rounded border border-transparent bg-ink-800 px-2 font-mono text-[12px] text-fg-muted">{value}</div>
    </div>
  );
}

export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-[12px]">
      <span className="text-fg-muted">{label}</span>
      <span className="font-mono text-fg">{value}</span>
    </div>
  );
}
