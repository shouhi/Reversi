import type { Color, Position } from "./lib/engine";

export type RoomStatus = "waiting" | "playing" | "finished";
export type Winner = Color | "draw" | null;

/** A completed move, in logical board coordinates. */
export interface LastMove {
  from: { row: number; col: number };
  to: { row: number; col: number };
}

/**
 * The full room record persisted in the store. Includes the hashed player
 * tokens, which are secrets and MUST NOT be sent to clients. Chess has no hidden
 * board information, so the full position is otherwise public.
 */
export interface RoomState {
  roomId: string;
  /** The complete FEN-like position (board, active color, castling, en passant). */
  position: Position;
  /** Mirrors `position.activeColor`; the color to move. */
  currentTurn: Color;
  status: RoomStatus;
  winner: Winner;
  lastMove: LastMove | null;
  /** True when the side to move is currently in check. */
  check: boolean;
  /** sha256 of White's (creator's) token. Always present. */
  whiteTokenHash: string;
  /** sha256 of Black's token, or null until a friend joins. */
  blackTokenHash: string | null;
  version: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * The sanitised view returned to clients. Carries no token hashes.
 * `yourRole` is derived from the caller's own token on each request.
 */
export interface PublicRoomState {
  roomId: string;
  position: Position;
  currentTurn: Color;
  status: RoomStatus;
  winner: Winner;
  lastMove: LastMove | null;
  check: boolean;
  version: number;
  /** Whether each seat is occupied. */
  seats: { white: boolean; black: boolean };
  /** The requesting client's role, or null if they are neither player. */
  yourRole: Color | null;
}
