import type { Pose } from "../types";
import {
  INPUT_EVENT_MIN_INTERVAL_MS,
  INPUT_HEARTBEAT_MS,
  INPUT_MOVE_SEND_INTERVAL_MS,
  INPUT_POS_EPSILON,
  INPUT_YAW_EPSILON,
} from "./constants";

/**
 * COLOR HIDE — client input-send planner (Phase 9-E netcode optimization).
 *
 * A pure decision: given the last SENT input and the current input, should the
 * client send now? This replaces the old fixed 18 Hz send with a hybrid schedule
 * that slashes INBOUND WebSocket messages (the billed direction on Cloudflare —
 * 20 received = 1 request) without hurting responsiveness:
 *
 *   • "event"     — a meaningful change (move start/stop, run, crouch/pose). Sent
 *                   as soon as a small floor has elapsed so STOP is near-instant
 *                   and rapid toggling can't flood.
 *   • "move"      — steady movement/looking: the position or yaw drifted past a
 *                   dead-zone and the moving-rate interval elapsed (~10 Hz).
 *   • "heartbeat" — nothing changed, but the keepalive interval elapsed (~1 Hz):
 *                   proves liveness and resynchronises after a lost packet.
 *
 * Kept pure (no sockets, no React) so it unit-tests exactly and so the exact same
 * logic can be replayed in the netcode benchmark. Local prediction is unchanged
 * and runs every frame; this only governs what reaches the server.
 */

/** The decision-relevant slice of a frame's input (what we compare + send). */
export interface InputSample {
  x: number;
  z: number;
  yaw: number;
  moving: boolean;
  running: boolean;
  pose: Pose;
}

export interface SendPlanConfig {
  /** Steady interval while continuously moving/looking (ms). */
  moveIntervalMs: number;
  /** Floor between event-driven (change) sends (ms). */
  eventMinIntervalMs: number;
  /** Idle keepalive interval (ms). */
  heartbeatMs: number;
  /** Position delta below which movement is jitter (world units). */
  posEpsilon: number;
  /** Yaw delta below which a look change is jitter (radians). */
  yawEpsilon: number;
}

export const DEFAULT_SEND_CONFIG: SendPlanConfig = {
  moveIntervalMs: INPUT_MOVE_SEND_INTERVAL_MS,
  eventMinIntervalMs: INPUT_EVENT_MIN_INTERVAL_MS,
  heartbeatMs: INPUT_HEARTBEAT_MS,
  posEpsilon: INPUT_POS_EPSILON,
  yawEpsilon: INPUT_YAW_EPSILON,
};

/** Why an input was (or was not) sent — useful for tests + benchmarking. */
export type SendReason = "initial" | "event" | "move" | "heartbeat" | "none";

/** Smallest absolute angle between two yaws, in [0, π]. */
export function angleDelta(a: number, b: number): number {
  const TWO_PI = Math.PI * 2;
  let d = Math.abs(a - b) % TWO_PI;
  if (d > Math.PI) d = TWO_PI - d;
  return d;
}

/**
 * Decide whether to send `cur` now, given the last SENT sample `prev` (null before
 * the first send) and how long since that send. Priority: a meaningful change
 * (esp. STOP) wins over steady movement, which wins over the idle heartbeat.
 */
export function planInputSend(
  prev: InputSample | null,
  cur: InputSample,
  dtSinceLastSendMs: number,
  cfg: SendPlanConfig = DEFAULT_SEND_CONFIG,
): SendReason {
  if (!prev) return "initial";

  // Highest priority: a discrete state change the server must judge promptly
  // (movement start/stop, run toggle, crouch/pose change). Floored so a burst of
  // toggles cannot exceed ~20 Hz, but a single STOP flushes within the floor.
  const changed =
    cur.moving !== prev.moving ||
    cur.running !== prev.running ||
    cur.pose !== prev.pose;
  if (changed && dtSinceLastSendMs >= cfg.eventMinIntervalMs) return "event";

  // Steady movement / looking: only once drift exceeds the dead-zone AND the
  // moving-rate interval elapsed. Analog jitter below the epsilons sends nothing.
  const movedEnough =
    Math.hypot(cur.x - prev.x, cur.z - prev.z) > cfg.posEpsilon ||
    angleDelta(cur.yaw, prev.yaw) > cfg.yawEpsilon;
  if (movedEnough && dtSinceLastSendMs >= cfg.moveIntervalMs) return "move";

  // Idle keepalive / resync.
  if (dtSinceLastSendMs >= cfg.heartbeatMs) return "heartbeat";

  return "none";
}

/**
 * The OLD behaviour, for apples-to-apples benchmarking only: a fixed-rate send
 * regardless of what the player did (the pre-9-E client sent ~18 Hz this way).
 */
export function legacyPlanInputSend(
  dtSinceLastSendMs: number,
  intervalMs = 1000 / 18,
): SendReason {
  return dtSinceLastSendMs >= intervalMs ? "move" : "none";
}
