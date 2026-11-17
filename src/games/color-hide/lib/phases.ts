import type { Phase, TimedPhase } from "../types";
import { PHASE_DURATION_MS } from "./constants";

/**
 * COLOR HIDE — pure phase state machine.
 *
 * The round advances through a fixed linear sequence of timed phases, driven by
 * the SERVER clock (`phaseStartedAt` + each phase's duration). This module is
 * pure and transport-agnostic: both the HTTP room service and the realtime
 * server call it, so every tier agrees on what phase a room is in at time `now`.
 *
 *   lobby → preparing → painting → hiding → seeking → result → lobby
 *
 * Entering `result` and `lobby` has side effects (freeze outcome / reset roster)
 * that the caller applies — this module only decides the *target* phase + its
 * start time. Early round-end (all hiders caught) is likewise the caller's
 * concern; here time is the only driver.
 */

/** The next phase after each timed phase. `lobby` is terminal w.r.t. time. */
export const LINEAR_NEXT: Record<TimedPhase, Phase> = {
  preparing: "painting",
  painting: "hiding",
  hiding: "seeking",
  seeking: "result",
  result: "lobby",
};

/** Duration of a phase in ms, or null for `lobby` (which is untimed). */
export function phaseDurationMs(phase: Phase): number | null {
  if (phase === "lobby") return null;
  return PHASE_DURATION_MS[phase];
}

/** Absolute end time (ms epoch) of a timed phase, or null for `lobby`. */
export function phaseEndsAt(phaseStartedAt: number, phase: Phase): number | null {
  const duration = phaseDurationMs(phase);
  return duration === null ? null : phaseStartedAt + duration;
}

/**
 * Remaining time in the current phase, clamped to ≥ 0, or null for `lobby`.
 * Used by the HUD countdown (aligned to the server clock, not the client's).
 */
export function remainingMs(
  phaseStartedAt: number,
  phase: Phase,
  now: number,
): number | null {
  const endsAt = phaseEndsAt(phaseStartedAt, phase);
  return endsAt === null ? null : Math.max(0, endsAt - now);
}

export interface PhasePosition {
  phase: Phase;
  phaseStartedAt: number;
}

/**
 * Rolls a room's phase forward to where the server clock says it should be.
 *
 * Normally one tick advances at most one phase, but if the server was idle (no
 * requests) across several phase boundaries, this walks forward through every
 * expired timed phase so the room never gets "stuck" in a past phase. `lobby`
 * is a fixed point: it only leaves via an explicit host action, never by time.
 *
 * Returns the (possibly unchanged) phase and the exact start time of the phase
 * it lands in, so subsequent countdowns stay aligned to real boundaries.
 */
export function advancePhase(current: PhasePosition, now: number): PhasePosition {
  let { phase, phaseStartedAt } = current;

  // Guard against an unbounded loop from absurd inputs; the real sequence is 5.
  for (let i = 0; i < 8; i++) {
    if (phase === "lobby") return { phase, phaseStartedAt };
    const endsAt = phaseEndsAt(phaseStartedAt, phase);
    if (endsAt === null || now < endsAt) {
      return { phase, phaseStartedAt };
    }
    // This phase has elapsed — step to the next one, starting exactly when the
    // previous phase ended (not `now`), so no drift accumulates across hops.
    phase = LINEAR_NEXT[phase as TimedPhase];
    phaseStartedAt = endsAt;
  }

  return { phase, phaseStartedAt };
}

/** True if `phase` is one where hiders may move around the map. */
export function hidersCanMove(phase: Phase): boolean {
  return phase === "hiding" || phase === "seeking";
}

/** True if the seeker is allowed to move / see the map and catch hiders. */
export function seekerCanSeek(phase: Phase): boolean {
  return phase === "seeking";
}
