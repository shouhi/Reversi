import type { GameMeta } from "../types";

/**
 * Chess's catalog entry. Imported into `src/games/registry.ts` to list the game
 * on the home page.
 */
export const chessGame: GameMeta = {
  id: "chess",
  slug: "chess",
  title: "チェス",
  description:
    "世界で親しまれる戦略ボードゲーム。友達と2人でオンライン対戦。駒の合法手・チェック・チェックメイトに対応。",
  category: "ボードゲーム",
  minPlayers: 2,
  maxPlayers: 2,
  supportedModes: ["online-2p"],
  status: "available",
  displayOrder: 40,
  accent: "#a78bfa",
  href: "/games/chess",
};
