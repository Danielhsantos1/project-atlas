"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { FolderKanban, LayoutDashboard, Loader, Star } from "lucide-react";
import type { ReactNode } from "react";
import { Logo } from "@/ui/Logo";
import { MODULES } from "@/modules/registry";
import { cn } from "@/lib/cn";

const NAV = [
  { href: "/", label: "Visão geral", icon: LayoutDashboard, filter: null },
  { href: "/projects", label: "Biblioteca de projetos", icon: FolderKanban, filter: null },
  { href: "/projects?filter=favoritos", label: "Favoritos", icon: Star, filter: "favoritos" },
  { href: "/projects?filter=andamento", label: "Em andamento", icon: Loader, filter: "andamento" },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const filter = params.get("filter");

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="panel flex w-60 shrink-0 flex-col border-r">
        <div className="flex h-14 items-center border-b border-ink-700 px-4">
          <Logo />
        </div>
        <nav className="space-y-0.5 p-2">
          {NAV.map((item) => {
            const base = item.href.split("?")[0];
            const active = pathname === base && (item.filter ?? null) === (filter ?? null);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] transition-colors",
                  active ? "bg-accent-soft text-fg" : "text-fg-muted hover:bg-ink-750 hover:text-fg",
                )}
              >
                <item.icon size={16} className={active ? "text-accent" : ""} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-4 min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          <div className="label-caps mb-2">Módulos</div>
          <ul className="space-y-1.5">
            {MODULES.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2 text-[12px]" title={m.description}>
                <span className={m.status === "ativo" ? "text-fg-muted" : "text-fg-subtle"}>{m.name}</span>
                <span className={cn("size-1.5 shrink-0 rounded-full", m.status === "ativo" ? "bg-success" : "bg-ink-500")} aria-label={m.status} />
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11px] leading-relaxed text-fg-subtle">
            <span className="mr-1 inline-block size-1.5 rounded-full bg-success" /> ativo
            <span className="mr-1 ml-3 inline-block size-1.5 rounded-full bg-ink-500" /> planejado
          </p>
        </div>

        <div className="border-t border-ink-700 px-4 py-3 text-[11px] text-fg-subtle">
          Armazenamento local do navegador · v0.1
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
