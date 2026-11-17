/**
 * Platform-level types describing a game in the catalog. A game's metadata is
 * declared once (co-located with the game, e.g. `src/games/reversi/index.ts`)
 * and registered in `src/games/registry.ts`. The game list UI is driven
 * entirely by this data — adding a catalog entry is all it takes to list a game.
 */

export type GameMode =
  /** Two players, each on their own device, synced online. */
  | "online-2p"
  /** Three or more players online (future). */
  | "online-multi"
  /** A single player versus the computer or solo (future). */
  | "single-player";

export type GameStatus =
  /** Fully playable: has a detail page, logic, and API. */
  | "available"
  /** Listed but not yet playable: card is shown disabled. */
  | "coming-soon";

export interface GameMeta {
  /** Stable unique id (kebab-case). Never reused. */
  id: string;
  /** URL segment under `/games/`, e.g. "reversi". */
  slug: string;
  /** Display name, e.g. "リバーシ". */
  title: string;
  /** One-line description shown on the card and used for SEO. */
  description: string;
  /** Grouping label, e.g. "ボードゲーム". */
  category: string;
  minPlayers: number;
  maxPlayers: number;
  supportedModes: GameMode[];
  status: GameStatus;
  /** Lower numbers sort first in the catalog. */
  displayOrder: number;
  /**
   * Optional thumbnail image path under /public. When absent the GameCard
   * renders a built-in motif, so games work with no external assets.
   */
  thumbnail?: string;
  /**
   * CSS color used for the card's generated motif / accent. Defaults to the
   * platform accent when omitted.
   */
  accent?: string;
  /**
   * Route to the game's detail / start page. REQUIRED for `available` games and
   * MUST point at a real route. Omitted for `coming-soon` games so the card is
   * never a live link to a missing page.
   */
  href?: string;
}
