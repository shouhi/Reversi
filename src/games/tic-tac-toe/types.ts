import type { Board, Player } from "./lib/engine";

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
  /** sha256 of the ○ (first / creator) player's token. Always present. */
  oTokenHash: string;
  /** sha256 of the × player's token, or null until a friend joins. */
  xTokenHash: string | null;
  lastMove: { row: number; col: number } | null;
  /** The winning line's cells once the game is won, else null. */
  winningLine: Array<[number, number]> | null;
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
  board: Board;
  currentTurn: Player;
  status: RoomStatus;
  winner: Winner;
  lastMove: { row: number; col: number } | null;
  winningLine: Array<[number, number]> | null;
  version: number;
  /** Whether each seat is occupied. */
  seats: { o: boolean; x: boolean };
  /** The requesting client's role, or null if they are neither player. */
  yourRole: Player | null;
}
