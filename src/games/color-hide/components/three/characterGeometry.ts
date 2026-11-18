import * as THREE from "three";
import {
  CHARACTER_ATLAS,
  remapUvBuffer,
  type CharacterPart,
} from "../../lib/uvAtlas";

/**
 * COLOR HIDE — character geometry (three.js, no React).
 *
 * A rounded, deformed-chibi body made of capsule/sphere primitives. Every part's
 * UVs are remapped into its atlas quadrant (see uvAtlas) so one shared paint
 * texture covers head/torso/arms/legs without cross-bleed. Geometries are built
 * once and cached — all characters (yours + opponents) reuse them, so adding a
 * player costs one material, not new meshes. Floor is y=0; the body is ~1.8 tall.
 */

/** A swingable limb, for the animated rig (arms/legs pivot from a joint). */
export type LimbId = "legL" | "legR" | "armL" | "armR";

export interface CharacterPartMesh {
  part: CharacterPart;
  geometry: THREE.BufferGeometry;
  position: [number, number, number];
  rotation?: [number, number, number];
  /**
   * For limbs only: the joint (shoulder/hip) the limb swings from, in body-local
   * space. The animated rig wraps the mesh in a pivot group at this point so a
   * walk/run swing rotates from the joint, not the mesh centre. Omitted for the
   * head/torso (they don't swing). `position - joint` gives the mesh's offset
   * inside the pivot, so at rest (zero swing) the character looks identical.
   */
  limb?: LimbId;
  joint?: [number, number, number];
}

function remapGeometry(
  geometry: THREE.BufferGeometry,
  part: CharacterPart,
): THREE.BufferGeometry {
  const uv = geometry.getAttribute("uv");
  if (uv) {
    remapUvBuffer(uv.array as Float32Array, CHARACTER_ATLAS[part]);
    uv.needsUpdate = true;
  }
  return geometry;
}

let cached: CharacterPartMesh[] | null = null;

/** Lazily builds (once) and returns the shared character part geometries. */
export function getCharacterParts(): CharacterPartMesh[] {
  if (cached) return cached;

  const head = remapGeometry(new THREE.SphereGeometry(0.42, 24, 18), "head");
  const torso = remapGeometry(new THREE.CapsuleGeometry(0.38, 0.5, 10, 20), "torso");
  const armL = remapGeometry(new THREE.CapsuleGeometry(0.11, 0.5, 6, 12), "arms");
  const armR = remapGeometry(new THREE.CapsuleGeometry(0.11, 0.5, 6, 12), "arms");
  const legL = remapGeometry(new THREE.CapsuleGeometry(0.15, 0.45, 6, 12), "legs");
  const legR = remapGeometry(new THREE.CapsuleGeometry(0.15, 0.45, 6, 12), "legs");

  cached = [
    { part: "legs", geometry: legL, position: [-0.18, 0.33, 0], limb: "legL", joint: [-0.18, 0.66, 0] },
    { part: "legs", geometry: legR, position: [0.18, 0.33, 0], limb: "legR", joint: [0.18, 0.66, 0] },
    { part: "torso", geometry: torso, position: [0, 1.0, 0] },
    { part: "arms", geometry: armL, position: [-0.5, 1.02, 0], rotation: [0, 0, 0.28], limb: "armL", joint: [-0.46, 1.34, 0] },
    { part: "arms", geometry: armR, position: [0.5, 1.02, 0], rotation: [0, 0, -0.28], limb: "armR", joint: [0.46, 1.34, 0] },
    { part: "head", geometry: head, position: [0, 1.62, 0] },
  ];
  return cached;
}

/** Total standing height, used for camera framing + eye height hints. */
export const CHARACTER_HEIGHT = 2.04;
