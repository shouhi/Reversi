import type { Vec3 } from "../types";

/**
 * COLOR HIDE — pure 3D geometry helpers.
 *
 * Small, dependency-free vector + AABB math shared by the detection logic
 * (line-of-sight) and movement collision. Kept separate from three.js so it can
 * run on the server (room service / realtime server) and in unit tests with no
 * WebGL. Axis convention: Y is up; the floor plane is XZ.
 */

/** An axis-aligned bounding box in world space (min/max corners). */
export interface Aabb {
  min: Vec3;
  max: Vec3;
}

export const vec = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

export const sub = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.x - b.x,
  y: a.y - b.y,
  z: a.z - b.z,
});

export const add = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.x + b.x,
  y: a.y + b.y,
  z: a.z + b.z,
});

export const scale = (a: Vec3, s: number): Vec3 => ({
  x: a.x * s,
  y: a.y * s,
  z: a.z * s,
});

export const dot = (a: Vec3, b: Vec3): number =>
  a.x * b.x + a.y * b.y + a.z * b.z;

export const length = (a: Vec3): number => Math.sqrt(dot(a, a));

/** Euclidean distance between two points. */
export const distance = (a: Vec3, b: Vec3): number => length(sub(a, b));

/** Horizontal (XZ-plane) distance — ignores height. */
export const distanceXZ = (a: Vec3, b: Vec3): number =>
  Math.hypot(a.x - b.x, a.z - b.z);

/** Returns `a` normalized to unit length, or the zero vector if degenerate. */
export function normalize(a: Vec3): Vec3 {
  const len = length(a);
  if (len < 1e-9) return { x: 0, y: 0, z: 0 };
  return scale(a, 1 / len);
}

/** A unit forward vector from a yaw (around Y) and pitch (around X), in radians. */
export function forwardFromAngles(yaw: number, pitch: number): Vec3 {
  const cp = Math.cos(pitch);
  // yaw 0 faces -Z (three.js default camera forward); +yaw turns toward +X.
  return {
    x: Math.sin(yaw) * cp,
    y: Math.sin(pitch),
    z: -Math.cos(yaw) * cp,
  };
}

/** True if the point is inside (or on) the box. */
export function pointInAabb(p: Vec3, box: Aabb): boolean {
  return (
    p.x >= box.min.x &&
    p.x <= box.max.x &&
    p.y >= box.min.y &&
    p.y <= box.max.y &&
    p.z >= box.min.z &&
    p.z <= box.max.z
  );
}

/**
 * Segment vs AABB intersection via the slab method. Returns true if the closed
 * segment p0→p1 touches the box. Used to decide whether an obstacle blocks the
 * seeker's line of sight to a hider.
 */
export function segmentIntersectsAabb(p0: Vec3, p1: Vec3, box: Aabb): boolean {
  const d = sub(p1, p0);
  let tMin = 0;
  let tMax = 1;

  for (const axis of ["x", "y", "z"] as const) {
    const start = p0[axis];
    const dir = d[axis];
    const lo = box.min[axis];
    const hi = box.max[axis];

    if (Math.abs(dir) < 1e-9) {
      // Parallel to this slab: miss if the start is outside the slab.
      if (start < lo || start > hi) return false;
      continue;
    }
    let t1 = (lo - start) / dir;
    let t2 = (hi - start) / dir;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return false;
  }
  return true;
}

/** True if the segment is blocked by ANY of the given obstacle boxes. */
export function segmentBlocked(p0: Vec3, p1: Vec3, boxes: Aabb[]): boolean {
  for (const box of boxes) {
    if (segmentIntersectsAabb(p0, p1, box)) return true;
  }
  return false;
}

/** Expands a box outward on all axes by `r` (e.g. the player capsule radius). */
export function expandAabb(box: Aabb, r: number): Aabb {
  return {
    min: { x: box.min.x - r, y: box.min.y - r, z: box.min.z - r },
    max: { x: box.max.x + r, y: box.max.y + r, z: box.max.z + r },
  };
}
