import type { MapId } from "./lib/constants";

/**
 * COLOR HIDE — shared types.
 *
 * Two tiers of state (see docs/COLOR_HIDE.md):
 *  - DURABLE, low-frequency state lives in the KV store as a {@link RoomState}:
 *    roster, host, phase + phase-start timestamp, map, confirmed paint, results.
 *    Token hashes are secrets and NEVER appear in {@link PublicRoomState}.
 *  - EPHEMERAL, high-frequency state (positions / orientation / animation) flows
 *    over the realtime channel only; it is never persisted here.
 */

export type { MapId } from "./lib/constants";

/** A point / vector in world space. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** The game's finite phase set. See `lib/phases.ts` for the transition rules. */
export type Phase =
  | "lobby"
  | "preparing"
  | "painting"
  | "hiding"
  | "seeking"
  | "result";

/** Phases that run on a server-clock countdown (have a fixed duration). */
export type TimedPhase = Exclude<Phase, "lobby">;

export type Role = "seeker" | "hider";

/** A selectable hiding pose. Each constrains movement + collision (see engine). */
export type Pose = "stand" | "crouch" | "lie" | "ball";

/**
 * A player's durable record inside a room. Position/orientation are intentionally
 * absent — those are realtime-only. `tokenHash` is a secret (never serialized to
 * clients); the raw token lives in the owner's localStorage.
 */
export interface PlayerRecord {
  /** Public, stable id used in realtime messages and the roster. */
  id: string;
  /** sha256 of the player's secret token. Server-only. */
  tokenHash: string;
  nickname: string;
  /** The room creator / controller. Exactly one host at a time. */
  isHost: boolean;
  /** "ready" in the lobby; cleared when a new round returns to lobby. */
  ready: boolean;
  /** Assigned when a round starts; null in the lobby. */
  role: Role | null;
  /** A hider who has been caught this round. Always false for the seeker. */
  caught: boolean;
  /** Last heartbeat (ms epoch). Drives the connected/disconnected view. */
  lastSeen: number;
  joinedAt: number;
}

/** Outcome of a finished round, shown on the result screen. */
export interface RoundResult {
  /** Which side met its win condition. */
  winner: Role;
  /** Player ids of hiders never caught (the survivors). */
  survivors: string[];
  /** Player ids of hiders the seeker caught. */
  caught: string[];
  /** The seeker's player id this round. */
  seekerId: string;
  endedAt: number;
}

/**
 * The full room record persisted in the KV store. Carries secrets
 * (`tokenHash`) and MUST be sanitized by `toPublicRoomState` before leaving the
 * server. `version` drives the store's optimistic compare-and-swap.
 */
export interface RoomState {
  roomId: string;
  phase: Phase;
  /**
   * Server-clock timestamp (ms epoch) at which the current phase began. Combined
   * with the phase's duration constant this gives every client the same
   * countdown without trusting client clocks.
   */
  phaseStartedAt: number;
  mapId: MapId;
  players: PlayerRecord[];
  /** The seeker's player id for the active round, or null in the lobby. */
  seekerId: string | null;
  /**
   * The previous round's seeker, remembered across the lobby reset so the next
   * round can avoid immediately re-picking the same player (fair role rotation).
   * Optional for backward-compat with records written before this field existed.
   */
  prevSeekerId?: string | null;
  /** Round number, incremented each time a round starts. */
  round: number;
  /** Last finished round's outcome (shown during `result`). */
  result: RoundResult | null;
  version: number;
  createdAt: number;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Public (client-safe) views
// ---------------------------------------------------------------------------

/** A roster entry safe to send to any client (no token hash). */
export interface PublicPlayer {
  id: string;
  nickname: string;
  isHost: boolean;
  ready: boolean;
  role: Role | null;
  caught: boolean;
  connected: boolean;
}

/**
 * The sanitized room view returned over the HTTP API. Carries no secrets.
 * `yourId` / `yourRole` are derived from the caller's own token per request.
 * `serverNow` lets the client align its countdown to the server clock.
 */
export interface PublicRoomState {
  roomId: string;
  phase: Phase;
  phaseStartedAt: number;
  /** Duration of the current phase in ms, or null for `lobby` (untimed). */
  phaseDurationMs: number | null;
  mapId: MapId;
  players: PublicPlayer[];
  seekerId: string | null;
  round: number;
  result: RoundResult | null;
  version: number;
  /** The caller's own player id, or null if they are not in this room. */
  yourId: string | null;
  /** The caller's role this round, or null. */
  yourRole: Role | null;
  /** Server clock (ms epoch) at response time, for countdown alignment. */
  serverNow: number;
}
