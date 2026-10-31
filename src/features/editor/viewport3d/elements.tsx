"use client";

import { memo, useMemo } from "react";
import { Edges } from "@react-three/drei";
import type { BuildingObject, Door, Floor, Opening, Wall, Window } from "@/core/model/schema";
import { computeWallJoins, computeWallPieces, wallFrame, wallLocalToPlan, type WallExtension } from "@/core/geometry/wall";
import { objectParts } from "@/core/geometry/objects";
import { toThree } from "@/core/geometry/vec";
import { degToRad } from "@/core/units/units";
import { useEditor } from "../store";
import { EDGE_COLOR, EDGE_SELECTED, threeMaterial, type Highlight } from "./materials";

/** Nome do Object3D raiz de cada elemento (usado pelo gizmo de transformação). */
export const objectName = (id: string) => `el:${id}`;

function useHighlight(id: string): Highlight {
  return useEditor((s) => (s.selectedId === id ? "selected" : s.hoveredId === id ? "hover" : "none"));
}

/** Caixa com contorno (aparência CAD). */
function Block({ position, size, materialId, highlight, edges = true, rotation }: {
  position: [number, number, number];
  size: [number, number, number];
  materialId: string;
  highlight: Highlight;
  edges?: boolean;
  rotation?: [number, number, number];
}) {
  return (
    <mesh position={position} rotation={rotation} material={threeMaterial(materialId, highlight)} castShadow receiveShadow>
      <boxGeometry args={size} />
      {edges && <Edges threshold={20} color={highlight === "selected" ? EDGE_SELECTED : EDGE_COLOR} />}
    </mesh>
  );
}

const WallMesh = memo(function WallMesh({ wall, openings, ext }: { wall: Wall; openings: Opening[]; ext: WallExtension }) {
  const highlight = useHighlight(wall.id);
  const f = wallFrame(wall);
  const pieces = useMemo(() => computeWallPieces(wall, openings, ext), [wall, openings, ext]);
  const mid = wallLocalToPlan(f, f.length / 2);
  return (
    <group
      name={objectName(wall.id)}
      userData={{ elementId: wall.id }}
      position={toThree({ ...mid, z: wall.baseElevation })}
      rotation={[0, degToRad(f.angle), 0]}
    >
      {pieces.map((p, i) => (
        <Block
          key={i}
          position={[(p.u0 + p.u1) / 2 - f.length / 2, (p.v0 + p.v1) / 2, 0]}
          size={[p.u1 - p.u0, p.v1 - p.v0, wall.thickness]}
          materialId={wall.materialId}
          highlight={highlight}
        />
      ))}
    </group>
  );
});

const FRAME = 0.05;

function DoorParts({ door, wall, highlight }: { door: Door; wall: Wall; highlight: Highlight }) {
  const w = door.width;
  const h = Math.min(door.height, wall.height);
  const t = wall.thickness;
  const leafW = w - FRAME * 2;
  const hingeX = door.hinge === "left" ? -w / 2 + FRAME : w / 2 - FRAME;
  const dirX = door.hinge === "left" ? 1 : -1;
  // Folha entreaberta (30°) para o lado escolhido, deixando o vão visível.
  const sign = (door.hinge === "left" ? 1 : -1) * (door.opensTo === "left" ? 1 : -1);
  const angle = sign * degToRad(30);
  const faceZ = door.opensTo === "left" ? -t / 2 + 0.02 : t / 2 - 0.02;
  return (
    <>
      <Block position={[-w / 2 + FRAME / 2, h / 2, 0]} size={[FRAME, h, t + 0.01]} materialId={door.materialId} highlight={highlight} />
      <Block position={[w / 2 - FRAME / 2, h / 2, 0]} size={[FRAME, h, t + 0.01]} materialId={door.materialId} highlight={highlight} />
      <Block position={[0, h - FRAME / 2, 0]} size={[w, FRAME, t + 0.01]} materialId={door.materialId} highlight={highlight} />
      <group position={[hingeX, 0, faceZ]} rotation={[0, angle, 0]}>
        <Block position={[(dirX * leafW) / 2, (h - FRAME) / 2, 0]} size={[leafW, h - FRAME, 0.035]} materialId={door.materialId} highlight={highlight} />
        <Block position={[dirX * (leafW - 0.08), 1.05, 0]} size={[0.12, 0.02, 0.08]} materialId="steel-inox" highlight={highlight} edges={false} />
      </group>
    </>
  );
}

