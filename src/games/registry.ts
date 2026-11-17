import type { GameMeta } from "./types";
import { reversiGame } from "./reversi";
import { ticTacToeGame } from "./tic-tac-toe";
import { connectFourGame } from "./connect-four";
import { chessGame } from "./chess";
import { shogiGame } from "./shogi";
import { memoryGame } from "./memory";

/**
 * The single source of truth for the game catalog.
 *
 * To LIST a new game, add its `GameMeta` here (import it from the game's own
 * `index.ts`). To mark a game as not-yet-playable, add a `coming-soon` entry
 * with no `href` — the UI renders it as a disabled card, so the catalog can
 * advertise the roadmap without ever linking to a missing page.
 *
 * See `docs/ADDING_GAMES.md` for the full "add a game" procedure.
 */
const GAMES: GameMeta[] = [
  reversiGame,
  ticTacToeGame,
  connectFourGame,
  chessGame,
  shogiGame,
  memoryGame,
];

const byOrder = (a: GameMeta, b: GameMeta) => a.displayOrder - b.displayOrder;

/** All catalog games (available + coming-soon), sorted for display. */
export function getAllGames(): GameMeta[] {
  return [...GAMES].sort(byOrder);
}

/** Only the games that are actually playable right now. */
export function getAvailableGames(): GameMeta[] {
  return getAllGames().filter((g) => g.status === "available");
}

/** Finds a game by its URL slug, or undefined if unknown. */
export function getGameBySlug(slug: string): GameMeta | undefined {
  return GAMES.find((g) => g.slug === slug);
}
