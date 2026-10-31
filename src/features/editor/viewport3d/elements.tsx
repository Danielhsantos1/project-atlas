"use client";

import { memo, useMemo } from "react";
import * as THREE from "three";
import { Edges } from "@react-three/drei";
import type { BuildingObject, Door, Floor, Level, Opening, Project, Roof, Room, Wall, Window } from "@/core/model/schema";
import { roomShape, pointInPolygon, type RoomShape } from "@/core/geometry/rooms";
import { roofGeometry } from "@/core/geometry/roof";
import { computeWallJoins, computeWallPieces, wallFrame, wallLocalToPlan, type WallExtension } from "@/core/geometry/wall";
import { objectParts } from "@/core/geometry/objects";
import { toThree } from "@/core/geometry/vec";
import { degToRad } from "@/core/units/units";
import { useEditor } from "../store";
import { useWalk } from "../walkthrough/store";
import { EDGE_COLOR, EDGE_SELECTED, threeMaterial, threeMaterialDouble, type Highlight } from "./materials";

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

const WallMesh = memo(function WallMesh({ wall, openings, ext, materialId }: { wall: Wall; openings: Opening[]; ext: WallExtension; materialId?: string }) {
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
          materialId={materialId ?? wall.materialId}
          highlight={highlight}
        />
      ))}
    </group>
  );
});

const FRAME = 0.05;

function DoorParts({ door, wall, highlight, openAmount }: { door: Door; wall: Wall; highlight: Highlight; openAmount?: number }) {
  const w = door.width;
  const h = Math.min(door.height, wall.height);
  const t = wall.thickness;
  if (door.style === "opening") {
    // Vão livre: apenas o requadro (sem folha).
    return <Block position={[0, h - 0.01, 0]} size={[w, 0.02, t + 0.005]} materialId={door.materialId} highlight={highlight} edges={false} />;
  }
  if (door.style === "sliding") {
    const panel = (w - FRAME * 2) / 2 + 0.03;
    const slide = (openAmount ?? 0) * (panel - 0.06);
    const glassy = w <= 3;
    return (
      <>
        <Block position={[0, h - FRAME / 2, 0]} size={[w, FRAME, t + 0.01]} materialId={door.materialId} highlight={highlight} />
        <Block position={[-w / 2 + FRAME / 2, (h - FRAME) / 2, 0]} size={[FRAME, h - FRAME, t + 0.01]} materialId={door.materialId} highlight={highlight} />
        <Block position={[w / 2 - FRAME / 2, (h - FRAME) / 2, 0]} size={[FRAME, h - FRAME, t + 0.01]} materialId={door.materialId} highlight={highlight} />
        {[-1, 1].map((side) => (
          <group key={side} position={[side < 0 ? -(panel / 2 - 0.015) : panel / 2 - 0.015 - slide, (h - FRAME) / 2, side * 0.025]}>
            <Block position={[0, 0, 0]} size={[panel, h - FRAME, 0.03]} materialId={door.materialId} highlight={highlight} />
            {glassy && (
              <mesh material={threeMaterial("glass-clear", highlight)}>
                <boxGeometry args={[panel - 0.1, h - FRAME - 0.12, 0.035]} />
              </mesh>
            )}
          </group>
        ))}
      </>
    );
  }
  const leafW = w - FRAME * 2;
  const hingeX = door.hinge === "left" ? -w / 2 + FRAME : w / 2 - FRAME;
  const dirX = door.hinge === "left" ? 1 : -1;
  // Folha entreaberta (30°) para o lado escolhido, deixando o vão visível.
  const sign = (door.hinge === "left" ? 1 : -1) * (door.opensTo === "left" ? 1 : -1);
  const angle = sign * degToRad(openAmount === undefined ? 30 : 90 * openAmount);
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
  // No passeio, a folha reflete o estado real (aberta/fechada) usado pela colisão.
  const walking = useEditor((s) => s.viewMode === "walkthrough");
  const amount = useWalk((s) => s.doorAmount[opening.id] ?? 0);
  const openAmount = walking ? amount : undefined;
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
        <DoorParts door={opening} wall={wall} highlight={highlight} openAmount={openAmount} />
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

/** Material do núcleo construtivo (visualização da etapa de alvenaria). */
const CORE_MATERIAL: Record<Wall["core"], string> = {
  "ceramic-brick": "ceramic-brick",
  "concrete-block": "concrete-block",
  concrete: "concrete",
  drywall: "gypsum",
};

/** Filtro de visualização: tudo derivado do mesmo modelo, só muda o que é exibido. */
export interface SceneFilter {
  levels: ReadonlySet<string>;
  showRoofs: boolean;
  showCeilings: boolean;
  /** Etapa construtiva 1–8 (null = projeto completo). */
  stage: number | null;
  /** Mostrar apenas um ambiente (modo interiores). */
  interiorRoomId: string | null;
}

const STRUCTURE_KINDS = new Set(["column-rect", "column-round", "beam"]);
const LANDSCAPE_KINDS = new Set(["tree", "shrub", "pool"]);
const FIXTURE_KINDS = new Set(["toilet", "washbasin", "shower", "countertop", "sink-cabinet", "bath-vanity", "cabinet-base", "cabinet-wall", "kitchen-island", "cooktop", "oven-tower", "stair-straight"]);

function objectStage(o: BuildingObject): number {
  if (STRUCTURE_KINDS.has(o.kind)) return 3;
  if (o.kind === "stair-straight") return 3;
  if (LANDSCAPE_KINDS.has(o.kind)) return 8;
  if (FIXTURE_KINDS.has(o.kind)) return 7;
  return 8;
}
function floorStage(f: Floor): number {
  if (f.materialId === "grass" || f.materialId === "paving-stone") return 1;
  if (f.materialId.startsWith("concrete")) return 3;
  return 7;
}

const RoomMesh = memo(function RoomMesh({ room, shape, showCeiling }: { room: Room; shape: RoomShape; showCeiling: boolean }) {
  const highlight = useHighlight(room.id);
  const geometry = useMemo(() => {
    const sh = new THREE.Shape(shape.inner.map((p) => new THREE.Vector2(p.x, p.y)));
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.02, bevelEnabled: false });
    g.rotateX(-Math.PI / 2); // plano XY do domínio → XZ do Three (y do domínio vira −z)
    return g;
  }, [shape]);
  const ceiling = useMemo(() => {
    const sh = new THREE.Shape(shape.inner.map((p) => new THREE.Vector2(p.x, p.y)));
    const g = new THREE.ShapeGeometry(sh);
    g.rotateX(-Math.PI / 2);
    return g;
  }, [shape]);
  return (
    <group name={objectName(room.id)} userData={{ elementId: room.id }}>
      <mesh geometry={geometry} material={threeMaterial(room.materialId, highlight)} receiveShadow />
      {showCeiling && room.ceiling && (
        <mesh geometry={ceiling} position={[0, room.ceilingHeight, 0]} material={threeMaterialDouble(room.ceilingMaterialId)} />
      )}
    </group>
  );
});

