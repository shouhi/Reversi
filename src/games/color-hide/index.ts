import type { GameMeta } from "../types";

/**
 * COLOR HIDE — catalog entry.
 *
 * A 3D online hide-and-seek game: paint your character to blend into the scenery
 * and avoid the seeker. Uses its own namespace everywhere (`color-hide:*`,
 * `/games/color-hide`, `/api/games/color-hide/*`) so it never touches reversi or
 * any existing game.
 *
 * Playable end-to-end (lobby → paint → 3D round → result), so it is `available`
 * with a real `href` — satisfying the registry invariant tested in
 * `src/games/registry.test.ts`. The live 3D round uses the realtime channel; see
 * `docs/COLOR_HIDE.md` for the local realtime host.
 */
export const colorHideGame: GameMeta = {
  id: "color-hide",
  slug: "color-hide",
  title: "COLOR HIDE",
  description:
    "自分の体に絵を描いて景色に擬態し、3D空間で友達とかくれんぼ。鬼から見つからず逃げ切れ。2〜6人対戦。",
  category: "アクション",
  minPlayers: 2,
  maxPlayers: 6,
  supportedModes: ["online-multi"],
  status: "available",
  displayOrder: 70,
  accent: "#22d3ee",
  href: "/games/color-hide",
};
