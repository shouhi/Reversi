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

export interface RealtimeTransport {
  /** Whether the socket is currently open. */
  readonly connected: boolean;
  /** Register the single handler for inbound server messages. */
  onMessage(cb: (msg: ServerMsg) => void): void;
  /** Register a connection-state change handler. */
  onStatus(cb: (connected: boolean) => void): void;
  /** Send a movement/look/anim update (the server validates it). */
  sendInput(input: InputState): void;
  /** Seeker catch attempt (the server validates distance + line of sight). */
  sendCatch(targetId: string): void;
  /** Close the connection. */
  close(): void;
}
