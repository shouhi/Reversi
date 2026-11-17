import type { GameMeta } from "./types";
import { reversiGame } from "./reversi";
import { ticTacToeGame } from "./tic-tac-toe";

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

  // --- Coming soon (listed, not yet playable; no route) --------------------
  {
    id: "connect-four",
    slug: "connect-four",
    title: "四目並べ",
    description: "コマを落として縦・横・斜めに4つ並べることを狙う対戦ゲーム。",
    category: "ボードゲーム",
    minPlayers: 2,
    maxPlayers: 2,
    supportedModes: ["online-2p"],
    status: "coming-soon",
    displayOrder: 30,
    accent: "#fbbf24",
  },
  {
    id: "chess",
    slug: "chess",
    title: "チェス",
    description: "世界で親しまれる戦略ボードゲーム。友達と腕を競おう。",
    category: "ボードゲーム",
    minPlayers: 2,
    maxPlayers: 2,
    supportedModes: ["online-2p"],
    status: "coming-soon",
    displayOrder: 40,
    accent: "#a78bfa",
  },
  {
    id: "memory",
    slug: "memory",
    title: "神経衰弱",
    description: "めくったカードのペアを当てる記憶力ゲーム。",
    category: "カードゲーム",
    minPlayers: 2,
    maxPlayers: 4,
    supportedModes: ["online-2p", "online-multi"],
    status: "coming-soon",
    displayOrder: 50,
    accent: "#f472b6",
  },
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