function WindowParts({ win, wall, highlight }: { win: Window; wall: Wall; highlight: Highlight }) {
  const w = win.width;
  const h = Math.min(win.height, wall.height - win.sillHeight);
  const depth = Math.min(0.08, wall.thickness);
  const glassW = w - FRAME * 2;
  const glassH = h - FRAME * 2;
  return (
    <>
      <Block position={[0, FRAME / 2, 0]} size={[w, FRAME, depth]} materialId={win.materialId} highlight={highlight} />
      <Block position={[0, h - FRAME / 2, 0]} size={[w, FRAME, depth]} materialId={win.materialId} highlight={highlight} />
      <Block position={[-w / 2 + FRAME / 2, h / 2, 0]} size={[FRAME, h, depth]} materialId={win.materialId} highlight={highlight} />
      <Block position={[w / 2 - FRAME / 2, h / 2, 0]} size={[FRAME, h, depth]} materialId={win.materialId} highlight={highlight} />
      {w > 1 && <Block position={[0, h / 2, 0]} size={[0.04, glassH, depth * 0.8]} materialId={win.materialId} highlight={highlight} />}
      <mesh position={[0, h / 2, 0]} material={threeMaterial("glass-clear", highlight)}>
        <boxGeometry args={[glassW, glassH, 0.012]} />
      </mesh>
      {win.sillHeight > 0.05 && (
        <Block position={[0, -0.015, 0]} size={[w + 0.06, 0.03, wall.thickness + 0.05]} materialId="marble-white" highlight={highlight} />
      )}
    </>
  );
}

const OpeningMesh = memo(function OpeningMesh({ opening, wall }: { opening: Opening; wall: Wall }) {
  const highlight = useHighlight(opening.id);
  const f = wallFrame(wall);
  const center = wallLocalToPlan(f, opening.offset);
  const sill = opening.type === "window" ? opening.sillHeight : 0;
  return (
    <group
      name={objectName(opening.id)}
      userData={{ elementId: opening.id }}
      position={toThree({ ...center, z: wall.baseElevation + sill })}
      rotation={[0, degToRad(f.angle), 0]}
    >
      {opening.type === "door" ? (
        <DoorParts door={opening} wall={wall} highlight={highlight} />
      ) : (
        <WindowParts win={opening} wall={wall} highlight={highlight} />
      )}
    </group>
  );
});

const FloorMesh = memo(function FloorMesh({ floor }: { floor: Floor }) {
  const highlight = useHighlight(floor.id);
  return (
    <group name={objectName(floor.id)} userData={{ elementId: floor.id }} position={toThree(floor.position)} rotation={[0, degToRad(floor.rotation), 0]}>
      <mesh position={[0, -floor.thickness / 2, 0]} material={threeMaterial(floor.materialId, highlight)} receiveShadow>
        <boxGeometry args={[floor.width, floor.thickness, floor.depth]} />
        <Edges threshold={20} color={highlight === "selected" ? EDGE_SELECTED : EDGE_COLOR} />
      </mesh>
    </group>
  );
});

const ObjectMesh = memo(function ObjectMesh({ obj }: { obj: BuildingObject }) {
  const highlight = useHighlight(obj.id);
  const parts = useMemo(() => objectParts(obj), [obj]);
  return (
    <group name={objectName(obj.id)} userData={{ elementId: obj.id }} position={toThree(obj.position)} rotation={[0, degToRad(obj.rotation), 0]}>
      {parts.map((p, i) =>
        p.shape === "box" ? (
          <Block key={i} position={[p.x, p.z, -p.y]} size={[p.sx, p.sz, p.sy]} materialId={p.materialId ?? obj.materialId} highlight={highlight} />
        ) : (
          <mesh key={i} position={[p.x, p.z, -p.y]} scale={[p.sx, p.sz, p.sy]} material={threeMaterial(p.materialId ?? obj.materialId, highlight)} castShadow receiveShadow>
            <cylinderGeometry args={[0.5, 0.5, 1, 32]} />
          </mesh>
        ),
      )}
    </group>
  );
});

/** Todos os elementos do projeto, derivados diretamente do modelo de domínio. */
export function SceneElements() {
  const elements = useEditor((s) => s.project?.elements);
  const data = useMemo(() => {
    const els = elements ?? [];
    const walls = els.filter((e): e is Wall => e.type === "wall");
    const openings = els.filter((e): e is Opening => e.type === "door" || e.type === "window");
    const byHost = new Map<string, Opening[]>();
    for (const o of openings) byHost.set(o.hostId, [...(byHost.get(o.hostId) ?? []), o]);
    return {
      walls,
      openings,
      byHost,
      joins: computeWallJoins(walls),
      wallById: new Map(walls.map((w) => [w.id, w])),
      floors: els.filter((e): e is Floor => e.type === "floor"),
      objects: els.filter((e): e is BuildingObject => e.type === "object"),
    };
  }, [elements]);

  return (
    <>
      {data.walls.map((w) => (
        <WallMesh key={w.id} wall={w} openings={data.byHost.get(w.id) ?? EMPTY} ext={data.joins.get(w.id) ?? NO_EXT} />
      ))}
      {data.openings.map((o) => {
        const host = data.wallById.get(o.hostId);
        return host ? <OpeningMesh key={o.id} opening={o} wall={host} /> : null;
      })}
      {data.floors.map((f) => (
        <FloorMesh key={f.id} floor={f} />
      ))}
      {data.objects.map((o) => (
        <ObjectMesh key={o.id} obj={o} />
      ))}
    </>
  );
}

const EMPTY: Opening[] = [];
const NO_EXT: WallExtension = { start: 0, end: 0 };
