import type { GameMeta } from "../types";

/**
 * Connect Four's catalog entry. Imported into `src/games/registry.ts` to list
 * the game on the home page.
 */
export const connectFourGame: GameMeta = {
  id: "connect-four",
  slug: "connect-four",
  title: "四目並べ",
  description:
    "7×6の盤でコマを落とし、先に縦・横・斜めのいずれかに4つ並べたら勝ち。友達と2人でオンライン対戦。",
  category: "ボードゲーム",
  minPlayers: 2,
  maxPlayers: 2,
  supportedModes: ["online-2p"],
  status: "available",
  displayOrder: 30,
  accent: "#fbbf24",
  href: "/games/connect-four",
};
