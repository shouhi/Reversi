import type { Vec3 } from "../types";
import { type Aabb, distanceXZ, expandAabb } from "./geometry";
import { MOVE_TOLERANCE, PLAYER_RADIUS, RUN_SPEED } from "./constants";

/**
 * COLOR HIDE — movement + collision (pure, shared by client & server).
 *
 * Players are points with a capsule radius sliding on the XZ floor plane. The
 * client runs this for responsive local prediction; the SERVER runs the exact
 * same code to validate every claimed position — clamping teleports and pushing
 * players out of walls — so a hacked client cannot walk through geometry or jump
 * across the map. Y is ignored (players stay on the floor; obstacles touch it).
 */

/** True if the XZ point lies within an obstacle expanded by the player radius. */
function blockedAt(
  x: number,
  z: number,
  obstacles: Aabb[],
  radius: number,
): boolean {
  for (const o of obstacles) {
    const e = expandAabb(o, radius);
    if (x >= e.min.x && x <= e.max.x && z >= e.min.z && z <= e.max.z) {
      return true;
    }
  }
  return false;
}

/** Clamps an XZ position to stay `radius` inside the play-area bounds. */
export function clampToBoundsXZ(
  p: Vec3,
  bounds: Aabb,
  radius: number = PLAYER_RADIUS,
): Vec3 {
  return {
    x: Math.min(Math.max(p.x, bounds.min.x + radius), bounds.max.x - radius),
    y: p.y,
    z: Math.min(Math.max(p.z, bounds.min.z + radius), bounds.max.z - radius),
  };
}

/**
 * Resolves a desired move from a valid position, sliding along walls. Tries the
 * X and Z axes independently so grazing a wall slides you along it instead of
 * stopping you dead. Assumes `from` is already collision-free.
 */
export function resolveMove(
  from: Vec3,
  desired: Vec3,
  obstacles: Aabb[],
  bounds: Aabb,
  radius: number = PLAYER_RADIUS,
): Vec3 {
  const clamped = clampToBoundsXZ(desired, bounds, radius);

  let x = from.x;
  let z = from.z;

  // Move along X, keeping Z fixed; accept only if the new cell is free.
  if (!blockedAt(clamped.x, z, obstacles, radius)) {
    x = clamped.x;
  }
  // Then move along Z from the (possibly updated) X.
  if (!blockedAt(x, clamped.z, obstacles, radius)) {
    z = clamped.z;
  }

  return { x, y: from.y, z };
}

export interface MoveLimit {
  /** Max base speed the mover may legitimately travel at (world-units/sec). */
  maxSpeed: number;
  radius: number;
}

export const DEFAULT_MOVE_LIMIT: MoveLimit = {
  maxSpeed: RUN_SPEED,
  radius: PLAYER_RADIUS,
};

/**
 * SERVER-side validation of a client-claimed position. Rejects teleports by
 * clamping the claim to how far the player could travel in `dtMs` (with slack),
 * then resolves collisions so the result is always a legal, wall-free position.
 * Returns the authoritative position to store/broadcast.
 */
export function validateMove(
  from: Vec3,
  claimed: Vec3,
  dtMs: number,
  obstacles: Aabb[],
  bounds: Aabb,
  limit: MoveLimit = DEFAULT_MOVE_LIMIT,
): Vec3 {
  const maxStep =
    Math.max(0, dtMs / 1000) * limit.maxSpeed * MOVE_TOLERANCE + 1e-6;

  let target = claimed;
  const dist = distanceXZ(from, claimed);
  if (dist > maxStep && dist > 1e-9) {
    // Pull the claim back onto the reachable circle around `from`.
    const t = maxStep / dist;
    target = {
      x: from.x + (claimed.x - from.x) * t,
      y: claimed.y,
      z: from.z + (claimed.z - from.z) * t,
    };
  }
  return resolveMove(from, target, obstacles, bounds, limit.radius);
}
