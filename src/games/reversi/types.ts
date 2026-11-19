import type { Board, Player } from "./lib/engine";
import type { RematchState, RematchView } from "@/lib/rematch";

export type RoomStatus = "waiting" | "playing" | "finished";
export type Winner = Player | "draw" | null;

/**
 * The full room record persisted in the store. Includes the hashed player
 * tokens, which are secrets and MUST NOT be sent to clients.
 */
export interface RoomState {
  roomId: string;
  board: Board;
  currentTurn: Player;
  status: RoomStatus;
  winner: Winner;
  /** sha256 of the black player's token. Always present (set at creation). */
  blackTokenHash: string;
  /** sha256 of the white player's token, or null until a friend joins. */
  whiteTokenHash: string | null;
  lastMove: { row: number; col: number } | null;
  /** Same-room rematch consent + round id (see `@/lib/rematch`). */
  rematch: RematchState;
  version: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * The sanitised view returned to clients over the API. Carries no token hashes.
 * `yourRole` is derived from the caller's own token on each request.
 */
export interface PublicRoomState {
  roomId: string;
  board: Board;
  currentTurn: Player;
  status: RoomStatus;
  winner: Winner;
  lastMove: { row: number; col: number } | null;
  version: number;
  scores: { black: number; white: number };
  /** The current game-instance id; changes when a rematch starts a new round. */
  roundId: number;
  /** Same-room rematch consent, relative to the requesting player. */
  rematch: RematchView;
  /** Whether each seat is occupied. */
  seats: { black: boolean; white: boolean };
  /** The requesting client's role, or null if they are neither player. */
  yourRole: Player | null;
}
