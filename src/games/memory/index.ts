import type { GameMeta } from "../types";

/**
 * 神経衰弱's catalog entry. Imported into `src/games/registry.ts` to list the
 * game on the home page.
 */
export const memoryGame: GameMeta = {
  id: "memory",
  slug: "memory",
  title: "神経衰弱",
  description:
    "めくったカードのペアを当てる記憶力ゲーム。友達と2人で交互にめくり、多くのペアを取った方が勝ち。",
  category: "カードゲーム",
  minPlayers: 2,
  maxPlayers: 2,
  supportedModes: ["online-2p"],
  status: "available",
  displayOrder: 50,
  accent: "#f472b6",
  href: "/games/memory",
};
