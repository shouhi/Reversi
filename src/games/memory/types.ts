import type { Card, Player } from "./lib/engine";

export type RoomStatus = "waiting" | "playing" | "finished";
export type Winner = Player | "draw" | null;

/**
 * The full room record persisted in the store. Includes the hashed player
 * tokens (secrets, MUST NOT be sent to clients) and the FULL deck — including
 * the symbols of face-down cards, which must never reach a client.
 */
export interface RoomState {
  roomId: string;
  /** The complete 16-card deck, with hidden symbols. Server-only. */
  cards: Card[];
  /** Indices currently face-up and not yet matched (length 0, 1, or 2). */
  revealed: number[];
  /** Pairs won by each player. */
  scores: { p1: number; p2: number };
  currentTurn: Player;
  status: RoomStatus;
  winner: Winner;
  /** sha256 of the p1 (creator / first) player's token. Always present. */
  p1TokenHash: string;
  /** sha256 of the p2 player's token, or null until a friend joins. */
  p2TokenHash: string | null;
  version: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * A card as seen by a client. `value` is revealed ONLY when the card is matched
 * or currently face-up; otherwise it is null so the hidden layout can never leak.
 */
export interface PublicCard {
  value: string | null;
  matchedBy: Player | null;
}

/**
 * The sanitised view returned to clients. Carries no token hashes and no
 * face-down card symbols. `yourRole` is derived from the caller's own token.
 */
export interface PublicRoomState {
  roomId: string;
  cards: PublicCard[];
  revealed: number[];
  scores: { p1: number; p2: number };
  currentTurn: Player;
  status: RoomStatus;
  winner: Winner;
  version: number;
  /** Whether each seat is occupied. */
  seats: { p1: boolean; p2: boolean };
  /** The requesting client's role, or null if they are neither player. */
  yourRole: Player | null;
}
