import type { Vec3 } from "../types";
import {
  type Aabb,
  add,
  distanceXZ,
  dot,
  length,
  normalize,
  forwardFromAngles,
  segmentBlocked,
  sub,
} from "./geometry";
import {
  CATCH_DISTANCE,
  EYE_HEIGHT,
  FOV_HALF_ANGLE,
  HIDER_TARGET_HEIGHT,
  MAX_SEE_DISTANCE,
} from "./constants";

/**
 * COLOR HIDE — server-authoritative detection.
 *
 * This is the security heart of the game. The spec forbids ever handing a seeker
 * client the exact positions of hidden players, and forbids letting a client
 * self-declare a catch. So the SERVER (realtime + room service) uses these pure
 * functions to decide, from authoritative positions:
 *
 *   1. which hiders a seeker may even be told about (`visibleHiderIds`), and
 *   2. whether a claimed catch actually connects (`canCatch`).
 *
 * A hider is "visible" only when ALL hold: within range, inside the seeker's
 * view cone, and with an unobstructed line of sight (no obstacle AABB between
 * the seeker's eye and the hider). Pose/behaviour never lets a client see
 * through a wall — occlusion is computed from geometry, not trust.
 */

/** Seeker's authoritative pose: floor position + look angles (radians). */
export interface SeekerState {
  pos: Vec3;
  yaw: number;
  pitch: number;
}

/** A hider's authoritative floor position (+ id when batching). */
export interface HiderState {
  pos: Vec3;
}

export interface VisibilityParams {
  maxDistance: number;
  fovHalfAngle: number;
  eyeHeight: number;
  targetHeight: number;
}

export const DEFAULT_VISIBILITY_PARAMS: VisibilityParams = {
  maxDistance: MAX_SEE_DISTANCE,
  fovHalfAngle: FOV_HALF_ANGLE,
  eyeHeight: EYE_HEIGHT,
  targetHeight: HIDER_TARGET_HEIGHT,
};

export interface VisibilityResult {
  visible: boolean;
  /** 3D distance from seeker eye to hider target point. */
  distance: number;
  inRange: boolean;
  inFov: boolean;
  occluded: boolean;
}

/**
 * Full visibility evaluation of one hider from the seeker's viewpoint.
 * Pure: identical inputs always give identical results (used in unit tests to
 * prove occlusion blocks line of sight).
 */
export function evaluateVisibility(
  seeker: SeekerState,
  hider: HiderState,
  obstacles: Aabb[],
  params: VisibilityParams = DEFAULT_VISIBILITY_PARAMS,
): VisibilityResult {
  const eye = add(seeker.pos, { x: 0, y: params.eyeHeight, z: 0 });
  const target = add(hider.pos, { x: 0, y: params.targetHeight, z: 0 });

  const toTarget = sub(target, eye);
  const dist = length(toTarget);
  const inRange = dist <= params.maxDistance;

  // View-cone test: angle between the seeker's forward and the direction to the
  // hider must be within the FOV half-angle. Compared via cosine to avoid acos.
  const forward = forwardFromAngles(seeker.yaw, seeker.pitch);
  const cosToTarget = dist < 1e-9 ? 1 : dot(normalize(toTarget), forward);
  const inFov = cosToTarget >= Math.cos(params.fovHalfAngle);

  // Line-of-sight: any obstacle between eye and target blocks the view.
  const occluded = segmentBlocked(eye, target, obstacles);

  return {
    visible: inRange && inFov && !occluded,
    distance: dist,
    inRange,
    inFov,
    occluded,
  };
}

/**
 * Of many hiders, the ids the seeker is currently allowed to know about. The
 * realtime server streams positions ONLY for these ids to the seeker client, so
 * a hidden player's exact position never leaves the server. Already-caught
 * hiders are excluded by the caller before this point (or filter upstream).
 */
export function visibleHiderIds(
  seeker: SeekerState,
  hiders: Array<HiderState & { id: string }>,
  obstacles: Aabb[],
  params: VisibilityParams = DEFAULT_VISIBILITY_PARAMS,
): string[] {
  const ids: string[] = [];
  for (const hider of hiders) {
    if (evaluateVisibility(seeker, hider, obstacles, params).visible) {
      ids.push(hider.id);
    }
  }
  return ids;
}

/**
 * Whether the seeker's catch action on a hider should connect. Requires the
 * hider to be genuinely visible (range + FOV + line of sight) AND within the
 * short catch radius measured on the floor plane. The server calls this on a
 * catch attempt; a client "I caught them" claim alone is never trusted.
 */
export function canCatch(
  seeker: SeekerState,
  hider: HiderState,
  obstacles: Aabb[],
  params: VisibilityParams = DEFAULT_VISIBILITY_PARAMS,
  catchDistance: number = CATCH_DISTANCE,
): boolean {
  const { visible } = evaluateVisibility(seeker, hider, obstacles, params);
  if (!visible) return false;
  return distanceXZ(seeker.pos, hider.pos) <= catchDistance;
}
