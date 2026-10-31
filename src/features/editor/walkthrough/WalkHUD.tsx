"use client";

import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Hand, Lightbulb, LogOut, RotateCcw } from "lucide-react";
import { useEditor, type Quality } from "../store";
import { useWalk } from "./store";
import { cn } from "@/lib/cn";

/** Interface do passeio 3D (fora do canvas). */
export function WalkHUD() {
  const project = useEditor((s) => s.project);
  const quality = useEditor((s) => s.quality);
  const player = useWalk((s) => s.player);
  const interactable = useWalk((s) => s.interactable);
  const locked = useWalk((s) => s.locked);
  const lightsOn = useWalk((s) => s.lightsOn);
  const eyeHeight = useWalk((s) => s.eyeHeight);
  const w = useWalk.getState();
  if (!project) return null;
  const level = project.levels.find((l) => l.id === player?.levelId);
  const btn = "flex items-center gap-1.5 rounded-md border border-ink-600 bg-ink-850/92 px-2.5 py-1.5 text-[12px] text-fg-muted backdrop-blur hover:text-fg";

  const hold = (forward: number, right: number) => ({
    onPointerDown: () => w.setTouch({ forward, right }),
    onPointerUp: () => w.setTouch({ forward: 0, right: 0 }),
    onPointerLeave: () => w.setTouch({ forward: 0, right: 0 }),
  });

  return (
    <div className="pointer-events-none absolute inset-0 z-20" data-testid="walk-hud">
      {/* Mira */}
      <div className="absolute top-1/2 left-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/80 ring-2 ring-black/30" />

      <div className="absolute top-16 left-3 rounded-md border border-ink-600 bg-ink-850/92 px-3 py-2 font-mono text-[11.5px] text-fg-muted backdrop-blur" data-testid="walk-position">
        <div className="font-sans text-[12px] font-semibold text-fg">Passeio 3D · {level?.name ?? "—"}</div>
        {player && (
          <div>
            X {player.x.toFixed(2)} · Y {player.y.toFixed(2)} · Z {player.z.toFixed(2)} m
          </div>
        )}
      </div>

      <div className="pointer-events-auto absolute top-16 right-3 flex w-52 flex-col gap-1.5">
        <button className={btn} onClick={() => useEditor.getState().setViewMode("complete")} data-testid="exit-building">
          <LogOut size={14} /> Sair da construção
        </button>
        <button className={btn} onClick={() => w.respawn(null)} data-testid="reset-position">
          <RotateCcw size={14} /> Reiniciar na entrada
        </button>
        <div className="rounded-md border border-ink-600 bg-ink-850/92 p-2 text-[11.5px] text-fg-muted backdrop-blur">
          <div className="mb-1">Ir para o pavimento</div>
          <div className="flex flex-wrap gap-1">
            {project.levels.map((l) => (
              <button key={l.id} onClick={() => w.respawn(l.id)} className={cn("rounded px-2 py-0.5", l.id === player?.levelId ? "bg-accent-soft text-accent" : "bg-ink-750 hover:text-fg")}>
                {l.name}
              </button>
            ))}
          </div>
        </div>
        <button className={btn} onClick={() => w.toggleLights()}>
          <Lightbulb size={14} className={lightsOn ? "text-warning" : ""} /> Luzes internas {lightsOn ? "ligadas" : "desligadas"} (L)
        </button>
        <label className={cn(btn, "justify-between")}>
          Qualidade
          <select value={quality} onChange={(e) => useEditor.getState().setQuality(e.target.value as Quality)} className="bg-transparent text-fg">
            <option value="alta">Alta</option>
            <option value="media">Média</option>
            <option value="baixa">Baixa</option>
          </select>
        </label>
        <label className={cn(btn, "flex-col items-stretch")}>
          <span className="flex justify-between">Altura dos olhos <span className="font-mono text-fg">{eyeHeight.toFixed(2).replace(".", ",")} m</span></span>
          <input type="range" min={1} max={2} step={0.05} value={eyeHeight} onChange={(e) => w.setEyeHeight(Number(e.target.value))} className="accent-accent" />
        </label>
      </div>

      {interactable && (
        <div className="absolute bottom-24 left-1/2 -translate-x-1/2 rounded-lg border border-accent-line bg-ink-850/95 px-3 py-2 text-[13px] text-fg shadow-xl" data-testid="interact-prompt">
          <kbd className="mr-2 rounded border border-ink-500 bg-ink-750 px-1.5 font-mono">E</kbd>
          {interactable.label}
        </div>
      )}

      {!locked && (
        <div className="absolute bottom-6 left-1/2 w-[560px] -translate-x-1/2 rounded-xl border border-ink-600 bg-ink-850/95 px-4 py-3 text-[12px] text-fg-muted shadow-2xl backdrop-blur">
          <div className="mb-1 text-[13px] font-semibold text-fg">Clique na cena para controlar a visão com o mouse</div>
          <div className="grid grid-cols-3 gap-x-4 gap-y-0.5">
            <span><b className="text-fg">W A S D</b> mover</span>
            <span><b className="text-fg">Mouse</b> olhar</span>
            <span><b className="text-fg">Shift</b> correr</span>
            <span><b className="text-fg">Espaço</b> pular</span>
            <span><b className="text-fg">E</b> abrir/fechar porta</span>
            <span><b className="text-fg">Esc</b> soltar o mouse</span>
          </div>
          <div className="mt-1 text-[11px] text-fg-subtle">Sem mouse? Arraste na cena para olhar e use os botões de direção.</div>
        </div>
      )}

      {/* Controles na tela para iniciantes */}
      <div className="pointer-events-auto absolute bottom-6 left-4 grid grid-cols-3 gap-1">
        <span />
        <button className={btn} {...hold(1, 0)} aria-label="Avançar"><ArrowUp size={16} /></button>
        <span />
        <button className={btn} {...hold(0, -1)} aria-label="Esquerda"><ArrowLeft size={16} /></button>
        <button className={btn} {...hold(-1, 0)} aria-label="Recuar"><ArrowDown size={16} /></button>
        <button className={btn} {...hold(0, 1)} aria-label="Direita"><ArrowRight size={16} /></button>
        <button
          className={cn(btn, "col-span-3 justify-center")}
          disabled={!interactable}
          onClick={() => interactable?.kind === "door" && w.toggleDoor(interactable.elementId)}
        >
          <Hand size={14} /> Interagir
        </button>
      </div>
    </div>
  );
}
