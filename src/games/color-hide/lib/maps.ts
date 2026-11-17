import type { MapId, Vec3 } from "../types";
import type { Aabb } from "./geometry";

/**
 * COLOR HIDE — map geometry (the functional layer).
 *
 * Each map is described as PURE DATA: a play-area bound, a set of obstacle AABBs
 * (used for BOTH collision and line-of-sight occlusion), and spawn points. The
 * server (detection + movement validation) and the client (R3F renders boxes
 * from these AABBs plus decorative meshes) share this single description, so what
 * blocks a bullet of sight is exactly what you see.
 *
 * Axis convention: Y up, floor at y=0, XZ is the ground plane. `accent`/`floor`
 * colors are hints the renderer may use; they do not affect gameplay.
 */

export interface GameMap {
  id: MapId;
  name: string;
  /** Short flavour description shown in the lobby map picker. */
  blurb: string;
  /** Play area. Players are clamped inside its XZ extent; Y is floor..ceiling. */
  bounds: Aabb;
  /** Collision + occlusion boxes (walls, furniture, crates, buildings). */
  obstacles: Aabb[];
  /** Floor spawn points for hiders (scattered around cover). */
  spawns: Vec3[];
  /** The seeker's starting floor position (kept apart from the hiders). */
  seekerSpawn: Vec3;
  /** Theme hints for the renderer. */
  theme: { floor: string; wall: string; accent: string };
}

/** Builds an AABB from a floor-centered footprint: center (cx,cz), size, height. */
function box(
  cx: number,
  cz: number,
  w: number,
  d: number,
  h: number,
  y0 = 0,
): Aabb {
  return {
    min: { x: cx - w / 2, y: y0, z: cz - d / 2 },
    max: { x: cx + w / 2, y: y0 + h, z: cz + d / 2 },
  };
}

/** The 4 perimeter walls for a rectangular room of half-extents hx,hz. */
function perimeter(hx: number, hz: number, h = 3, t = 0.5): Aabb[] {
  return [
    box(0, -hz, hx * 2 + t, t, h), // north (−Z)
    box(0, hz, hx * 2 + t, t, h), // south (+Z)
    box(-hx, 0, t, hz * 2 + t, h), // west (−X)
    box(hx, 0, t, hz * 2 + t, h), // east (+X)
  ];
}

const v = (x: number, z: number): Vec3 => ({ x, y: 0, z });

// ---------------------------------------------------------------------------
// MAP 1 — カラフルな部屋 (beginner): open living room with soft cover.
// ---------------------------------------------------------------------------
const room: GameMap = {
  id: "room",
  name: "カラフルな部屋",
  blurb: "初心者向け。ソファや棚の陰に隠れて、壁の色に溶け込もう。",
  bounds: { min: { x: -8, y: 0, z: -6 }, max: { x: 8, y: 3, z: 6 } },
  obstacles: [
    ...perimeter(8, 6),
    box(-5, -3, 3, 1.2, 0.8), // sofa (north-west)
    box(0, 0, 2.4, 1.2, 0.5), // coffee table (center, low — breaks low sightlines)
    box(5.5, -2, 1, 4, 2.2), // tall shelf (east wall)
    box(-6.5, 3, 1.4, 1.4, 1.6), // plant + pot (south-west)
    box(4, 3.5, 2.2, 1, 0.9), // bench (south)
    box(2, -4.5, 1.6, 0.6, 1.4), // cabinet (north)
  ],
  spawns: [
    v(-5, 3.5),
    v(6, 3),
    v(-6, -1),
    v(3, -2),
    v(0, 4),
    v(6.5, -4),
    v(-2, 1),
    v(1.5, 2.5),
  ],
  seekerSpawn: v(0, 5),
  theme: { floor: "#f6d9c7", wall: "#ffc6d9", accent: "#ff7eb6" },
};

// ---------------------------------------------------------------------------
// MAP 2 — 倉庫 (intermediate): crate aisles, containers, dark corners.
// ---------------------------------------------------------------------------
const warehouse: GameMap = {
  id: "warehouse",
  name: "倉庫",
  blurb: "中級者向け。木箱の通路とコンテナの陰。回り込みと死角がカギ。",
  bounds: { min: { x: -10, y: 0, z: -8 }, max: { x: 10, y: 4, z: 8 } },
  obstacles: [
    ...perimeter(10, 8, 4),
    // Two long crate rows forming aisles down the middle.
    box(-3, -3, 2, 6, 2.2),
    box(-3, 4, 2, 4, 2.2),
    box(3, -4, 2, 4, 2.2),
    box(3, 3, 2, 6, 2.2),
    // Shipping containers along the east wall.
    box(8, -4, 3, 2.4, 2.6),
    box(8, 1.5, 3, 2.4, 2.6),
    // Stacked boxes + drums scattered for cover.
    box(-7, 5, 1.6, 1.6, 1.8),
    box(-7.5, -5.5, 1.2, 1.2, 1.2),
    box(6.5, 6, 1, 1, 1.1), // drum
    box(0, 0, 1.4, 1.4, 1.5), // central stack
  ],
  spawns: [
    v(-8, 6.5),
    v(8.5, 6.5),
    v(-8.5, -6.5),
    v(0, -6.5),
    v(5, -6),
    v(-0.2, 6.8),
    v(6.8, -1.5),
    v(-5.5, 0.5),
  ],
  seekerSpawn: v(0, -7),
  theme: { floor: "#9aa3ad", wall: "#6b7280", accent: "#f59e0b" },
};

// ---------------------------------------------------------------------------
// MAP 3 — おもちゃの街 (advanced): toy houses, benches, a little park.
// ---------------------------------------------------------------------------
const toytown: GameMap = {
  id: "toytown",
  name: "おもちゃの街",
  blurb: "上級者向け。カラフルな家々と路地。影と角を使って逃げ切れ。",
  bounds: { min: { x: -12, y: 0, z: -10 }, max: { x: 12, y: 4, z: 10 } },
  obstacles: [
    ...perimeter(12, 10, 3.5),
    // A block of toy houses (tall occluders) with streets between them.
    box(-7, -6, 4, 4, 3),
    box(0, -6.5, 3.5, 3.5, 2.6),
    box(7, -6, 4, 4, 3),
    box(-8, 2, 3.5, 3.5, 2.8),
    box(8, 2.5, 4, 3.5, 3),
    // A central park with low benches + a fountain (low cover, open sightlines).
    box(0, 2, 2, 2, 0.6), // fountain base
    box(-3, 4, 2, 0.8, 0.9), // bench
    box(3, 4, 2, 0.8, 0.9), // bench
    // A couple of signboards / kiosks near spawns.
    box(0, 8, 1.4, 1, 2.2),
    box(-10, -1, 1, 1, 1.8),
  ],
  spawns: [
    v(-10, 8.5),
    v(10, 8.5),
    v(0, 9),
    v(-3.2, -2),
    v(3.4, -2),
    v(10.5, -8.5),
    v(-10.5, -8.5),
    v(5, 6),
  ],
  seekerSpawn: v(0, 0),
  theme: { floor: "#bfe8c9", wall: "#bcd4ff", accent: "#7c3aed" },
};

const MAPS: Record<MapId, GameMap> = { room, warehouse, toytown };

/** Returns the full geometry for a map id. */
export function getMap(id: MapId): GameMap {
  return MAPS[id];
}

/** All maps, for the lobby picker. */
export function allMaps(): GameMap[] {
  return [room, warehouse, toytown];
}
