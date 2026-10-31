"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { GizmoHelper, GizmoViewport, Grid, OrbitControls, OrthographicCamera, PerspectiveCamera, TransformControls } from "@react-three/drei";
import { roomShape } from "@/core/geometry/rooms";
import { projectBounds } from "@/core/geometry/shapes";
import { levelWalls, moveElement } from "@/core/model/operations";
import { useEditor } from "../store";
import { useCursor } from "../cursor";
import { SceneElements, objectName, type SceneFilter } from "./elements";
import { Axes, SiteOutline, ToolPreview } from "./overlays";
import { LabelProjector, Labels3DOverlay } from "./labels";
import { FirstPersonController } from "../walkthrough/FirstPerson";
import { WalkHUD } from "../walkthrough/WalkHUD";
import { useWalk } from "../walkthrough/store";

/** Contrato mínimo dos controles orbitais usados pelo CameraRig. */
type OrbitLike = { target: THREE.Vector3; update(): void };

const GROUND = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const tmp = new THREE.Vector3();

/** Cota do pavimento ativo (o desenho acontece no plano desse pavimento). */
function activeElevation(): number {
  const s = useEditor.getState();
  return s.project?.levels.find((l) => l.id === s.activeLevelId)?.elevation ?? 0;
}

/** Interseção do raio do mouse com o plano do pavimento ativo, em coordenadas do domínio. */
function groundPoint(e: ThreeEvent<PointerEvent | MouseEvent>) {
  GROUND.constant = -activeElevation();
  return e.ray.intersectPlane(GROUND, tmp) ? { x: tmp.x, y: -tmp.z } : null;
}

function elementIdOf(obj: THREE.Object3D | null): string | null {
  while (obj) {
    const id = obj.userData?.elementId as string | undefined;
    if (id) return id;
    obj = obj.parent;
  }
  return null;
}

/** Captura de eventos: seleção, hover e ferramentas de desenho. */
function InteractionLayer({ children }: { children: React.ReactNode }) {
  const handlers = useMemo(
    () => ({
      onPointerMove(e: ThreeEvent<PointerEvent>) {
        e.stopPropagation();
        const s = useEditor.getState();
        if (s.viewMode === "walkthrough") return;
        const p = groundPoint(e);
        if (p) s.pointerMove(p, { shift: e.shiftKey });
        s.hover(s.tool.kind === "select" ? elementIdOf(e.object) : null);
      },
      onClick(e: ThreeEvent<MouseEvent>) {
        e.stopPropagation();
        if (e.delta > 5) return; // foi um arraste de câmera
        const s = useEditor.getState();
        if (s.viewMode === "walkthrough") return;
        if (s.tool.kind === "select") {
          s.select(elementIdOf(e.object));
          return;
        }
        const p = groundPoint(e);
        if (p) s.pointerClick(p, { shift: e.shiftKey });
      },
      onDoubleClick(e: ThreeEvent<MouseEvent>) {
        e.stopPropagation();
        useEditor.getState().finishChain();
      },
      onPointerLeave() {
        useEditor.getState().hover(null);
        useCursor.getState().clear();
      },
    }),
    [],
  );
  return (
    <group {...handlers}>
      {/* Plano de captura do piso (invisível, mas atingível pelo raio). */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.001 + useEditor((st) => st.project?.levels.find((l) => l.id === st.activeLevelId)?.elevation ?? 0), 0]}>
        <planeGeometry args={[4000, 4000]} />
        <meshBasicMaterial visible={false} />
      </mesh>
      {children}
    </group>
  );
}

