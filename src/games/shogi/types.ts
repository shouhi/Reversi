import type { DroppableType, Player, Position } from "./lib/engine";
import type { RematchState, RematchView } from "@/lib/rematch";

export type RoomStatus = "waiting" | "playing" | "finished";
/** Shogi has no draws (sennichite is not implemented), so the winner is a player or null. */
export type Winner = Player | null;

/** A completed move, in logical board coordinates. Either a board move or a drop. */
export interface LastMove {
  /** Present for a board move. */
  from?: { row: number; col: number };
  to: { row: number; col: number };
  /** Present for a drop (the dropped hand piece). */
  drop?: DroppableType;
  /** Board move only: whether the piece promoted. */
  promote?: boolean;
}

/**
 * The full room record persisted in the store. Includes the hashed player
 * tokens, which are secrets and MUST NOT be sent to clients. Shogi has no hidden
 * information — the full board AND both hands are public.
 */
export interface RoomState {
  roomId: string;
  /** The complete position (board, both hands, active color). */
  position: Position;
  /** Mirrors `position.activeColor`; the player to move. */
  currentTurn: Player;
  status: RoomStatus;
  winner: Winner;
  lastMove: LastMove | null;
  /** True when the side to move is currently in check (王手). */
  check: boolean;
  /** sha256 of Sente's (creator's) token. Always present. */
  senteTokenHash: string;
  /** sha256 of Gote's token, or null until a friend joins. */
  goteTokenHash: string | null;
  /** Same-room rematch consent + round id (see `@/lib/rematch`). */
  rematch: RematchState;
  version: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * The sanitised view returned to clients. Carries no token hashes.
 * `yourRole` is derived from the caller's own token on each request. The whole
 * position (board + both hands) is public — Shogi has no hidden state.
 */
export interface PublicRoomState {
  roomId: string;
  position: Position;
  currentTurn: Player;
  status: RoomStatus;
  winner: Winner;
  lastMove: LastMove | null;
  check: boolean;
  version: number;
  /** The current game-instance id; changes when a rematch starts a new round. */
  roundId: number;
  /** Same-room rematch consent, relative to the requesting player. */
  rematch: RematchView;
  /** Whether each seat is occupied. */
  seats: { sente: boolean; gote: boolean };
  /** The requesting client's role, or null if they are neither player. */
  yourRole: Player | null;
}
