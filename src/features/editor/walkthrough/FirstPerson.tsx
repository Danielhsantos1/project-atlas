"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { buildCollisionWorld } from "@/walkthrough/colliders";
import { DEFAULT_PLAYER_PARAMS, eyePosition, lookDirection, stepPlayer, type PlayerParams, type PlayerState } from "@/walkthrough/controller";
import { entranceSpawn, levelSpawn } from "@/walkthrough/spawn";
import { findInteractable } from "@/walkthrough/interaction";
import { roomShape } from "@/core/geometry/rooms";
import { levelWalls } from "@/core/model/operations";
import { useEditor } from "../store";
import { useWalk } from "./store";

const LOOK_SENSITIVITY = 0.0022;
const DOOR_SPEED = 2.2; // aberturas por segundo
const MOVE_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "ShiftLeft", "ShiftRight", "Space"]);

/**
 * Controlador em primeira pessoa. A colisão vem de `buildCollisionWorld`,
 * derivado do MESMO projeto do editor (não há cópia da construção).
 */
export function FirstPersonController() {
  const project = useEditor((s) => s.project)!;
  const { camera, gl } = useThree() as unknown as { camera: THREE.PerspectiveCamera; gl: THREE.WebGLRenderer };
  const doorOpen = useWalk((s) => s.doorOpen);
  const eyeHeight = useWalk((s) => s.eyeHeight);
  const spawnNonce = useWalk((s) => s.spawnNonce);
  const params: PlayerParams = useMemo(() => ({ ...DEFAULT_PLAYER_PARAMS, eyeHeight }), [eyeHeight]);
  const world = useMemo(() => buildCollisionWorld(project, doorOpen), [project, doorOpen]);

  const state = useRef<PlayerState | null>(null);
  const keys = useRef(new Set<string>());
  const look = useRef({ dx: 0, dy: 0 });
  const jump = useRef(false);
  const tick = useRef(0);
  const anim = useRef<Record<string, number>>({});

  // Posição inicial: entrada principal (ou pavimento escolhido).
  useEffect(() => {
    const levelId = useWalk.getState().spawnLevelId;
    const w = buildCollisionWorld(project, useWalk.getState().doorOpen);
    state.current = (levelId ? levelSpawn(project, levelId, params, w) : null) ?? entranceSpawn(project, params, w);
    useWalk.getState().setPlayer(state.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spawnNonce]);

  // Câmera mais aberta para a visita; restaura ao sair.
  useEffect(() => {
    const prev = camera.fov;
    camera.fov = 70;
    camera.updateProjectionMatrix();
    return () => {
      camera.fov = prev;
      camera.updateProjectionMatrix();
    };
  }, [camera]);

  // Teclado, mouse e Pointer Lock (respeitando o gesto do usuário exigido pelo navegador).
  useEffect(() => {
    const canvas = gl.domElement;
    let dragging = false;
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if (MOVE_KEYS.has(e.code)) {
        keys.current.add(e.code);
        if (e.code === "Space") jump.current = true;
        e.preventDefault();
      } else if (e.code === "KeyE") {
        const it = useWalk.getState().interactable;
        if (it?.kind === "door") useWalk.getState().toggleDoor(it.elementId);
      } else if (e.code === "KeyL") {
        useWalk.getState().toggleLights();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => keys.current.delete(e.code);
    const onBlur = () => keys.current.clear();
    const onMouseMove = (e: MouseEvent) => {
      if (document.pointerLockElement === canvas || dragging) {
        look.current.dx += e.movementX;
        look.current.dy += e.movementY;
      }
    };
    const onClick = () => {
      if (document.pointerLockElement !== canvas) {
        const req = canvas.requestPointerLock?.();
        if (req && typeof (req as Promise<void>).catch === "function") (req as Promise<void>).catch(() => undefined); // navegador pode negar; arrastar continua funcionando
      }
    };
    // Alternativa sem Pointer Lock: arrastar para olhar.
    const onDown = () => (dragging = true);
    const onUp = () => (dragging = false);
    const onLockChange = () => useWalk.getState().setLocked(document.pointerLockElement === canvas);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("dblclick", onClick);
    canvas.addEventListener("click", onClick);
    document.addEventListener("pointerlockchange", onLockChange);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("dblclick", onClick);
      canvas.removeEventListener("click", onClick);
      document.removeEventListener("pointerlockchange", onLockChange);
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      useWalk.getState().setLocked(false);
    };
  }, [gl]);

  useFrame((_, dt) => {
    let s = state.current;
    if (!s) return;
    const k = keys.current;
    const touch = useWalk.getState().touch;
    const yaw = s.yaw - look.current.dx * LOOK_SENSITIVITY;
    const pitch = Math.max(-1.45, Math.min(1.45, s.pitch - look.current.dy * LOOK_SENSITIVITY));
    look.current = { dx: 0, dy: 0 };
    const axis = (pos: boolean, neg: boolean) => (pos ? 1 : 0) - (neg ? 1 : 0);
    const forward = Math.max(-1, Math.min(1, axis(k.has("KeyW") || k.has("ArrowUp"), k.has("KeyS") || k.has("ArrowDown")) + touch.forward));
    const right = Math.max(-1, Math.min(1, axis(k.has("KeyD") || k.has("ArrowRight"), k.has("KeyA") || k.has("ArrowLeft")) + touch.right));
    // Quadros lentos (máquinas modestas) são subdivididos em passos físicos de até 50 ms,
    // mantendo a velocidade real; o teto de 0,25 s evita "saltos" após travamentos.
    const input = { forward, right, run: k.has("ShiftLeft") || k.has("ShiftRight"), jump: jump.current };
    s = { ...s, yaw, pitch };
    for (let remaining = Math.min(dt, 0.25); remaining > 1e-6; remaining -= 0.05) {
      s = stepPlayer(world, s, input, Math.min(0.05, remaining), params);
      input.jump = false;
    }
    jump.current = false;
    state.current = s;

    const eye = eyePosition(s, params);
    const dir = lookDirection(s.yaw, s.pitch);
    camera.position.set(eye.x, eye.z, -eye.y);
    camera.lookAt(eye.x + dir.x, eye.z + dir.z, -(eye.y + dir.y));

    // Animação das portas (visual), alvo = estado aberto/fechado da física.
    const open = useWalk.getState().doorOpen;
    let changed = false;
    const next: Record<string, number> = { ...anim.current };
    for (const id of new Set([...open, ...Object.keys(next)])) {
      const target = open.has(id) ? 1 : 0;
      const cur = next[id] ?? 0;
      if (cur !== target) {
        next[id] = target > cur ? Math.min(1, cur + dt * DOOR_SPEED) : Math.max(0, cur - dt * DOOR_SPEED);
        changed = true;
      }
    }
    if (changed) {
      anim.current = next;
      useWalk.getState().setDoorAmounts(next);
    }

    tick.current += dt;
    if (tick.current > 0.1) {
      tick.current = 0;
      useWalk.getState().setPlayer(s);
      useWalk.getState().setInteractable(findInteractable(project, s, 1.6, open));
    }
  });

  return <RoomLights />;
}

/** Iluminação interna: uma luz pontual por ambiente com forro (limitada por desempenho). */
function RoomLights() {
  const project = useEditor((s) => s.project)!;
  const on = useWalk((s) => s.lightsOn);
  const lights = useMemo(() => {
    const out: Array<{ key: string; pos: [number, number, number] }> = [];
    for (const r of project.elements) {
      if (r.type !== "room" || !r.ceiling) continue;
      const level = project.levels.find((l) => l.id === r.levelId);
      const shape = roomShape(levelWalls(project, r.levelId), r.seed);
      if (!shape || !level) continue;
      const xs = shape.inner.map((p) => p.x);
      const ys = shape.inner.map((p) => p.y);
      out.push({ key: r.id, pos: [(Math.min(...xs) + Math.max(...xs)) / 2, level.elevation + r.ceilingHeight - 0.15, -(Math.min(...ys) + Math.max(...ys)) / 2] });
    }
    return out.slice(0, 16);
  }, [project]);
  if (!on) return null;
  return (
    <>
      {lights.map((l) => (
        <pointLight key={l.key} position={l.pos} intensity={5} distance={9} decay={2} color="#ffe8c7" />
      ))}
    </>
  );
}
