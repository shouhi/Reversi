import type { GameMeta } from "../types";

/**
 * Tic-Tac-Toe's catalog entry. Imported into `src/games/registry.ts` to list
 * the game on the home page.
 */
export const ticTacToeGame: GameMeta = {
  id: "tic-tac-toe",
  slug: "tic-tac-toe",
  title: "○×ゲーム",
  description:
    "3×3のマスに先手○・後手×で交互に印を書き、先に3つ並べたら勝ち。友達と2人でオンライン対戦。",
  category: "ボードゲーム",
  minPlayers: 2,
  maxPlayers: 2,
  supportedModes: ["online-2p"],
  status: "available",
  displayOrder: 20,
  accent: "#60a5fa",
  href: "/games/tic-tac-toe",
};