const RoofMesh = memo(function RoofMesh({ roof }: { roof: Roof }) {
  const highlight = useHighlight(roof.id);
  const { surface, gables } = useMemo(() => {
    const g = roofGeometry(roof);
    const build = (tris: typeof g.surface) => {
      const pos: number[] = [];
      for (const t of tris) for (const [x, y, z] of t) pos.push(x, z, -y);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      geo.computeVertexNormals();
      return geo;
    };
    return { surface: build(g.surface), gables: g.gables.length ? build(g.gables) : null };
  }, [roof]);
  const mat = threeMaterialDouble(roof.materialId, highlight);
  const gableMat = threeMaterialDouble("paint-white");
  return (
    <group name={objectName(roof.id)} userData={{ elementId: roof.id }} position={toThree({ ...roof.position, z: roof.baseHeight })} rotation={[0, degToRad(roof.rotation), 0]}>
      <mesh geometry={surface} material={mat} castShadow receiveShadow position={[0, 0.06, 0]} />
      {gables && <mesh geometry={gables} material={gableMat} castShadow />}
    </group>
  );
});

/** Fundação conceitual: faixa sob as paredes do térreo (visualização, sem dimensionamento). */
function Foundation({ walls }: { walls: Wall[] }) {
  return (
    <>
      {walls.map((w) => {
        const f = wallFrame(w);
        const mid = wallLocalToPlan(f, f.length / 2);
        return (
          <mesh key={w.id} position={toThree({ ...mid, z: -0.25 })} rotation={[0, degToRad(f.angle), 0]} material={threeMaterial("concrete", "none")}>
            <boxGeometry args={[f.length + w.thickness, 0.5, w.thickness + 0.25]} />
          </mesh>
        );
      })}
    </>
  );
}

