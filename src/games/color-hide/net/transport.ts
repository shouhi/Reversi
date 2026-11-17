import type { AnimState, ServerMsg } from "./protocol";
import type { Pose } from "../types";

/**
 * COLOR HIDE — client realtime transport interface.
 *
 * The game client talks to the authoritative server only through this interface,
 * so the same UI works over the local WS host today and a PartyKit host later —
 * swapping transports never touches game code.
 */

export interface InputState {
  seq: number;
  t: number;
  x: number;
  z: number;
  yaw: number;
  pitch: number;
  anim: AnimState;
  pose: Pose;
  moving: boolean;
  running: boolean;
}

/**
 * Connection lifecycle, surfaced to the UI so it can clearly show "connecting /
 * reconnecting / failed" rather than silently pretending the game is live.
 */
export type ConnectionStatus =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "failed";

export interface RealtimeTransport {
  /** Whether the socket is currently open. */
  readonly connected: boolean;
  /** The current lifecycle status. */
  readonly status: ConnectionStatus;
  /** Register the single handler for inbound server messages. */
  onMessage(cb: (msg: ServerMsg) => void): void;
  /**
   * Register a status handler. The current status is delivered immediately on
   * subscribe, then on every change.
   */
  onStatus(cb: (status: ConnectionStatus) => void): void;
  /** Send a movement/look/anim update (the server validates it). */
  sendInput(input: InputState): void;
  /** Seeker catch attempt (the server validates distance + line of sight). */
  sendCatch(targetId: string): void;
  /** Manually retry after the automatic attempts gave up ("failed"). */
  reconnect(): void;
  /** Close the connection (no further auto-reconnect). */
  close(): void;
}
