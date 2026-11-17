import type { GameMeta } from "../types";

/**
 * Minecart's catalog entry. A single-player, canvas-based action game (no server
 * rooms / Redis / API) — it lives entirely in the browser with localStorage
 * progress. Imported into `src/games/registry.ts` to list it on the home page.
 */
export const minecartGame: GameMeta = {
  id: "minecart",
  slug: "minecart",
  title: "トロッコダッシュ",
  description:
    "自動で走るトロッコをタップでジャンプ。鉱山の切れ目や障害物を飛び越える1人用アクション。全12ステージ。",
  category: "アクション",
  minPlayers: 1,
  maxPlayers: 1,
  supportedModes: ["single-player"],
  status: "available",
  displayOrder: 60,
  accent: "#f6b24a",
  href: "/games/minecart",
};
