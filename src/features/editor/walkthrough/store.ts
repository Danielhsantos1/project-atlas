"use client";

import { create } from "zustand";
import type { PlayerState } from "@/walkthrough/controller";
import type { Interactable } from "@/walkthrough/interaction";

/**
 * Estado de execução do passeio 3D. NÃO faz parte do documento do projeto:
 * portas abertas, posição do jogador e luzes são estados da visita.
 */
interface WalkState {
  player: PlayerState | null;
  doorOpen: ReadonlySet<string>;
  /** Progresso visual da animação de cada porta (0 fechada → 1 aberta). */
  doorAmount: Readonly<Record<string, number>>;
  interactable: Interactable | null;
  locked: boolean;
  lightsOn: boolean;
  eyeHeight: number;
  /** Controles na tela (iniciantes): direção mantida pressionada. */
  touch: { forward: number; right: number };
  spawnNonce: number;
  spawnLevelId: string | null;
  setPlayer(p: PlayerState): void;
  toggleDoor(id: string): void;
  setDoorAmounts(a: Record<string, number>): void;
  setInteractable(i: Interactable | null): void;
  setLocked(v: boolean): void;
  toggleLights(): void;
  setEyeHeight(h: number): void;
  setTouch(t: Partial<WalkState["touch"]>): void;
  respawn(levelId?: string | null): void;
  reset(): void;
}

export const useWalk = create<WalkState>((set, get) => ({
  player: null,
  doorOpen: new Set(),
  doorAmount: {},
  interactable: null,
  locked: false,
  lightsOn: true,
  eyeHeight: 1.65,
  touch: { forward: 0, right: 0 },
  spawnNonce: 0,
  spawnLevelId: null,
  setPlayer: (player) => set({ player }),
  toggleDoor(id) {
    const next = new Set(get().doorOpen);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    set({ doorOpen: next });
  },
  setDoorAmounts: (doorAmount) => set({ doorAmount }),
  setInteractable(i) {
    const cur = get().interactable;
    if (cur?.elementId !== i?.elementId || cur?.label !== i?.label) set({ interactable: i });
  },
  setLocked: (locked) => set({ locked }),
  toggleLights: () => set({ lightsOn: !get().lightsOn }),
  setEyeHeight: (eyeHeight) => set({ eyeHeight: Math.min(2.0, Math.max(1.0, eyeHeight)) }),
  setTouch: (t) => set({ touch: { ...get().touch, ...t } }),
  respawn: (levelId = null) => set({ spawnNonce: get().spawnNonce + 1, spawnLevelId: levelId }),
  reset: () => set({ player: null, doorOpen: new Set(), doorAmount: {}, interactable: null, locked: false, touch: { forward: 0, right: 0 } }),
}));
