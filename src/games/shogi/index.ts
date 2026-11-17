import type { GameMeta } from "../types";

/**
 * Shogi's catalog entry. Imported into `src/games/registry.ts` to list the game
 * on the home page.
 */
export const shogiGame: GameMeta = {
  id: "shogi",
  slug: "shogi",
  title: "将棋",
  description:
    "9×9の盤と持ち駒を使う日本の伝統ボードゲーム。友達と2人でオンライン対戦。合法手・成り・駒打ち・王手・詰みに対応。",
  category: "ボードゲーム",
  minPlayers: 2,
  maxPlayers: 2,
  supportedModes: ["online-2p"],
  status: "available",
  displayOrder: 45,
  accent: "#fb923c",
  href: "/games/shogi",
};
