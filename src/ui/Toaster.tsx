"use client";

import { CheckCircle2, Info, OctagonAlert, X } from "lucide-react";
import { useNotifications } from "./notifications";
import { cn } from "@/lib/cn";

export function Toaster() {
  const { notices, dismiss } = useNotifications();
  return (
    <div className="pointer-events-none fixed bottom-10 left-1/2 z-[100] flex -translate-x-1/2 flex-col items-center gap-2" aria-live="polite">
      {notices.map((n) => (
        <div
          key={n.id}
          role={n.kind === "error" ? "alert" : "status"}
          className={cn(
            "pointer-events-auto flex max-w-md animate-pop-in items-center gap-2.5 rounded-lg border px-3.5 py-2.5 text-[13px] shadow-2xl shadow-black/50 backdrop-blur",
            n.kind === "error" && "border-danger/40 bg-[#2a1416]/95 text-[#ffd6d7]",
            n.kind === "success" && "border-success/30 bg-[#11231b]/95 text-[#c9f5df]",
            n.kind === "info" && "border-ink-600 bg-ink-750/95 text-fg",
          )}
        >
          {n.kind === "error" ? <OctagonAlert size={16} className="shrink-0 text-danger" /> : n.kind === "success" ? <CheckCircle2 size={16} className="shrink-0 text-success" /> : <Info size={16} className="shrink-0 text-accent" />}
          <span>{n.message}</span>
          <button onClick={() => dismiss(n.id)} className="ml-1 text-fg-subtle hover:text-fg" aria-label="Fechar">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
