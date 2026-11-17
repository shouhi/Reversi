import type { GameMeta } from "../types";

/**
 * Reversi's catalog entry. Importing this into `src/games/registry.ts` is what
 * lists the game on the home page. Keep it co-located with the game so a game
 * is fully described by its own folder.
 */
export const reversiGame: GameMeta = {
  id: "reversi",
  slug: "reversi",
  title: "リバーシ",
  description:
    "8×8の盤で白黒の石を挟んで裏返す、定番のボードゲーム。友達と2人でオンライン対戦。",
  category: "ボードゲーム",
  minPlayers: 2,
  maxPlayers: 2,
  supportedModes: ["online-2p"],
  status: "available",
  displayOrder: 10,
  accent: "#34d399",
  href: "/games/reversi",
};