/** Gizmo de translação no plano para o elemento selecionado (paredes, pisos, objetos). */
function SelectionGizmo() {
  const { scene } = useThree();
  const selectedId = useEditor((s) => s.selectedId);
  const tool = useEditor((s) => s.tool.kind);
  const elements = useEditor((s) => s.project?.elements);
  const grid = useEditor((s) => (s.project?.settings.snapToGrid ? s.project.settings.gridSize : null));
  const [target, setTarget] = useState<THREE.Object3D | null>(null);
  const start = useRef(new THREE.Vector3());

  const selected = elements?.find((e) => e.id === selectedId);
  const movable = tool === "select" && selected && (selected.type === "wall" || selected.type === "floor" || selected.type === "object");

  useEffect(() => {
    setTarget(movable && selectedId ? (scene.getObjectByName(objectName(selectedId)) ?? null) : null);
  }, [scene, selectedId, movable, elements]);

  if (!target || !selectedId) return null;
  return (
    <TransformControls
      object={target}
      mode="translate"
      showY={false}
      size={0.8}
      translationSnap={grid}
      onMouseDown={() => start.current.copy(target.position)}
      onMouseUp={() => {
        const d = target.position.clone().sub(start.current);
        if (d.lengthSq() < 1e-10) return;
        const ok = useEditor.getState().commit((p) => moveElement(p, selectedId, { x: d.x, y: -d.z }));
        if (!ok) target.position.copy(start.current);
      }}
    />
  );
}

