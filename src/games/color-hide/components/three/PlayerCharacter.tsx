"use client";

import * as THREE from "three";
import { Html } from "@react-three/drei";
import Character from "./Character";
import type { Pose } from "../../types";

/**
 * A character placed in the world: the painted body plus an optional floating name
 * label (rendered as DOM via drei <Html>, so no font assets are fetched). Pose is
 * expressed as a light visual transform; gameplay collision/speed for poses is
 * handled server-side.
 */
export interface PlayerCharacterProps {
  position: [number, number, number];
  yaw: number;
  texture: THREE.Texture;
  pose?: Pose;
  name?: string;
  isSeeker?: boolean;
  caught?: boolean;
}

function poseTransform(pose: Pose): { scale: [number, number, number]; y: number; tilt: number } {
  switch (pose) {
    case "crouch":
      return { scale: [1, 0.68, 1], y: 0, tilt: 0 };
    case "ball":
      return { scale: [0.72, 0.6, 0.72], y: 0, tilt: 0 };
    case "lie":
      return { scale: [1, 1, 1], y: 0.3, tilt: -Math.PI / 2.2 };
    default:
      return { scale: [1, 1, 1], y: 0, tilt: 0 };
  }
}

export default function PlayerCharacter({
  position,
  yaw,
  texture,
  pose = "stand",
  name,
  isSeeker = false,
  caught = false,
}: PlayerCharacterProps) {
  const t = poseTransform(pose);
  return (
    <group position={position} rotation={[0, yaw, 0]}>
      <group position={[0, t.y, 0]} rotation={[t.tilt, 0, 0]} scale={t.scale}>
        <Character texture={texture} />
      </group>
      {name && (
        <Html position={[0, 2.35, 0]} center distanceFactor={10} prepend>
          <div
            style={{
              padding: "1px 6px",
              borderRadius: 6,
              fontSize: 12,
              whiteSpace: "nowrap",
              color: caught ? "#9aa0aa" : "#fff",
              background: isSeeker ? "rgba(245,158,11,0.85)" : "rgba(0,0,0,0.5)",
              textDecoration: caught ? "line-through" : "none",
              transform: "translateY(-6px)",
            }}
          >
            {isSeeker ? "👀 " : ""}
            {name}
          </div>
        </Html>
      )}
    </group>
  );
}
