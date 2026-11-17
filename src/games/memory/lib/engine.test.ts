import { describe, it, expect } from "vitest";
import {
  type Card,
  SYMBOLS,
  CARD_COUNT,
  PAIR_COUNT,
  GRID_SIZE,
  buildDeck,
  cardsMatch,
  colOf,
  isAllMatched,
  opponent,
  rowOf,
  winnerByScore,
} from "./engine";

/** A deck with a pair at every (2i, 2i+1), in symbol order. */
function pairedDeck(): Card[] {
  const out: Card[] = [];
  for (const symbol of SYMBOLS) {
    out.push({ value: symbol, matchedBy: null });
    out.push({ value: symbol, matchedBy: null });
  }
  return out;
}

describe("constants", () => {
  it("describe a 4×4 board of 8 pairs", () => {
    expect(GRID_SIZE).toBe(4);
    expect(CARD_COUNT).toBe(16);
    expect(PAIR_COUNT).toBe(8);
    expect(SYMBOLS).toHaveLength(8);
    expect(new Set(SYMBOLS).size).toBe(8); // all distinct
  });
});

describe("opponent", () => {
  it("swaps players", () => {
    expect(opponent("p1")).toBe("p2");
    expect(opponent("p2")).toBe("p1");
  });
});

describe("rowOf / colOf", () => {
  it("map a card index to grid coordinates", () => {
    expect([rowOf(0), colOf(0)]).toEqual([0, 0]);
    expect([rowOf(3), colOf(3)]).toEqual([0, 3]);
    expect([rowOf(4), colOf(4)]).toEqual([1, 0]);
    expect([rowOf(15), colOf(15)]).toEqual([3, 3]);
  });
});

describe("buildDeck", () => {
  it("has 16 cards: exactly 8 pairs of the 8 symbols, all face-down", () => {
    const deck = buildDeck();
    expect(deck).toHaveLength(16);

    const counts = new Map<string, number>();
    for (const card of deck) {
      expect(card.matchedBy).toBeNull();
      counts.set(card.value, (counts.get(card.value) ?? 0) + 1);
    }
    expect(counts.size).toBe(8);
    for (const symbol of SYMBOLS) expect(counts.get(symbol)).toBe(2);
  });

  it("produces independent decks (no shared references)", () => {
    const a = buildDeck();
    const b = buildDeck();
    a[0].matchedBy = "p1";
    expect(b[0].matchedBy).toBeNull();
  });
});

describe("cardsMatch", () => {
  const deck = pairedDeck();
  it("is true for two distinct cards with the same symbol", () => {
    expect(cardsMatch(deck, 0, 1)).toBe(true);
  });
  it("is false for different symbols", () => {
    expect(cardsMatch(deck, 0, 2)).toBe(false);
  });
  it("is false when the two indices are identical", () => {
    expect(cardsMatch(deck, 0, 0)).toBe(false);
  });
});

describe("isAllMatched", () => {
  it("is false while any card is unmatched", () => {
    const deck = pairedDeck();
    deck[0].matchedBy = "p1";
    expect(isAllMatched(deck)).toBe(false);
  });
  it("is true once every card is owned", () => {
    const deck = pairedDeck();
    for (const card of deck) card.matchedBy = "p1";
    expect(isAllMatched(deck)).toBe(true);
  });
});

describe("winnerByScore", () => {
  it("returns the higher-scoring player", () => {
    expect(winnerByScore({ p1: 5, p2: 3 })).toBe("p1");
    expect(winnerByScore({ p1: 2, p2: 6 })).toBe("p2");
  });
  it("returns draw on a tie", () => {
    expect(winnerByScore({ p1: 4, p2: 4 })).toBe("draw");
  });
});