/** Posiciona a câmera (enquadrar, vistas padrão) com transição suave. */
function CameraRig() {
  const { camera, controls } = useThree() as unknown as { camera: THREE.PerspectiveCamera; controls: OrbitLike | null };
  const cmd = useEditor((s) => s.camera);
  const anim = useRef<{ fromPos: THREE.Vector3; toPos: THREE.Vector3; fromT: THREE.Vector3; toT: THREE.Vector3; t: number } | null>(null);

  useEffect(() => {
    const project = useEditor.getState().project;
    if (!project || !controls) return;
    const b = projectBounds(project);
    const min = b ? b.min : { x: 0, y: 0 };
    const max = b ? b.max : { x: project.site.width, y: project.site.depth };
    const height = b ? b.maxZ : 2.8;
    const center = new THREE.Vector3((min.x + max.x) / 2, height / 3, -(min.y + max.y) / 2);
    const radius = Math.max(Math.hypot(max.x - min.x, max.y - min.y, height) / 2, 2.5);
    const dist = (radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.05;
    const dir =
      cmd.preset === "top" ? new THREE.Vector3(0, 1, 0.0001)
      : cmd.preset === "front" ? new THREE.Vector3(0, 0.12, 1)
      : cmd.preset === "right" ? new THREE.Vector3(1, 0.12, 0)
      : new THREE.Vector3(0.85, 0.75, 1);
    anim.current = {
      fromPos: camera.position.clone(),
      toPos: center.clone().add(dir.normalize().multiplyScalar(dist)),
      fromT: controls.target.clone(),
      toT: center,
      t: 0,
    };
  }, [cmd, camera, controls]);

  useFrame((_, dt) => {
    const a = anim.current;
    if (!a || !controls) return;
    a.t = Math.min(1, a.t + dt / 0.35);
    const k = 1 - Math.pow(1 - a.t, 3);
    camera.position.lerpVectors(a.fromPos, a.toPos, k);
    controls.target.lerpVectors(a.fromT, a.toT, k);
    controls.update();
    if (a.t >= 1) anim.current = null;
  });
  return null;
}

/** Filtro de visualização derivado do modo atual. */
function useSceneFilter(): SceneFilter {
  const project = useEditor((s) => s.project);
  const mode = useEditor((s) => s.viewMode);
  const active = useEditor((s) => s.activeLevelId);
  const stage = useEditor((s) => s.stage);
  const interiorRoomId = useEditor((s) => s.interiorRoomId);
  return useMemo(() => {
    const levels = project?.levels ?? [];
    const activeLevel = levels.find((l) => l.id === active);
    const upTo = (l: { elevation: number }) => !activeLevel || l.elevation <= activeLevel.elevation + 1e-6;
    const visible =
      mode === "dollhouse" ? levels.filter(upTo) : mode === "interior" ? levels.filter((l) => l.id === active) : levels;
    return {
      levels: new Set(visible.map((l) => l.id)),
      showRoofs: mode !== "dollhouse" && mode !== "interior" && !(mode === "section"),
      showCeilings: mode === "complete" || mode === "walkthrough" || mode === "facade",
      stage: mode === "construction" ? stage : null,
      interiorRoomId: mode === "interior" ? interiorRoomId : null,
    };
  }, [project?.levels, mode, active, stage, interiorRoomId]);
}

/** Planos de corte globais: casa aberta (dollhouse) e corte arquitetônico. */
function ClippingController() {
  const { gl } = useThree();
  const mode = useEditor((s) => s.viewMode);
  const section = useEditor((s) => s.section);
  const elevation = useEditor((s) => s.project?.levels.find((l) => l.id === s.activeLevelId)?.elevation ?? 0);
  useEffect(() => {
    const planes: THREE.Plane[] = [];
    if (mode === "dollhouse") planes.push(new THREE.Plane(new THREE.Vector3(0, -1, 0), elevation + 1.6));
    if (mode === "section") {
      planes.push(new THREE.Plane(new THREE.Vector3(0, -1, 0), elevation + section.height));
      // Mantém o lado com coordenada do domínio MAIOR que a posição do corte (remove a parte frontal/oeste).
      // Three: x_dom = x, y_dom = −z  ⇒  manter x ≥ pos  e  −z ≥ pos.
      if (section.axis === "x") planes.push(new THREE.Plane(new THREE.Vector3(1, 0, 0), -section.position));
      if (section.axis === "y") planes.push(new THREE.Plane(new THREE.Vector3(0, 0, -1), -section.position));
    }
    gl.clippingPlanes = planes;
    gl.localClippingEnabled = planes.length > 0;
    return () => {
      gl.clippingPlanes = [];
    };
  }, [gl, mode, section, elevation]);
  return null;
}

/** Câmera ortográfica para fachadas (vistas técnicas sem perspectiva). */
function FacadeCamera() {
  const side = useEditor((s) => s.facade);
  const project = useEditor((s) => s.project);
  const { size, controls } = useThree() as unknown as { size: { width: number; height: number }; controls: OrbitLike | null };
  const b = project ? projectBounds(project) : null;
  const min = b?.min ?? { x: 0, y: 0 };
  const max = b?.max ?? { x: project?.site.width ?? 10, y: project?.site.depth ?? 10 };
  const top = Math.max(b?.maxZ ?? 3, 3) + 2;
  const cx = (min.x + max.x) / 2;
  const cy = (min.y + max.y) / 2;
  const widthAlong = side === "front" || side === "back" ? max.x - min.x : max.y - min.y;
  const zoom = Math.min(size.width / (widthAlong * 1.3 + 2), size.height / (top * 1.4));
  const d = 200;
  const pos: [number, number, number] =
    side === "front" ? [cx, top / 2, -min.y + d] : side === "back" ? [cx, top / 2, -max.y - d] : side === "right" ? [max.x + d, top / 2, -cy] : [min.x - d, top / 2, -cy];
  // Os controles orbitais definem para onde a câmera olha: alinha o alvo ao centro da fachada.
  useEffect(() => {
    if (!controls) return;
    controls.target.set(cx, top / 2, -cy);
    controls.update();
  }, [controls, cx, cy, top, side]);
  return <OrthographicCamera makeDefault position={pos} zoom={zoom} near={0.1} far={1000} />;
}

/** Enquadra o ambiente escolhido no modo interiores. */
function InteriorFocus() {
  const { camera, controls } = useThree() as unknown as { camera: THREE.PerspectiveCamera; controls: OrbitLike | null };
  const roomId = useEditor((s) => s.interiorRoomId);
  const project = useEditor((s) => s.project);
  useEffect(() => {
    if (!project || !roomId || !controls) return;
    const room = project.elements.find((e) => e.id === roomId);
    if (!room || room.type !== "room") return;
    const shape = roomShape(levelWalls(project, room.levelId), room.seed);
    const level = project.levels.find((l) => l.id === room.levelId);
    if (!shape || !level) return;
    const xs = shape.inner.map((p) => p.x);
    const ys = shape.inner.map((p) => p.y);
    const c = new THREE.Vector3((Math.min(...xs) + Math.max(...xs)) / 2, level.elevation + 1, -(Math.min(...ys) + Math.max(...ys)) / 2);
    const r = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 3);
    controls.target.copy(c);
    camera.position.set(c.x + r * 0.9, c.y + r * 1.1, c.z + r * 0.9);
    controls.update();
  }, [roomId, project, camera, controls]);
  return null;
}

