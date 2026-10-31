"use client";

import { create } from "zustand";
import type { Vec2 } from "@/core/geometry/vec";
import type { SnapResult } from "@/core/geometry/snap";

/**
 * Posição do cursor no plano do projeto (alta frequência). Fica num store
 * separado para não re-renderizar o editor inteiro a cada movimento.
 */
interface CursorState {
  point: Vec2 | null;
  snap: SnapResult["kind"] | null;
  set(point: Vec2, snap: SnapResult["kind"]): void;
  clear(): void;
}

export const useCursor = create<CursorState>((set) => ({
  point: null,
  snap: null,
  set: (point, snap) => set({ point, snap }),
  clear: () => set({ point: null, snap: null }),
}));
