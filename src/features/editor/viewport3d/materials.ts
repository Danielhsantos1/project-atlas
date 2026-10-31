import * as THREE from "three";
import { getMaterial } from "@/core/model/materials";

export type Highlight = "none" | "hover" | "selected";

const cache = new Map<string, THREE.MeshStandardMaterial>();
const ACCENT = new THREE.Color("#2f80ff");

/**
 * Materiais Three.js compartilhados (um por material × destaque), evitando
 * recriar shaders a cada renderização.
 */
export function threeMaterial(materialId: string, highlight: Highlight = "none"): THREE.MeshStandardMaterial {
  const key = `${materialId}:${highlight}`;
  let m = cache.get(key);
  if (m) return m;
  const def = getMaterial(materialId);
  const transparent = def.opacity < 1;
  m = new THREE.MeshStandardMaterial({
    color: new THREE.Color(def.color),
    roughness: def.roughness,
    metalness: def.metalness,
    transparent,
    opacity: def.opacity,
    depthWrite: !transparent,
    side: transparent ? THREE.DoubleSide : THREE.FrontSide,
  });
  if (highlight !== "none") {
    m.emissive = ACCENT;
    m.emissiveIntensity = highlight === "selected" ? 0.55 : 0.2;
  }
  cache.set(key, m);
  return m;
}

export const EDGE_COLOR = "#0b0d10";
export const EDGE_SELECTED = "#7fb2ff";
