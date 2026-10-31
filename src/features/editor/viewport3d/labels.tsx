"use client";

import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { Element, Project } from "@/core/model/schema";
import { isWall } from "@/core/model/schema";
import { openingCenter, wallFrame, wallLocalToPlan } from "@/core/geometry/wall";
import { distance, toThree, type Vec2 } from "@/core/geometry/vec";
import { formatLength } from "@/core/units/units";
import { useEditor } from "../store";
import { useCursor } from "../cursor";

/**
 * Rótulos de medida do viewport 3D.
 *
 * São elementos DOM comuns numa camada sobre o canvas; um projetor dentro do
 * canvas converte a posição 3D em posição de tela a cada quadro. Evita criar
 * raízes React aninhadas por rótulo (mais leve e sem conflitos de montagem).
 */
export interface Label3D {
  key: string;
  position: [number, number, number];
  text: string;
}

const registry = new Map<string, { el: HTMLDivElement; pos: THREE.Vector3 }>();
const v = new THREE.Vector3();

function measureLabels(el: Element, project: Project): Label3D[] {
  const fmt = (m: number) => formatLength(m, project.settings.displayUnit);
  switch (el.type) {
    case "wall": {
      const f = wallFrame(el);
      const mid = wallLocalToPlan(f, f.length / 2, el.thickness / 2 + 0.25);
      return [{ key: "sel", position: toThree({ ...mid, z: el.baseElevation + el.height + 0.25 }), text: `${fmt(f.length)} · h ${fmt(el.height)} · e ${fmt(el.thickness)}` }];
    }
    case "door":
    case "window": {
      const host = project.elements.find((e) => e.id === el.hostId);
      if (!host || !isWall(host)) return [];
      const c = openingCenter(host, el);
      const sill = el.type === "window" ? ` · peitoril ${fmt(el.sillHeight)}` : "";
      return [{ key: "sel", position: toThree({ ...c, z: c.z + el.height / 2 + 0.2 }), text: `${fmt(el.width)} × ${fmt(el.height)}${sill}` }];
    }
    case "floor":
      return [{ key: "sel", position: toThree({ ...el.position, z: el.position.z + 0.3 }), text: `${fmt(el.width)} × ${fmt(el.depth)} · e ${fmt(el.thickness)}` }];
    case "object":
      return [{ key: "sel", position: toThree({ ...el.position, z: el.position.z + el.height + 0.25 }), text: `${fmt(el.length)} × ${fmt(el.width)} × ${fmt(el.height)}` }];
  }
}

function useLabels(): Label3D[] {
  const project = useEditor((s) => s.project);
  const selectedId = useEditor((s) => s.selectedId);
  const tool = useEditor((s) => s.tool);
  const point = useCursor((s) => s.point);
  if (!project) return [];
  const unit = project.settings.displayUnit;
  const labels: Label3D[] = [];
  const sel = project.elements.find((e) => e.id === selectedId);
  if (sel && tool.kind === "select") labels.push(...measureLabels(sel, project));
  if (point && tool.kind === "wall" && tool.anchor) {
    const mid: Vec2 = { x: (tool.anchor.x + point.x) / 2, y: (tool.anchor.y + point.y) / 2 };
    labels.push({ key: "tool", position: toThree({ ...mid, z: tool.preset.height + 0.3 }), text: tool.typed ? `${tool.typed} ↵` : formatLength(distance(tool.anchor, point), unit) });
  }
  if (point && (tool.kind === "room" || tool.kind === "floor") && tool.anchor) {
    const z = tool.kind === "room" ? tool.preset.height + 0.3 : 0.3;
    labels.push({
      key: "tool",
      position: toThree({ x: (tool.anchor.x + point.x) / 2, y: (tool.anchor.y + point.y) / 2, z }),
      text: `${formatLength(Math.abs(point.x - tool.anchor.x), unit)} × ${formatLength(Math.abs(point.y - tool.anchor.y), unit)}`,
    });
  }
  return labels;
}

/** Camada DOM (fora do canvas). */
export function Labels3DOverlay() {
  const labels = useLabels();
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {labels.map((l) => (
        <div
          key={l.key}
          data-testid="measure-label"
          ref={(el) => {
            if (el) registry.set(l.key, { el, pos: new THREE.Vector3(...l.position) });
            else registry.delete(l.key);
          }}
          className="absolute top-0 left-0 rounded bg-accent px-1.5 py-0.5 font-mono text-[11px] whitespace-nowrap text-white shadow-lg will-change-transform"
          style={{ visibility: "hidden" }}
        >
          {l.text}
        </div>
      ))}
    </div>
  );
}

/** Projetor (dentro do canvas): posiciona os rótulos a cada quadro. */
export function LabelProjector() {
  const { camera, size } = useThree();
  useFrame(() => {
    for (const { el, pos } of registry.values()) {
      v.copy(pos).project(camera);
      if (v.z > 1) {
        el.style.visibility = "hidden";
        continue;
      }
      const x = ((v.x + 1) / 2) * size.width;
      const y = ((1 - v.y) / 2) * size.height;
      el.style.transform = `translate(-50%, -50%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      el.style.visibility = "visible";
    }
  });
  return null;
}
