/**
 * COLOR HIDE — pure animation + interpolation math (DOM-free, unit-tested).
 *
 * Used by the 3D character rig (limb swing / idle breathing) and by the remote-
 * player interpolator (smooth, shortest-path position + yaw). Kept pure so the
 * behaviour is deterministic and testable without a WebGL context. NONE of this
 * touches gameplay: it only decides how already-known (server-authoritative)
 * positions and cosmetic anim states are DISPLAYED.
 */

import type { AnimState } from "../net/protocol";

const TAU = Math.PI * 2;

/** Wraps an angle to (-π, π]. */
export function wrapAngle(a: number): number {
  let x = (a + Math.PI) % TAU;
  if (x <= 0) x += TAU; // push 0 and negatives up so the range is (-π, π]
  return x - Math.PI;
}

/** Signed smallest rotation from `from` to `to`, in (-π, π]. */
export function shortestAngleDelta(from: number, to: number): number {
  return wrapAngle(to - from);
}

/**
 * Frame-rate-independent smoothing factor for exponential damping: the fraction
 * of the remaining gap to close this frame given a time-constant `rate` (per
 * second) and `dt` (seconds). `1 - e^(-rate·dt)` — at dt→0 it's ~rate·dt, and it
 * never overshoots (always in [0, 1]).
 */
export function dampFactor(rate: number, dt: number): number {
  if (dt <= 0 || rate <= 0) return 0;
  return 1 - Math.exp(-rate * dt);
}

/** Exponentially damps a scalar toward `target` (frame-rate independent). */
export function damp(current: number, target: number, rate: number, dt: number): number {
  return current + (target - current) * dampFactor(rate, dt);
}

/**
 * Damps an angle toward `target` along the SHORTEST path, so a character turning
 * past ±π spins the short way instead of unwinding all the way round.
 */
export function dampAngle(current: number, target: number, rate: number, dt: number): number {
  return wrapAngle(current + shortestAngleDelta(current, target) * dampFactor(rate, dt));
}

// ---------------------------------------------------------------------------
// Gait / pose animation
// ---------------------------------------------------------------------------

/** Per-anim gait parameters. Amplitudes in radians; `rate` is phase rad/s. */
export interface GaitParams {
  /** Leg/arm fore-aft swing amplitude (radians). */
  swing: number;
  /** Arm swing amplitude (radians). */
  armSwing: number;
  /** Forward lean of the upper body (radians). */
  lean: number;
  /** Vertical breathing/stride bob of the upper body (world units). */
  bob: number;
  /** Phase advance rate (radians/second) of the gait cycle. */
  rate: number;
}

const GAITS: Record<AnimState, GaitParams> = {
  // Subtle breathing only — no stride; the body gently rises/falls.
  idle: { swing: 0, armSwing: 0.04, lean: 0, bob: 0.02, rate: 1.7 },
  walk: { swing: 0.5, armSwing: 0.42, lean: 0.05, bob: 0.035, rate: 8 },
  run: { swing: 0.85, armSwing: 0.72, lean: 0.18, bob: 0.06, rate: 12.5 },
  // Crouch-move: short, low strides; lowering itself is the pose scale.
  crouch: { swing: 0.3, armSwing: 0.18, lean: 0.05, bob: 0.015, rate: 7 },
  // Non-locomotion states hold a neutral gait (reaction handled elsewhere).
  paint: { swing: 0, armSwing: 0.04, lean: 0, bob: 0.02, rate: 1.7 },
  found: { swing: 0, armSwing: 0, lean: 0, bob: 0, rate: 0 },
  win: { swing: 0, armSwing: 0.2, lean: 0, bob: 0.05, rate: 6 },
  lose: { swing: 0, armSwing: 0, lean: 0, bob: 0, rate: 0 },
};

/** Gait parameters for an anim state (reduced-motion zeroes all amplitudes). */
export function gaitParams(anim: AnimState, reducedMotion = false): GaitParams {
  const g = GAITS[anim] ?? GAITS.idle;
  if (reducedMotion) return { swing: 0, armSwing: 0, lean: 0, bob: 0, rate: g.rate };
  return g;
}

/** Advances a cyclic gait phase, wrapped to [0, 2π). */
export function advancePhase(phase: number, rate: number, dt: number): number {
  const p = (phase + rate * dt) % TAU;
  return p < 0 ? p + TAU : p;
}

/** Limb angles (radians) + body offsets for a gait phase. Arms swing opposite legs. */
export interface LimbPose {
  legL: number;
  legR: number;
  armL: number;
  armR: number;
  lean: number;
  bob: number;
}

/**
 * Computes limb swing + body offsets for a gait at `phase`, scaled by `intensity`
 * (0 = rest, 1 = full — used to blend in/out of motion). Left/right legs swing in
 * opposite phase; arms counter-swing the legs for a natural gait. Idle's zero
 * `swing` yields no stride, only a gentle breathing bob.
 */
export function limbPose(p: GaitParams, phase: number, intensity = 1): LimbPose {
  const s = Math.sin(phase);
  const k = Math.max(0, Math.min(1, intensity));
  const breathe = (Math.sin(phase) + 1) * 0.5; // 0..1 for idle bob
  return {
    legL: s * p.swing * k,
    legR: -s * p.swing * k,
    armL: -s * p.armSwing * k,
    armR: s * p.armSwing * k,
    lean: p.lean * k,
    // During a stride the body bobs twice per cycle (|sin|); at idle it breathes.
    bob: (p.swing > 0 ? Math.abs(s) : breathe) * p.bob * k,
  };
}

// ---------------------------------------------------------------------------
// Remote position interpolation
// ---------------------------------------------------------------------------

/**
 * If a snapshot target jumps further than this (world units) from the displayed
 * position, we SNAP instead of sliding — a correction/reconnect shouldn't show the
 * avatar skating across the map. Normal per-tick motion is well under this.
 */
export const TELEPORT_SNAP_DISTANCE = 6;

/** True when the gap is large enough that interpolating would look like skating. */
export function shouldSnap(
  from: { x: number; z: number },
  to: { x: number; z: number },
  threshold = TELEPORT_SNAP_DISTANCE,
): boolean {
  return Math.hypot(to.x - from.x, to.z - from.z) >= threshold;
}
