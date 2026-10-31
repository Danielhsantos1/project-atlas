"use client";

import { useMemo } from "react";
import { Line } from "@react-three/drei";
import type { Project } from "@/core/model/schema";
import { getLibraryItem } from "@/core/library/catalog";
import { wallFrame, wallLocalToPlan } from "@/core/geometry/wall";
import { distance, toThree, type Vec2 } from "@/core/geometry/vec";
import { degToRad } from "@/core/units/units";
import { useEditor } from "../store";
import { useCursor } from "../cursor";

const ACCENT = "#2f80ff";

/** Eixos X (vermelho), Y (verde) e Z (azul) — convenção do domínio. */
export function Axes() {
  return (
    <group>
      <Line points={[[0, 0.002, 0], [60, 0.002, 0]]} color="#ff4d5e" lineWidth={1.4} transparent opacity={0.85} />
      <Line points={[[0, 0.002, 0], [0, 0.002, -60]]} color="#4cd964" lineWidth={1.4} transparent opacity={0.85} />
      <Line points={[[0, 0, 0], [0, 3, 0]]} color="#3d8bff" lineWidth={1.4} transparent opacity={0.85} />
      <Line points={[[-60, 0.001, 0], [0, 0.001, 0]]} color="#ff4d5e" lineWidth={1} transparent opacity={0.25} />
      <Line points={[[0, 0.001, 0], [0, 0.001, 60]]} color="#4cd964" lineWidth={1} transparent opacity={0.25} />
    </group>
  );
}

/** Contorno do terreno (dimensões definidas no projeto). */
export function SiteOutline({ site }: { site: Project["site"] }) {
  const pts = useMemo(
    () =>
      [
        [0, 0],
        [site.width, 0],
        [site.width, site.depth],
        [0, site.depth],
        [0, 0],
      ].map(([x, y]) => toThree({ x: x!, y: y!, z: 0.003 })),
    [site.width, site.depth],
  );
  return <Line points={pts} color="#5a6b85" lineWidth={1} dashed dashSize={0.4} gapSize={0.25} transparent opacity={0.7} />;
}

function rectPoints(a: Vec2, b: Vec2, z: number) {
  return [
    { x: a.x, y: a.y },
    { x: b.x, y: a.y },
    { x: b.x, y: b.y },
    { x: a.x, y: b.y },
    { x: a.x, y: a.y },
  ].map((p) => toThree({ ...p, z }));
}

/** Pré-visualização das ferramentas de desenho (paredes, ambientes, pisos, inserção). */
export function ToolPreview() {
  const tool = useEditor((s) => s.tool);
  const point = useCursor((s) => s.point);
  const snap = useCursor((s) => s.snap);
  if (tool.kind === "select" || !point) return null;

  const marker = (
    <group position={toThree({ ...point, z: 0.01 })}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.07, 0.1, 32]} />
        <meshBasicMaterial color={snap === "endpoint" ? "#3ccf91" : ACCENT} depthTest={false} />
      </mesh>
    </group>
  );

  if (tool.kind === "wall" && tool.anchor) {
    const len = distance(tool.anchor, point);
    const f = wallFrame({ start: tool.anchor, end: point });
    const mid = wallLocalToPlan(f, len / 2);
    return (
      <>
        {marker}
        {len > 0.01 && (
          <mesh position={toThree({ ...mid, z: tool.preset.height / 2 })} rotation={[0, degToRad(f.angle), 0]}>
            <boxGeometry args={[len, tool.preset.height, tool.preset.thickness]} />
            <meshStandardMaterial color={ACCENT} transparent opacity={0.35} depthWrite={false} />
          </mesh>
        )}
      </>
    );
  }

  if ((tool.kind === "room" || tool.kind === "floor" || tool.kind === "roof") && tool.anchor) {
    const z = tool.kind === "room" ? tool.preset.height : 0.02;
    return (
      <>
        {marker}
        <Line points={rectPoints(tool.anchor, point, 0.02)} color={ACCENT} lineWidth={2} />
        {tool.kind === "room" && <Line points={rectPoints(tool.anchor, point, z)} color={ACCENT} lineWidth={1} transparent opacity={0.5} />}
      </>
    );
  }

  if (tool.kind === "place") {
    const item = getLibraryItem(tool.itemId);
    if (item?.spec.elementType === "object") {
      const s = item.spec;
      return (
        <>
          {marker}
          <mesh position={toThree({ ...point, z: (s.elevation ?? 0) + s.height / 2 })}>
            <boxGeometry args={[s.length, s.height, s.width]} />
            <meshStandardMaterial color={ACCENT} transparent opacity={0.3} depthWrite={false} />
          </mesh>
        </>
      );
    }
  }
  return marker;
}

