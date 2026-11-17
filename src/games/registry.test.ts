import { describe, it, expect } from "vitest";
import {
  getAllGames,
  getAvailableGames,
  getGameBySlug,
} from "./registry";

describe("game registry", () => {
  it("includes Reversi as an available game linking to /games/reversi", () => {
    const reversi = getGameBySlug("reversi");
    expect(reversi).toBeDefined();
    expect(reversi?.status).toBe("available");
    expect(reversi?.href).toBe("/games/reversi");
  });

  it("returns all games sorted by displayOrder", () => {
    const orders = getAllGames().map((g) => g.displayOrder);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });

  it("getAvailableGames returns only playable games", () => {
    const available = getAvailableGames();
    expect(available.length).toBeGreaterThan(0);
    expect(available.every((g) => g.status === "available")).toBe(true);
  });

  it("has unique ids and slugs", () => {
    const games = getAllGames();
    const ids = new Set(games.map((g) => g.id));
    const slugs = new Set(games.map((g) => g.slug));
    expect(ids.size).toBe(games.length);
    expect(slugs.size).toBe(games.length);
  });

  // The key catalog↔routing invariant: a card is only ever a live link when the
  // game is actually playable, so the UI can never link to a missing page.
  it("every available game has an href; coming-soon games have none", () => {
    for (const game of getAllGames()) {
      if (game.status === "available") {
        expect(game.href, `${game.id} must have an href`).toBeTruthy();
      } else {
        expect(game.href, `${game.id} must not link anywhere`).toBeUndefined();
      }
    }
  });

  it("has sane player counts", () => {
    for (const game of getAllGames()) {
      expect(game.minPlayers).toBeGreaterThanOrEqual(1);
      expect(game.maxPlayers).toBeGreaterThanOrEqual(game.minPlayers);
      expect(game.supportedModes.length).toBeGreaterThan(0);
    }
  });

  it("returns undefined for an unknown slug", () => {
    expect(getGameBySlug("nope-not-real")).toBeUndefined();
  });
});
