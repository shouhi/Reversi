/**
 * Same-room rematch — shared consent + round bookkeeping (Phase 12 PR-B).
 *
 * After a game finishes, the two players can replay in the SAME room/URL without
 * a new invite. This module owns ONLY the game-agnostic parts:
 *   - a monotonic `roundId` identifying each game instance (stale operations from
 *     an old round can be rejected), and
 *   - the two-sided consent ("votes") so a rematch starts ONLY when BOTH players
 *     agree — never on one side alone.
 *
 * Everything game-specific — board initialisation, which seat moves first, score
 * reset, special rules — stays in each game's own roomService. A game adopts a
 * rematch by:
 *   1. adding `rematch: RematchState` to its persisted RoomState (seed with
 *      {@link initialRematch} in createRoom),
 *   2. exposing `roundId` + {@link RematchView} in its public state via
 *      {@link toRematchView}, and
 *   3. implementing `requestRematch` with {@link addVote}/{@link allVoted} and a
 *      game-specific reset that calls {@link nextRound}.
 *
 * This keeps the consent/round logic in one tested place without over-abstracting
 * the games themselves.
 */

/** Seat / role identifier within a two-seat room (e.g. "o"|"x", "black"|"white"). */
export type Seat = string;

/** Round + consent metadata persisted alongside a rematch-capable room. */
export interface RematchState {
  /** Monotonic game-instance id. 1 for the first game; +1 on each confirmed rematch. */
  roundId: number;
  /** Seats that have requested a rematch for the CURRENT (finished) game. */
  votes: Seat[];
}

/** The rematch state for a brand-new room: round 1, nobody has voted. */
export function initialRematch(): RematchState {
  return { roundId: 1, votes: [] };
}

/**
 * Normalises a possibly-absent rematch field. Rooms created before this feature
 * (still alive under their 24h TTL) have no `rematch`; treat them as round 1.
 */
export function getRematch(state: { rematch?: RematchState }): RematchState {
  return state.rematch ?? initialRematch();
}

/** Whether `seat` has already requested a rematch for the current game. */
export function hasVoted(r: RematchState, seat: Seat): boolean {
  return r.votes.includes(seat);
}

/** Idempotently records a seat's rematch vote (no duplicate entries). */
export function addVote(r: RematchState, seat: Seat): RematchState {
  return r.votes.includes(seat) ? r : { ...r, votes: [...r.votes, seat] };
}

/** True once every required seat has voted (and there is at least one seat). */
export function allVoted(r: RematchState, seats: readonly Seat[]): boolean {
  return seats.length > 0 && seats.every((s) => r.votes.includes(s));
}

/** Begins the next game instance: bumps `roundId`, clears all votes. */
export function nextRound(r: RematchState): RematchState {
  return { roundId: r.roundId + 1, votes: [] };
}

/** Client-facing projection of the rematch state, relative to one viewer. */
export interface RematchView {
  /** The current game-instance id; clients use it to detect a new round. */
  roundId: number;
  /** Whether the requesting player has asked for a rematch. */
  youRequested: boolean;
  /** Whether the other player has asked for a rematch. */
  opponentRequested: boolean;
}

/**
 * Projects the (secret-free) rematch view for the caller. `yourSeat` is null for
 * a non-participant, in which case `opponentRequested` reflects any pending vote.
 */
export function toRematchView(r: RematchState, yourSeat: Seat | null): RematchView {
  return {
    roundId: r.roundId,
    youRequested: yourSeat != null && r.votes.includes(yourSeat),
    opponentRequested: r.votes.some((s) => s !== yourSeat),
  };
}
