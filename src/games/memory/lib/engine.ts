/**
 * Pure 神経衰弱 (Memory / Concentration) game logic.
 *
 * Mirrors the Tic-Tac-Toe engine: this module is free of any UI / network /
 * storage concerns so it can run identically on client and server and be unit
 * tested in isolation. The server is the source of truth and re-runs these
 * helpers to validate every move.
 *
 * Players: "p1" (room creator, goes first) and "p2" (the joiner).
 */

export type Player = "p1" | "p2";

/** A single card in the deck. `value` is the symbol; `matchedBy` is its owner once won. */
export interface Card {
  value: string;
  matchedBy: Player | null;
}

/** The eight distinct symbols; each appears exactly twice to form 8 pairs. */
export const SYMBOLS = ["★", "●", "■", "▲", "◆", "♥", "♠", "♣"] as const;

/** 4×4 board. */
export const GRID_SIZE = 4;
/** Total cards on the board (16 = 8 pairs). */
export const CARD_COUNT = GRID_SIZE * GRID_SIZE;
/** Number of pairs to find. */
export const PAIR_COUNT = CARD_COUNT / 2;

/** Returns the other player. */
export function opponent(player: Player): Player {
  return player === "p1" ? "p2" : "p1";
}

/** Grid row (0-3) for a card index (0-15). */
export function rowOf(index: number): number {
  return Math.floor(index / GRID_SIZE);
}

/** Grid column (0-3) for a card index (0-15). */
export function colOf(index: number): number {
  return index % GRID_SIZE;
}

/**
 * Builds a freshly shuffled deck of 16 cards (8 pairs of the 8 symbols). Uses a
 * Fisher–Yates shuffle with Math.random — ordinary app code, run once server-side
 * at room creation. Every card starts face-down and unmatched.
 */
export function buildDeck(): Card[] {
  const values: string[] = [];
  for (const symbol of SYMBOLS) {
    values.push(symbol, symbol);
  }
  // Fisher–Yates in place.
  for (let i = values.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [values[i], values[j]] = [values[j], values[i]];
  }
  return values.map((value) => ({ value, matchedBy: null }));
}

/** True when cards at two distinct indices share the same symbol. */
export function cardsMatch(cards: Card[], a: number, b: number): boolean {
  return a !== b && cards[a].value === cards[b].value;
}

/** True once every card has been matched (all 8 pairs found). */
export function isAllMatched(cards: Card[]): boolean {
  return cards.every((card) => card.matchedBy !== null);
}

/** The winner by pair count: whoever has more pairs, or "draw" when tied. */
export function winnerByScore(scores: { p1: number; p2: number }): Player | "draw" {
  if (scores.p1 > scores.p2) return "p1";
  if (scores.p2 > scores.p1) return "p2";
  return "draw";
}
