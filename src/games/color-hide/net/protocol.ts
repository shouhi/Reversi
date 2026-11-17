import type { Pose, Role } from "../types";

/**
 * COLOR HIDE — realtime wire protocol.
 *
 * Shared by the client transport and the authoritative server (local WS host
 * today, PartyKit later). Kept tiny and flat so messages serialize cheaply at
 * ~15 Hz. Positions are sent as (x, z) on the floor plane; the client derives Y
 * from pose. The server NEVER forwards a hidden hider's position to the seeker —
 * snapshots are filtered per recipient (see `realtime.ts`).
 */

/** Cosmetic animation state, chosen by the owning client and relayed as-is. */
export type AnimState =
  | "idle"
  | "walk"
  | "run"
  | "crouch"
  | "paint"
  | "found"
  | "win"
  | "lose";

/** A player as seen in a snapshot (already visibility-filtered for the recipient). */
export interface NetPlayer {
  id: string;
  x: number;
  z: number;
  yaw: number;
  pitch: number;
  anim: AnimState;
  pose: Pose;
  role: Role | null;
}

// --- client → server -------------------------------------------------------

/**
 * Identify + attach to a room. The host verifies `token` against the room (via
 * the app's HTTP API) before handing the connection to the netcode, which only
 * ever sees the authenticated `playerId`.
 */
export interface HelloMsg {
  type: "hello";
  roomId: string;
  playerId: string;
  /** Raw player token, used by the host for authentication only. */
  token?: string;
}

/** A movement/look/anim update. `seq` lets the client reconcile corrections. */
export interface InputMsg {
  type: "input";
  seq: number;
  /** Client send time (ms epoch); the server uses its own clock for validation. */
  t: number;
  x: number;
  z: number;
  yaw: number;
  pitch: number;
  anim: AnimState;
  pose: Pose;
  moving: boolean;
  /** Whether the client was holding "run" (bounds the allowed step server-side). */
  running: boolean;
}

/** Seeker attempts to catch a hider. The server validates distance + line-of-sight. */
export interface CatchMsg {
  type: "catch";
  targetId: string;
}

export interface PingMsg {
  type: "ping";
  t: number;
}

export type ClientMsg = HelloMsg | InputMsg | CatchMsg | PingMsg;

// --- server → client -------------------------------------------------------

export interface WelcomeMsg {
  type: "welcome";
  playerId: string;
  role: Role | null;
  tickHz: number;
}

/** A per-recipient filtered world snapshot. */
export interface SnapshotMsg {
  type: "snapshot";
  t: number;
  players: NetPlayer[];
}

/** Broadcast when the seeker successfully catches a hider. */
export interface CaughtMsg {
  type: "caught";
  hiderId: string;
  byId: string;
}

export interface PongMsg {
  type: "pong";
  t: number;
}

export interface ErrorMsg {
  type: "error";
  message: string;
}

export type ServerMsg =
  | WelcomeMsg
  | SnapshotMsg
  | CaughtMsg
  | PongMsg
  | ErrorMsg;

/** Narrow unknown JSON into a ClientMsg, or null if it is not a valid message. */
export function parseClientMsg(data: unknown): ClientMsg | null {
  if (typeof data !== "object" || data === null) return null;
  const m = data as Record<string, unknown>;
  switch (m.type) {
    case "hello":
      return typeof m.roomId === "string" && typeof m.playerId === "string"
        ? (m as unknown as HelloMsg)
        : null;
    case "input":
      return typeof m.x === "number" &&
        typeof m.z === "number" &&
        typeof m.yaw === "number" &&
        typeof m.pitch === "number"
        ? (m as unknown as InputMsg)
        : null;
    case "catch":
      return typeof m.targetId === "string" ? (m as unknown as CatchMsg) : null;
    case "ping":
      return { type: "ping", t: typeof m.t === "number" ? m.t : 0 };
    default:
      return null;
  }
}
