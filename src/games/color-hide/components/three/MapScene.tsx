"use client";

import { useMemo } from "react";
import type { MapId } from "../../types";
import { getMap } from "../../lib/maps";

/**
 * Renders a map from its pure geometry: a floor sized to the bounds plus a box
 * per obstacle AABB. Because the rendered boxes ARE the collision/occlusion AABBs,
 * what blocks your view is exactly what you see — no invisible walls, no seeing
 * through solid cover. Theme colors come from the map definition.
 */
export default function MapScene({ mapId }: { mapId: MapId }) {
  const map = useMemo(() => getMap(mapId), [mapId]);

  const floorW = map.bounds.max.x - map.bounds.min.x;
  const floorD = map.bounds.max.z - map.bounds.min.z;
  const floorCx = (map.bounds.max.x + map.bounds.min.x) / 2;
  const floorCz = (map.bounds.max.z + map.bounds.min.z) / 2;

  return (
    <group>
      <hemisphereLight args={["#ffffff", map.theme.floor, 0.6]} />
      <ambientLight intensity={0.35} />
      <directionalLight
        position={[floorW * 0.4, 14, floorD * 0.3]}
        intensity={1.0}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />

      {/* Floor */}
      <mesh position={[floorCx, -0.01, floorCz]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[floorW, floorD]} />
        <meshStandardMaterial color={map.theme.floor} roughness={0.95} />
      </mesh>

      {/* Obstacles = collision + occlusion boxes */}
      {map.obstacles.map((o, i) => {
        const sx = o.max.x - o.min.x;
        const sy = o.max.y - o.min.y;
        const sz = o.max.z - o.min.z;
        const cx = (o.max.x + o.min.x) / 2;
        const cy = (o.max.y + o.min.y) / 2;
        const cz = (o.max.z + o.min.z) / 2;
        const isWall = sy >= 2.5;
        return (
          <mesh key={i} position={[cx, cy, cz]} castShadow receiveShadow>
            <boxGeometry args={[sx, sy, sz]} />
            <meshStandardMaterial
              color={isWall ? map.theme.wall : map.theme.accent}
              roughness={0.85}
            />
          </mesh>
        );
      })}
    </group>
  );
}
