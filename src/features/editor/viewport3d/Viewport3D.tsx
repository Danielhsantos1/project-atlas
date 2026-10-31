"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { GizmoHelper, GizmoViewport, Grid, OrbitControls, TransformControls } from "@react-three/drei";
import { projectBounds } from "@/core/geometry/shapes";
import { moveElement } from "@/core/model/operations";
import { useEditor } from "../store";
import { useCursor } from "../cursor";
import { SceneElements, objectName } from "./elements";
import { Axes, SiteOutline, ToolPreview } from "./overlays";
import { LabelProjector, Labels3DOverlay } from "./labels";

/** Contrato mínimo dos controles orbitais usados pelo CameraRig. */
type OrbitLike = { target: THREE.Vector3; update(): void };

const GROUND = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const tmp = new THREE.Vector3();

/** Interseção do raio do mouse com o plano do piso (Z = 0), já em coordenadas do domínio. */
function groundPoint(e: ThreeEvent<PointerEvent | MouseEvent>) {
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
        const p = groundPoint(e);
        if (p) s.pointerMove(p, { shift: e.shiftKey });
        s.hover(s.tool.kind === "select" ? elementIdOf(e.object) : null);
      },
      onClick(e: ThreeEvent<MouseEvent>) {
        e.stopPropagation();
        if (e.delta > 5) return; // foi um arraste de câmera
        const s = useEditor.getState();
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
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.001, 0]}>
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

export default function Viewport3D() {
  const site = useEditor((s) => s.project?.site);
  const toolKind = useEditor((s) => s.tool.kind);
  if (!site) return null;
  return (
    <div className="relative size-full" data-testid="viewport-3d" style={{ cursor: toolKind === "select" ? "default" : "crosshair" }}>
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ position: [14, 12, 16], fov: 42, near: 0.05, far: 3000 }}
        gl={{ antialias: true }}
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
          shadow-mapSize={[2048, 2048]}
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
          <SceneElements />
        </InteractionLayer>

        <ToolPreview />
        <LabelProjector />
        <SelectionGizmo />
        <CameraRig />

        <OrbitControls makeDefault enableDamping dampingFactor={0.12} maxPolarAngle={Math.PI / 2 - 0.01} minDistance={0.5} maxDistance={1500} />
        <GizmoHelper alignment="bottom-right" margin={[64, 64]}>
          <GizmoViewport axisColors={["#ff4d5e", "#3d8bff", "#4cd964"]} labels={["X", "Z", "−Y"]} labelColor="#0e1014" />
        </GizmoHelper>
      </Canvas>
      <Labels3DOverlay />
    </div>
  );
}