function LevelContent({ project, level, filter }: { project: Project; level: Level; filter: SceneFilter }) {
  const data = useMemo(() => {
    const els = project.elements;
    const walls = els.filter((e): e is Wall => e.type === "wall" && e.levelId === level.id);
    const wallIds = new Set(walls.map((w) => w.id));
    const openings = els.filter((e): e is Opening => (e.type === "door" || e.type === "window") && wallIds.has(e.hostId));
    const byHost = new Map<string, Opening[]>();
    for (const o of openings) byHost.set(o.hostId, [...(byHost.get(o.hostId) ?? []), o]);
    const rooms = els
      .filter((e): e is Room => e.type === "room" && e.levelId === level.id)
      .map((r) => ({ room: r, shape: roomShape(walls, r.seed) }))
      .filter((r): r is { room: Room; shape: RoomShape } => r.shape !== null);
    return {
      walls,
      openings,
      byHost,
      rooms,
      joins: computeWallJoins(walls),
      wallById: new Map(walls.map((w) => [w.id, w])),
      floors: els.filter((e): e is Floor => e.type === "floor" && e.levelId === level.id),
      objects: els.filter((e): e is BuildingObject => e.type === "object" && e.levelId === level.id),
      roofs: els.filter((e): e is Roof => e.type === "roof" && e.levelId === level.id),
    };
  }, [project.elements, level.id]);

  const stage = filter.stage;
  const interior = filter.interiorRoomId ? data.rooms.find((r) => r.room.id === filter.interiorRoomId) ?? null : null;
  const inInterior = (p: { x: number; y: number }) => !interior || pointInPolygon(p, interior.shape.axis);
  const wallVisible = (w: Wall) => (stage === null || stage >= 4) && (!interior || interior.shape.wallIds.includes(w.id));
  const finishes = stage === null || stage >= 7;

  return (
    <group position={[0, level.elevation, 0]}>
      {stage !== null && stage >= 2 && level.elevation <= 0.01 && <Foundation walls={data.walls} />}
      {data.walls.filter(wallVisible).map((w) => (
        <WallMesh
          key={w.id}
          wall={w}
          openings={data.byHost.get(w.id) ?? EMPTY}
          ext={data.joins.get(w.id) ?? NO_EXT}
          materialId={finishes ? undefined : CORE_MATERIAL[w.core]}
        />
      ))}
      {finishes &&
        data.openings.map((o) => {
          const host = data.wallById.get(o.hostId);
          return host && wallVisible(host) ? <OpeningMesh key={o.id} opening={o} wall={host} /> : null;
        })}
      {finishes &&
        data.rooms
          .filter((r) => !interior || r.room.id === interior.room.id)
          .map((r) => <RoomMesh key={r.room.id} room={r.room} shape={r.shape} showCeiling={filter.showCeilings} />)}
      {data.floors
        .filter((f) => (stage === null || stage >= floorStage(f)) && inInterior(f.position))
        .map((f) => (
          <FloorMesh key={f.id} floor={f} />
        ))}
      {data.objects
        .filter((o) => (stage === null || stage >= objectStage(o)) && inInterior(o.position))
        .map((o) => (
          <ObjectMesh key={o.id} obj={o} />
        ))}
      {filter.showRoofs && !interior && (stage === null || stage >= 5) && data.roofs.map((r) => <RoofMesh key={r.id} roof={r} />)}
    </group>
  );
}

/** Todos os elementos do projeto, derivados diretamente do modelo de domínio, por pavimento. */
export function SceneElements({ filter }: { filter: SceneFilter }) {
  const project = useEditor((s) => s.project);
  if (!project) return null;
  return (
    <>
      {project.levels
        .filter((l) => filter.levels.has(l.id))
        .map((l) => (
          <LevelContent key={l.id} project={project} level={l} filter={filter} />
        ))}
    </>
  );
}

const EMPTY: Opening[] = [];
const NO_EXT: WallExtension = { start: 0, end: 0 };
