"use client";

import * as THREE from "three";
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { getCharacterParts, type LimbId } from "./characterGeometry";
import {
  advancePhase,
  damp,
  gaitParams,
  limbPose,
  type GaitParams,
} from "../../lib/animation";
import type { AnimState } from "../../net/protocol";

/**
 * The in-game character with a lightweight procedural rig: head/torso are static,
 * arms + legs swing from their joints, and the upper body breathes (idle) / bobs
 * (stride) / leans (run). Driven entirely from a ref in `useFrame` — no per-frame
 * React state. The paint studio keeps the simpler static {@link Character}; this
 * is only for the live round (local + remote players).
 *
 * The animation is COSMETIC: it never changes position, collision, or any
 * server-authoritative value — those come from the caller's transforms.
 */

export interface CharacterAnimDriver {
  anim: AnimState;
}

export interface AnimatedCharacterProps {
  texture: THREE.Texture;
  /** Per-frame anim source (ref, to avoid re-renders). Null → idle. */
  animRef?: React.MutableRefObject<CharacterAnimDriver | null>;
  /** When true, the body slumps (server-confirmed catch). */
  caught?: boolean;
  /** Honour prefers-reduced-motion: hold a still rest pose. */
  reducedMotion?: boolean;
}

/** Height (body-local) the upper body leans/bobs around — roughly the waist. */
const HIP_Y = 0.92;

export default function AnimatedCharacter({
  texture,
  animRef,
  caught = false,
  reducedMotion = false,
}: AnimatedCharacterProps) {
  const parts = useMemo(() => getCharacterParts(), []);
  const material = useMemo(
    () => new THREE.MeshStandardMaterial({ map: texture, roughness: 0.72, metalness: 0.02 }),
    [texture],
  );

  const head = parts.find((p) => p.part === "head")!;
  const torso = parts.find((p) => p.part === "torso")!;
  const limbs = parts.filter((p) => p.limb);

  const rootRef = useRef<THREE.Group>(null); // caught slump
  const upperRef = useRef<THREE.Group>(null); // bob + lean
  const pivots = useRef<Partial<Record<LimbId, THREE.Group>>>({});

  // Current (damped) gait params + phase, kept in refs so transitions between
  // idle/walk/run/crouch blend smoothly instead of popping.
  const cur = useRef<GaitParams>(gaitParams("idle", reducedMotion));
  const phase = useRef(0);
  const caughtAmt = useRef(0);

  useFrame((_s, delta) => {
    const dt = Math.min(delta, 0.05);
    const anim = animRef?.current?.anim ?? "idle";
    const target = gaitParams(anim, reducedMotion);

    // Blend gait params toward the target so anim switches don't snap.
    const c = cur.current;
    c.swing = damp(c.swing, target.swing, 9, dt);
    c.armSwing = damp(c.armSwing, target.armSwing, 9, dt);
    c.lean = damp(c.lean, target.lean, 7, dt);
    c.bob = damp(c.bob, target.bob, 9, dt);
    c.rate = damp(c.rate, target.rate, 9, dt);

    phase.current = advancePhase(phase.current, c.rate, dt);
    const lp = limbPose(c, phase.current, 1);

    const p = pivots.current;
    if (p.legL) p.legL.rotation.x = lp.legL;
    if (p.legR) p.legR.rotation.x = lp.legR;
    if (p.armL) p.armL.rotation.x = lp.armL;
    if (p.armR) p.armR.rotation.x = lp.armR;
    if (upperRef.current) {
      upperRef.current.rotation.x = lp.lean;
      upperRef.current.position.y = HIP_Y + lp.bob;
    }

    // Caught: a brief, readable slump (tilt + sink). Server-confirmed only.
    caughtAmt.current = damp(caughtAmt.current, caught ? 1 : 0, 8, dt);
    const g = rootRef.current;
    if (g) {
      const k = reducedMotion ? caughtAmt.current * 0.4 : caughtAmt.current;
      g.rotation.z = 0.35 * k;
      g.position.y = -0.12 * k;
    }
  });

  return (
    <group ref={rootRef}>
      <group ref={upperRef} position={[0, HIP_Y, 0]}>
        <group position={[0, -HIP_Y, 0]}>
          <mesh geometry={head.geometry} material={material} position={head.position} castShadow receiveShadow />
          <mesh geometry={torso.geometry} material={material} position={torso.position} castShadow receiveShadow />
          {limbs
            .filter((l) => l.limb === "armL" || l.limb === "armR")
            .map((l) => (
              <group
                key={l.limb}
                ref={(el) => {
                  if (el) pivots.current[l.limb!] = el;
                }}
                position={l.joint}
              >
                <mesh
                  geometry={l.geometry}
                  material={material}
                  position={sub(l.position, l.joint!)}
                  rotation={l.rotation}
                  castShadow
                  receiveShadow
                />
              </group>
            ))}
        </group>
      </group>
      {limbs
        .filter((l) => l.limb === "legL" || l.limb === "legR")
        .map((l) => (
          <group
            key={l.limb}
            ref={(el) => {
              if (el) pivots.current[l.limb!] = el;
            }}
            position={l.joint}
          >
            <mesh
              geometry={l.geometry}
              material={material}
              position={sub(l.position, l.joint!)}
              rotation={l.rotation}
              castShadow
              receiveShadow
            />
          </group>
        ))}
    </group>
  );
}

function sub(
  a: [number, number, number],
  b: [number, number, number],
): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
