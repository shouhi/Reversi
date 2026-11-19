import type { Piece } from "./engine";

/**
 * COLOR shogi — board orientation (Phase 12 P0-1).
 *
 * The board is stored in canonical coordinates (row 0 = gote's back rank at the
 * top, row 8 = sente's back rank at the bottom — see engine.ts). Sente naturally
 * views that from the bottom. The GOTE viewer gets a 180° DISPLAY flip so their own
 * pieces sit at the bottom too — but ONLY the display position is transformed; the
 * logic/stored coordinates, legal-move checks, and persisted state never change.
 *
 * These pure helpers are unit-tested so the display↔logic mapping can't silently
 * break (which would let a player click the wrong square).
 */
export type Viewer = Piece["owner"]; // "sente" | "gote"

/** True when the board should be flipped 180° for this viewer (gote). */
export function viewerFlipped(viewer: Viewer): boolean {
  return viewer === "gote";
}

/**
 * Map a DISPLAY slot (grid position the user sees, 0..8) to the canonical LOGIC
 * coordinate. For the flipped (gote) view both axes are mirrored: 0↔8, 4 stays.
 * The inverse (logic → display) is the same formula, so this doubles as both.
 */
export function toLogicCoord(
  displayRow: number,
  displayCol: number,
  flip: boolean,
): { row: number; col: number } {
  return flip
    ? { row: 8 - displayRow, col: 8 - displayCol }
    : { row: displayRow, col: displayCol };
}
