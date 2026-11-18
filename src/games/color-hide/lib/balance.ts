/**
 * COLOR HIDE — gameplay-balance helpers (pure, DOM-free, unit-tested).
 *
 * Two concerns live here:
 *   1. `seekerSpeed()` — the single place that applies the seeker's speed edge,
 *      imported by BOTH the client prediction and the server move validator so
 *      they can never disagree (a mismatch would rubber-band the seeker).
 *   2. `simulatePursuit()` — a deterministic head-on pursuit model used to reason
 *      about catchability. It makes the balance argument objective: at equal
 *      speed the gap never closes (uncatchable), and the time-to-catch shrinks as
 *      the seeker's edge grows. These are MODEL estimates, not measured human
 *      win-rates.
 */

import { RUN_SPEED, SEEKER_SPEED_MULT, WALK_SPEED, CROUCH_SPEED_MULT, CATCH_DISTANCE } from "./constants";
import type { Role } from "../types";

/**
 * Applies the seeker's speed multiplier to a base move speed. Hiders (and anyone
 * with no role) move at the base speed. Used identically on client + server.
 */
export function seekerSpeed(base: number, role: Role | null): number {
  return role === "seeker" ? base * SEEKER_SPEED_MULT : base;
}

/** The move speed for a player given role/run/crouch state (client + server share this). */
export function moveSpeedFor(
  role: Role | null,
  opts: { running: boolean; crouched: boolean },
): number {
  const base = opts.crouched ? WALK_SPEED * CROUCH_SPEED_MULT : opts.running ? RUN_SPEED : WALK_SPEED;
  return seekerSpeed(base, role);
}

export interface PursuitParams {
  seekerSpeed: number;
  hiderSpeed: number;
  /** Initial gap (world units) between seeker and a directly-fleeing hider. */
  startGap: number;
  /** Catch radius (world units). */
  catchDistance?: number;
  /** Simulation step (seconds). */
  dt?: number;
  /** Give up after this many seconds. */
  maxTime?: number;
}

export interface PursuitResult {
  caught: boolean;
  /** Seconds until the gap closed to the catch radius, or null if never. */
  timeToCatch: number | null;
  /** Final gap at the end of the simulation. */
  finalGap: number;
}

/**
 * Deterministic worst-case pursuit: a hider flees in a straight line directly
 * away from the seeker (the best a hider can do in the open), both at constant
 * speed. The seeker catches iff it can close the gap to the catch radius within
 * `maxTime`. If `seekerSpeed <= hiderSpeed` the gap never shrinks → uncatchable.
 */
export function simulatePursuit(p: PursuitParams): PursuitResult {
  const dt = p.dt ?? 0.1;
  const maxTime = p.maxTime ?? 180;
  const catchDistance = p.catchDistance ?? CATCH_DISTANCE;
  let gap = p.startGap;
  let t = 0;
  const closeRate = p.seekerSpeed - p.hiderSpeed; // units/sec the gap shrinks
  while (t < maxTime) {
    if (gap <= catchDistance) return { caught: true, timeToCatch: t, finalGap: gap };
    gap -= closeRate * dt;
    t += dt;
  }
  return { caught: gap <= catchDistance, timeToCatch: null, finalGap: gap };
}
