import { create } from "zustand";
import { DomainError } from "@/core/model/errors";
import { PersistenceError } from "@/persistence/errors";

export type NoticeKind = "info" | "success" | "error";
export interface Notice {
  id: number;
  kind: NoticeKind;
  message: string;
}

interface NotificationsState {
  notices: Notice[];
  push(kind: NoticeKind, message: string): void;
  dismiss(id: number): void;
}

let seq = 0;

export const useNotifications = create<NotificationsState>((set, get) => ({
  notices: [],
  push(kind, message) {
    const id = ++seq;
    set({ notices: [...get().notices.slice(-3), { id, kind, message }] });
    setTimeout(() => get().dismiss(id), kind === "error" ? 6000 : 3200);
  },
  dismiss(id) {
    set({ notices: get().notices.filter((n) => n.id !== id) });
  },
}));

export const notify = (kind: NoticeKind, message: string) => useNotifications.getState().push(kind, message);

/**
 * Exibe erros esperados (regra de domínio / persistência) ao usuário.
 * Erros inesperados são relançados — nunca engolidos silenciosamente.
 */
export function reportError(error: unknown): void {
  if (error instanceof DomainError || error instanceof PersistenceError) {
    notify("error", error.message);
    return;
  }
  notify("error", "Erro inesperado. Detalhes no console do navegador.");
  throw error;
}
