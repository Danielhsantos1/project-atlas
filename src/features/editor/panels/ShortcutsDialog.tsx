"use client";

import { Dialog } from "@/ui/Dialog";
import { Kbd } from "@/ui/Field";

export const SHORTCUTS: Array<[string, string[]]> = [
  ["Selecionar", ["V"]],
  ["Parede", ["W"]],
  ["Ambiente (4 paredes)", ["A"]],
  ["Piso", ["P"]],
  ["Porta", ["D"]],
  ["Janela", ["J"]],
  ["Modelo 3D / Planta 2D", ["1", "2"]],
  ["Enquadrar", ["F"]],
  ["Vista superior / perspectiva", ["T", "I"]],
  ["Desfazer", ["Ctrl", "Z"]],
  ["Refazer", ["Ctrl", "Shift", "Z"]],
  ["Salvar", ["Ctrl", "S"]],
  ["Duplicar", ["Ctrl", "D"]],
  ["Excluir", ["Del"]],
  ["Girar 90° (Shift: −90°)", ["R"]],
  ["Mover pela grade (Shift: ×10)", ["←", "↑", "→", "↓"]],
  ["Ortogonal ao desenhar", ["Shift"]],
  ["Comprimento exato da parede", ["0–9", "Enter"]],
  ["Cancelar / encerrar", ["Esc"]],
  ["Atrair à grade", ["G"]],
  ["Painéis laterais", ["[", "]"]],
];

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  return (
    <Dialog open={open} onClose={onClose} title="Atalhos de teclado" width="md">
      <dl className="grid grid-cols-1 gap-y-1.5">
        {SHORTCUTS.map(([label, keys]) => (
          <div key={label} className="flex items-center justify-between border-b border-ink-750 py-1 text-[12.5px]">
            <dt className="text-fg-muted">{label}</dt>
            <dd className="flex gap-1">{keys.map((k) => <Kbd key={k}>{k}</Kbd>)}</dd>
          </div>
        ))}
      </dl>
    </Dialog>
  );
}
