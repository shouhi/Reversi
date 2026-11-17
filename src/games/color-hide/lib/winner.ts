import type { PlayerRecord, RoundResult } from "../types";

/**
 * COLOR HIDE — pure round outcome logic.
 *
 * Win conditions:
 *   - SEEKER wins by catching every hider before the seek timer ends.
 *   - HIDERS win if the seek timer ends with at least one hider uncaught.
 *
 * The caller decides *when* a round ends (all hiders caught → end immediately
 * with a seeker win; seek timer expires → end and evaluate). This module only
 * derives the outcome from the roster's authoritative `caught` flags, so it is
 * trivially unit-testable.
 */

/** The hiders in a round (everyone with role "hider"; excludes the seeker). */
export function hiders(players: PlayerRecord[]): PlayerRecord[] {
  return players.filter((p) => p.role === "hider");
}

/** True when every hider has been caught (⇒ the seeker has won). */
export function allHidersCaught(players: PlayerRecord[]): boolean {
  const hs = hiders(players);
  return hs.length > 0 && hs.every((h) => h.caught);
}

/**
 * Freezes the round outcome from the current roster. `survivors` are uncaught
 * hiders; the winner is the seeker iff there are none left standing.
 */
export function buildRoundResult(
  players: PlayerRecord[],
  seekerId: string,
  endedAt: number,
): RoundResult {
  const hs = hiders(players);
  const survivors = hs.filter((h) => !h.caught).map((h) => h.id);
  const caught = hs.filter((h) => h.caught).map((h) => h.id);
  return {
    winner: survivors.length === 0 ? "seeker" : "hider",
    survivors,
    caught,
    seekerId,
    endedAt,
  };
}