export default function Viewport3D() {
  const site = useEditor((s) => s.project?.site);
  const toolKind = useEditor((s) => s.tool.kind);
  const mode = useEditor((s) => s.viewMode);
  const quality = useEditor((s) => s.quality);
  const filter = useSceneFilter();
  const walking = mode === "walkthrough";
  const activeElev = useEditor((st) => st.project?.levels.find((l) => l.id === st.activeLevelId)?.elevation ?? 0);
  useEffect(() => {
    if (walking) {
      useWalk.getState().reset();
      useWalk.getState().respawn(null);
    }
  }, [walking]);
  if (!site) return null;
  return (
    <div className="relative size-full" data-testid="viewport-3d" style={{ cursor: toolKind === "select" ? "default" : "crosshair" }}>
      <Canvas
        shadows={quality !== "baixa"}
        dpr={quality === "alta" ? [1, 2] : 1}
        gl={{ antialias: true, preserveDrawingBuffer: true }}
        onPointerMissed={(e) => {
          if (e.type === "click" && useEditor.getState().tool.kind === "select") useEditor.getState().select(null);
        }}
      >
        <color attach="background" args={["#101318"]} />
        <hemisphereLight args={["#dde6ff", "#1a1d22", 0.9]} />
        <ambientLight intensity={0.25} />
        <directionalLight
          castShadow
          position={[18, 30, 12]}
          intensity={1.8}
          shadow-mapSize={quality === "alta" ? [2048, 2048] : [1024, 1024]}
          shadow-camera-left={-40}
          shadow-camera-right={40}
          shadow-camera-top={40}
          shadow-camera-bottom={-40}
          shadow-bias={-0.0004}
        />
        <directionalLight position={[-12, 10, -16]} intensity={0.35} />

        <Grid
          infiniteGrid
          cellSize={1}
          sectionSize={5}
          cellThickness={0.6}
          sectionThickness={1.1}
          cellColor="#262c35"
          sectionColor="#34465f"
          fadeDistance={120}
          fadeStrength={1.6}
          position={[0, -0.002, 0]}
        />
        <Axes />
        <SiteOutline site={site} />

        <InteractionLayer>
          <SceneElements filter={filter} />
        </InteractionLayer>

        {!walking && (
          <>
            <group position={[0, activeElev, 0]}>
              <ToolPreview />
            </group>
            <LabelProjector />
            <SelectionGizmo />
          </>
        )}
        {walking && <FirstPersonController />}
        {mode === "facade" ? <FacadeCamera /> : <PerspectiveCamera makeDefault position={[14, 12, 16]} fov={42} near={0.05} far={3000} />}
        {!walking && mode !== "facade" && <CameraRig />}
        <ClippingController />
        {mode === "interior" && <InteriorFocus />}

        {!walking && <OrbitControls makeDefault enableDamping dampingFactor={0.12} enableRotate={mode !== "facade"} maxPolarAngle={Math.PI / 2 - 0.01} minDistance={0.5} maxDistance={1500} />}
        {!walking && <GizmoHelper alignment="bottom-right" margin={[64, 64]}>
          <GizmoViewport axisColors={["#ff4d5e", "#3d8bff", "#4cd964"]} labels={["X", "Z", "−Y"]} labelColor="#0e1014" />
        </GizmoHelper>}
      </Canvas>
      {!walking && <Labels3DOverlay />}
      {walking && <WalkHUD />}
    </div>
  );
}
