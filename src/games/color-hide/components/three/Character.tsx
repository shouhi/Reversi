"use client";

import * as THREE from "three";
import { useMemo } from "react";
import type { ThreeEvent } from "@react-three/fiber";
import { getCharacterParts } from "./characterGeometry";

/**
 * The 3D character, rendered from the shared, UV-remapped primitives with a
 * per-instance material bound to `texture` (the player's paint). When
 * `interactive`, pointer events on the body report the hit UV so the paint studio
 * can draw exactly where the user touches.
 */
export interface CharacterProps {
  texture: THREE.Texture;
  interactive?: boolean;
  onPaintDown?: (uv: THREE.Vector2, pointerId: number) => void;
  onPaintMove?: (uv: THREE.Vector2, pointerId: number) => void;
  onPaintUp?: (pointerId: number) => void;
}

export default function Character({
  texture,
  interactive = false,
  onPaintDown,
  onPaintMove,
  onPaintUp,
}: CharacterProps) {
  const parts = useMemo(() => getCharacterParts(), []);
  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        map: texture,
        roughness: 0.72,
        metalness: 0.02,
      }),
    [texture],
  );

  const down = interactive
    ? (e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation();
        if (e.uv) onPaintDown?.(e.uv, e.pointerId);
      }
    : undefined;
  const move = interactive
    ? (e: ThreeEvent<PointerEvent>) => {
        if (e.uv) onPaintMove?.(e.uv, e.pointerId);
      }
    : undefined;
  const up = interactive
    ? (e: ThreeEvent<PointerEvent>) => onPaintUp?.(e.pointerId)
    : undefined;

  return (
    <group>
      {parts.map((p, i) => (
        <mesh
          key={i}
          geometry={p.geometry}
          material={material}
          position={p.position}
          rotation={p.rotation}
          castShadow
          receiveShadow
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
        />
      ))}
    </group>
  );
}
