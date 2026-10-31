"use client";

import { useEffect } from "react";
import { getProjectService } from "@/persistence/browser";
import { notify, reportError } from "@/ui/notifications";
import { useEditor } from "../store";

let inFlight: Promise<boolean> | null = null;

/**
 * Grava o projeto atual. Usa a revisão para controle de alterações: se o
 * usuário editar durante a gravação, o estado continua "não salvo" e um novo
 * ciclo de autosave é disparado.
 */
export async function saveNow(opts: { manual?: boolean } = {}): Promise<boolean> {
  // Captura síncrona: o editor pode ser descarregado enquanto aguardamos.
  const snapshot = useEditor.getState();
  const project = snapshot.project;
  const revision = snapshot.revision;
  if (!project) return false;
  if (!opts.manual && revision === snapshot.savedRevision) return true;
  if (inFlight) await inFlight;
  if (!opts.manual && revision <= useEditor.getState().savedRevision && useEditor.getState().project?.id === project.id) return true;
  useEditor.getState().markSaving();
  inFlight = (async () => {
    try {
      const saved = await getProjectService().save(project);
      // Ignora o retorno se o usuário já abriu outro projeto.
      if (useEditor.getState().project?.id === project.id) useEditor.getState().markSaved(revision, saved.updatedAt);
      if (opts.manual) notify("success", "Projeto salvo.");
      return true;
    } catch (error) {
      if (useEditor.getState().project?.id === project.id) {
        useEditor.getState().markSaveError(error instanceof Error ? error.message : String(error));
      }
      reportError(error);
      return false;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** Autosave com atraso após a última alteração + proteção ao fechar a aba. */
export function useAutosave(delayMs = 1000) {
  const revision = useEditor((s) => s.revision);
  const savedRevision = useEditor((s) => s.savedRevision);
  const dragging = useEditor((s) => s.dragOrigin !== null);

  useEffect(() => {
    if (revision === savedRevision || dragging) return;
    const t = setTimeout(() => void saveNow(), delayMs);
    return () => clearTimeout(t);
  }, [revision, savedRevision, dragging, delayMs]);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      const s = useEditor.getState();
      if (s.project && s.revision !== s.savedRevision) {
        void saveNow();
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      // Ao sair do editor (navegação interna), grava alterações pendentes.
      void saveNow();
    };
  }, []);
}
