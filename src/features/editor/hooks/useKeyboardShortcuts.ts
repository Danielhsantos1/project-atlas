"use client";

import { useEffect } from "react";
import { useEditor } from "../store";
import { DEFAULT_DOOR, DEFAULT_WINDOW } from "../panels/ToolPanel";
import { saveNow } from "./useAutosave";

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
}

export function useKeyboardShortcuts(onShowShortcuts: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useEditor.getState();
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      if (mod && key === "s") {
        e.preventDefault();
        void saveNow({ manual: true });
        return;
      }
      if (isTyping(e.target) || document.querySelector("[role=dialog]")) return;

      // Entrada numérica do comprimento da parede tem prioridade.
      if (!mod && s.typeLength(e.key)) {
        e.preventDefault();
        return;
      }

      if (mod) {
        if (key === "z" && e.shiftKey) s.redo();
        else if (key === "z") s.undo();
        else if (key === "y") s.redo();
        else if (key === "d") s.duplicateSelected();
        else return;
        e.preventDefault();
        return;
      }

      const step = (s.project?.settings.gridSize ?? 0.1) * (e.shiftKey ? 10 : 1);
      switch (e.key) {
        case "Escape": s.cancelTool(); break;
        case "Delete":
        case "Backspace": s.deleteSelected(); break;
        case "ArrowLeft": s.nudgeSelected({ x: -step, y: 0 }); break;
        case "ArrowRight": s.nudgeSelected({ x: step, y: 0 }); break;
        case "ArrowUp": s.nudgeSelected({ x: 0, y: step }); break;
        case "ArrowDown": s.nudgeSelected({ x: 0, y: -step }); break;
        case "Enter": s.finishChain(); break;
        case "[": s.togglePanel("left"); break;
        case "]": s.togglePanel("right"); break;
        case "?": onShowShortcuts(); break;
        default:
          switch (key) {
            case "v": s.setTool("select"); break;
            case "w": s.setTool("wall"); break;
            case "a": s.setTool("room"); break;
            case "p": s.setTool("floor"); break;
            case "d": s.activateLibraryItem(DEFAULT_DOOR); break;
            case "j": s.activateLibraryItem(DEFAULT_WINDOW); break;
            case "r": s.rotateSelected(e.shiftKey ? -90 : 90); break;
            case "f": s.requestCamera("fit"); break;
            case "t": s.requestCamera("top"); break;
            case "i": s.requestCamera("iso"); break;
            case "g": if (s.project) s.updateSettings({ snapToGrid: !s.project.settings.snapToGrid }); break;
            case "1": s.setView("3d"); break;
            case "2": s.setView("2d"); break;
            default: return;
          }
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onShowShortcuts]);
}
