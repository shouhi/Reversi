import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createMemoryStore, __resetMemoryStore } from "@/lib/store/memory";
import {
  createRoom,
  joinRoom,
  playMove,
  getRoomView,
  requestRematch,
  MEMORY_ROOM_PREFIX,
} from "./roomService";
import { hashToken } from "@/lib/tokens";
import { initialRematch } from "@/lib/rematch";
import { SYMBOLS, buildDeck, CARD_COUNT, type Card } from "./engine";
import type { RoomState } from "../types";

function freshStore() {
  __resetMemoryStore();
  return createMemoryStore<RoomState>(MEMORY_ROOM_PREFIX);
}

/** A deterministic deck: a pair at every (2i, 2i+1), in symbol order. */
function pairedDeck(): Card[] {
  const out: Card[] = [];
  for (const symbol of SYMBOLS) {
    out.push({ value: symbol, matchedBy: null });
    out.push({ value: symbol, matchedBy: null });
  }
  return out;
}

/**
 * Seeds a started game with a KNOWN deck (so match/mismatch are deterministic),
 * bypassing the shuffle by writing a RoomState directly.
 */
async function seedGame(overrides: Partial<RoomState> = {}) {
  const store = freshStore();
  const p1Token = "p1-secret";
  const p2Token = "p2-secret";
  const roomId = overrides.roomId ?? "seededroom01";
  const base: RoomState = {
    roomId,
    cards: pairedDeck(),
    revealed: [],
    scores: { p1: 0, p2: 0 },
    currentTurn: "p1",
    status: "playing",
    winner: null,
    p1TokenHash: hashToken(p1Token),
    p2TokenHash: hashToken(p2Token),
    rematch: initialRematch(),
    version: 2,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
  expect(await store.create(base.roomId, base, 3600)).toBe(true);
  return { store, roomId: base.roomId, p1Token, p2Token };
}

/** A started game using the REAL shuffle (deck layout unknown). */
async function startedGame() {
  const store = freshStore();
  const created = await createRoom(store);
  if (!created.ok) throw new Error("create failed");
  const joined = await joinRoom(store, created.value.roomId, null);
  if (!joined.ok || !joined.value.token) throw new Error("join failed");
  return {
    store,
    roomId: created.value.roomId,
    p1Token: created.value.token,
    p2Token: joined.value.token,
  };
}

beforeEach(() => {
  __resetMemoryStore();
});

describe("createRoom", () => {
  it("creates a waiting room with the creator as p1 and an 8-pair deck", async () => {
    const store = freshStore();
    const result = await createRoom(store);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.roomId).toMatch(/^[a-z0-9]{12}$/);
    expect(result.value.publicState.status).toBe("waiting");
    expect(result.value.publicState.yourRole).toBe("p1");
    expect(result.value.publicState.seats).toEqual({ p1: true, p2: false });
    expect(result.value.publicState.scores).toEqual({ p1: 0, p2: 0 });

    // Inspect the internal deck: 16 cards, 8 symbols each appearing twice.
    const internal = await store.get(result.value.roomId);
    expect(internal?.cards).toHaveLength(16);
    const counts = new Map<string, number>();
    for (const card of internal!.cards) {
      counts.set(card.value, (counts.get(card.value) ?? 0) + 1);
    }
    expect(counts.size).toBe(8);
    for (const n of counts.values()) expect(n).toBe(2);
  });

  it("never leaks token hashes and hides every face-down card value", async () => {
    const store = freshStore();
    const result = await createRoom(store);
    if (!result.ok) throw new Error();
    const serialized = JSON.stringify(result.value.publicState);
    expect(serialized).not.toContain("TokenHash");
    expect(serialized).not.toContain(hashToken(result.value.token));
    // Nothing is revealed or matched yet → every public card value is null.
    for (const card of result.value.publicState.cards) {
      expect(card.value).toBeNull();
    }
  });
});

describe("joinRoom", () => {
  it("assigns p2 and starts the game", async () => {
    const store = freshStore();
    const created = await createRoom(store);
    if (!created.ok) throw new Error();

    const joined = await joinRoom(store, created.value.roomId, null);
    expect(joined.ok).toBe(true);
    if (!joined.ok) return;
    expect(joined.value.token).toBeTruthy();
    expect(joined.value.publicState.status).toBe("playing");
    expect(joined.value.publicState.yourRole).toBe("p2");
    expect(joined.value.publicState.currentTurn).toBe("p1");
    expect(joined.value.publicState.seats).toEqual({ p1: true, p2: true });
  });

  it("rejects a third player as room_full", async () => {
    const { store, roomId } = await startedGame();
    const third = await joinRoom(store, roomId, null);
    expect(third.ok).toBe(false);
    if (!third.ok) expect(third.error.code).toBe("room_full");
  });

  it("treats an existing player's token as a reconnect (no new token)", async () => {
    const { store, roomId, p2Token } = await startedGame();
    const rejoin = await joinRoom(store, roomId, p2Token);
    expect(rejoin.ok).toBe(true);
    if (!rejoin.ok) return;
    expect(rejoin.value.token).toBeUndefined();
    expect(rejoin.value.publicState.yourRole).toBe("p2");
  });

  it("only one of two simultaneous joiners gets the p2 seat", async () => {
    const store = freshStore();
    const created = await createRoom(store);
    if (!created.ok) throw new Error();
    const roomId = created.value.roomId;

    const [a, b] = await Promise.all([
      joinRoom(store, roomId, null),
      joinRoom(store, roomId, null),
    ]);

    const successes = [a, b].filter((r) => r.ok && r.value.token);
    const failures = [a, b].filter((r) => !r.ok);
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
  });
});

describe("playMove — authorization", () => {
  it("rejects a non-player token", async () => {
    const { store, roomId } = await seedGame();
    const result = await playMove(store, roomId, "bogus-token", 0);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("not_a_player");
  });

  it("rejects flipping out of turn", async () => {
    const { store, roomId, p2Token } = await seedGame();
    const result = await playMove(store, roomId, p2Token, 0);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("not_your_turn");
      expect(result.error.publicState?.currentTurn).toBe("p1");
    }
  });

  it("rejects an out-of-range index as invalid_request", async () => {
    const { store, roomId, p1Token } = await seedGame();
    const result = await playMove(store, roomId, p1Token, 16);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_request");
  });

  it("rejects flipping an already-matched card as illegal_move", async () => {
    const cards = pairedDeck();
    cards[0].matchedBy = "p1";
    cards[1].matchedBy = "p1";
    const { store, roomId, p1Token } = await seedGame({
      cards,
      scores: { p1: 1, p2: 0 },
    });
    const result = await playMove(store, roomId, p1Token, 0);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("illegal_move");
  });

  it("refuses moves before the second player joins (game_not_active)", async () => {
    const store = freshStore();
    const created = await createRoom(store);
    if (!created.ok) throw new Error();
    const result = await playMove(
      store,
      created.value.roomId,
      created.value.token,
      0,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("game_not_active");
  });
});

describe("playMove — flip mechanics", () => {
  it("first flip reveals a card and keeps the turn", async () => {
    const { store, roomId, p1Token } = await seedGame();
    const res = await playMove(store, roomId, p1Token, 0);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.revealed).toEqual([0]);
    expect(res.value.currentTurn).toBe("p1"); // stays
    expect(res.value.version).toBe(3); // seeded at 2
    expect(res.value.cards[0].value).toBe(SYMBOLS[0]); // now visible
  });

  it("a match keeps the turn, scores a pair, and marks both cards", async () => {
    const { store, roomId, p1Token } = await seedGame();
    await playMove(store, roomId, p1Token, 0);
    const res = await playMove(store, roomId, p1Token, 1); // same symbol
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.scores).toEqual({ p1: 1, p2: 0 });
    expect(res.value.currentTurn).toBe("p1"); // plays again
    expect(res.value.revealed).toEqual([]);
    expect(res.value.cards[0].matchedBy).toBe("p1");
    expect(res.value.cards[1].matchedBy).toBe("p1");
    expect(res.value.status).toBe("playing");
  });

  it("a mismatch passes the turn and leaves both cards revealed", async () => {
    const { store, roomId, p1Token } = await seedGame();
    await playMove(store, roomId, p1Token, 0); // SYMBOLS[0]
    const res = await playMove(store, roomId, p1Token, 2); // SYMBOLS[1]
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.revealed).toEqual([0, 2]);
    expect(res.value.currentTurn).toBe("p2"); // turn passes
    expect(res.value.scores).toEqual({ p1: 0, p2: 0 });
    expect(res.value.cards[0].value).toBe(SYMBOLS[0]);
    expect(res.value.cards[2].value).toBe(SYMBOLS[1]);
  });

  it("the opponent's next flip clears the leftover mismatch", async () => {
    const { store, roomId, p1Token, p2Token } = await seedGame();
    await playMove(store, roomId, p1Token, 0);
    const mismatch = await playMove(store, roomId, p1Token, 2);
    expect(mismatch.ok).toBe(true);
    if (!mismatch.ok) return;
    expect(mismatch.value.revealed).toEqual([0, 2]);

    // p2 flips a fresh card: the leftover [0,2] is cleared first.
    const res = await playMove(store, roomId, p2Token, 4);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.revealed).toEqual([4]); // only the new flip
    expect(res.value.currentTurn).toBe("p2"); // stays (new first flip)
    expect(res.value.cards[0].value).toBeNull(); // hidden again
    expect(res.value.cards[2].value).toBeNull();
    expect(res.value.cards[4].value).toBe(SYMBOLS[2]);
  });

  it("double-tapping the same card applies it once", async () => {
    const { store, roomId, p1Token } = await startedGame();
    const [a, b] = await Promise.all([
      playMove(store, roomId, p1Token, 0),
      playMove(store, roomId, p1Token, 0),
    ]);
    const oks = [a, b].filter((r) => r.ok);
    const errs = [a, b].filter((r) => !r.ok);
    expect(oks).toHaveLength(1);
    expect(errs).toHaveLength(1);
  });
});

describe("playMove — finishing", () => {
  it("completing the last pair finishes with the higher-score winner", async () => {
    const cards = pairedDeck();
    // 7 pairs already won: p1 has pairs 0-3 (indices 0-7), p2 has 4-6 (8-13).
    for (let i = 0; i <= 7; i++) cards[i].matchedBy = "p1";
    for (let i = 8; i <= 13; i++) cards[i].matchedBy = "p2";
    const { store, roomId, p1Token } = await seedGame({
      cards,
      scores: { p1: 4, p2: 3 },
      currentTurn: "p1",
    });
    await playMove(store, roomId, p1Token, 14);
    const res = await playMove(store, roomId, p1Token, 15); // completes last pair
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.status).toBe("finished");
    expect(res.value.scores).toEqual({ p1: 5, p2: 3 });
    expect(res.value.winner).toBe("p1");

    // Any further flip is refused as game_over.
    const after = await playMove(store, roomId, p1Token, 0);
    expect(after.ok).toBe(false);
    if (!after.ok) expect(after.error.code).toBe("game_over");
  });

  it("completing the last pair can finish in a draw", async () => {
    const cards = pairedDeck();
    // p1 has 3 pairs (indices 0-5), p2 has 4 pairs (indices 6-13).
    for (let i = 0; i <= 5; i++) cards[i].matchedBy = "p1";
    for (let i = 6; i <= 13; i++) cards[i].matchedBy = "p2";
    const { store, roomId, p1Token } = await seedGame({
      roomId: "drawroom0001",
      cards,
      scores: { p1: 3, p2: 4 },
      currentTurn: "p1",
    });
    await playMove(store, roomId, p1Token, 14);
    const res = await playMove(store, roomId, p1Token, 15);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.status).toBe("finished");
    expect(res.value.scores).toEqual({ p1: 4, p2: 4 });
    expect(res.value.winner).toBe("draw");
  });
});

describe("public view security", () => {
  it("hides unrevealed/unmatched card values after a flip", async () => {
    const { store, roomId, p1Token } = await seedGame();
    const res = await playMove(store, roomId, p1Token, 0);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.cards[0].value).toBe(SYMBOLS[0]); // revealed
    for (let i = 1; i < 16; i++) {
      expect(res.value.cards[i].value).toBeNull(); // still face-down
    }
  });

  it("getRoomView exposes only matched and revealed values", async () => {
    const cards = pairedDeck();
    cards[0].matchedBy = "p1";
    cards[1].matchedBy = "p1";
    const { store, roomId } = await seedGame({
      cards,
      revealed: [4], // one card currently face-up, mid-turn
      scores: { p1: 1, p2: 0 },
    });
    const view = await getRoomView(store, roomId, null);
    expect(view.ok).toBe(true);
    if (!view.ok) return;
    const c = view.value.cards;
    expect(c[0].value).toBe(SYMBOLS[0]); // matched
    expect(c[1].value).toBe(SYMBOLS[0]); // matched
    expect(c[4].value).toBe(SYMBOLS[2]); // revealed
    // Everything else stays hidden.
    for (const i of [2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]) {
      expect(c[i].value).toBeNull();
    }
    // And no token hashes leak.
    expect(JSON.stringify(view.value)).not.toContain("TokenHash");
  });
});

// ---------------------------------------------------------------------------
// Rematch (same room, same players) — with server-side re-shuffle
// ---------------------------------------------------------------------------

/** Counts how many times each symbol appears across a full deck. */
function symbolCounts(cards: Card[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const c of cards) counts[c.value] = (counts[c.value] ?? 0) + 1;
  return counts;
}

/** Seeds a FINISHED game (p1 won 5–3) with a known in-order deck. */
async function seedFinishedGame() {
  return seedGame({
    roomId: "rematchmemroom",
    status: "finished",
    winner: "p1",
    scores: { p1: 5, p2: 3 },
    cards: pairedDeck().map((c) => ({ ...c, matchedBy: "p1" as const })),
    revealed: [],
  });
}

/** Forces the current round to a finished state (isolated test helper). */
async function forceFinish(store: ReturnType<typeof freshStore>, roomId: string) {
  const s = await store.get(roomId);
  if (!s) throw new Error("forceFinish: no room");
  const cas = await store.compareAndSwap(
    roomId,
    s.version,
    { ...s, status: "finished", winner: "p1", version: s.version + 1 },
    3600,
  );
  if (cas !== "ok") throw new Error("forceFinish: cas " + cas);
}

describe("requestRematch", () => {
  afterEach(() => vi.restoreAllMocks());

  it("one-sided request does NOT start a new game", async () => {
    const { store, roomId, p1Token, p2Token } = await seedFinishedGame();
    const r = await requestRematch(store, roomId, p1Token, 1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.status).toBe("finished");
    expect(r.value.rematch.youRequested).toBe(true);
    const p2 = await getRoomView(store, roomId, p2Token);
    expect(p2.ok && p2.value.rematch.opponentRequested).toBe(true);
  });

  it("both requests reset to a face-down, re-shuffled board with scores 0 and swapped seats", async () => {
    const { store, roomId, p1Token, p2Token } = await seedFinishedGame();
    await requestRematch(store, roomId, p1Token, 1);
    const second = await requestRematch(store, roomId, p2Token, 1);
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.value.status).toBe("playing");
    expect(second.value.roundId).toBe(2);
    expect(second.value.winner).toBeNull();
    expect(second.value.scores).toEqual({ p1: 0, p2: 0 });
    expect(second.value.revealed).toEqual([]);
    expect(second.value.currentTurn).toBe("p1");
    // Every card is face-down (value hidden) and unmatched in the public view.
    expect(second.value.cards).toHaveLength(CARD_COUNT);
    for (const card of second.value.cards) {
      expect(card.value).toBeNull();
      expect(card.matchedBy).toBeNull();
    }
    // Seats swapped: the previous p2 now plays p1 (opens).
    const p1View = await getRoomView(store, roomId, p1Token);
    const p2View = await getRoomView(store, roomId, p2Token);
    expect(p1View.ok && p1View.value.yourRole).toBe("p2");
    expect(p2View.ok && p2View.value.yourRole).toBe("p1");
  });

  it("re-shuffles a complete, correct deck (8 pairs, all face-down) — from server state", async () => {
    const { store, roomId, p1Token, p2Token } = await seedFinishedGame();
    await requestRematch(store, roomId, p1Token, 1);
    await requestRematch(store, roomId, p2Token, 1);
    const persisted = await store.get(roomId);
    expect(persisted).not.toBeNull();
    if (!persisted) return;
    // 16 cards, each of the 8 symbols exactly twice, none matched.
    expect(persisted.cards).toHaveLength(CARD_COUNT);
    const counts = symbolCounts(persisted.cards);
    for (const symbol of SYMBOLS) expect(counts[symbol]).toBe(2);
    expect(persisted.cards.every((c) => c.matchedBy === null)).toBe(true);
  });

  it("the re-shuffle is server-authoritative (deterministic under a controlled RNG)", async () => {
    // Freeze Math.random so the shuffle is deterministic; the rematch deck must
    // equal a freshly built deck under the same RNG — proving the SERVER builds it.
    const { store, roomId, p1Token, p2Token } = await seedFinishedGame();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const expected = buildDeck().map((c) => c.value);
    await requestRematch(store, roomId, p1Token, 1);
    await requestRematch(store, roomId, p2Token, 1);
    const persisted = await store.get(roomId);
    expect(persisted?.cards.map((c) => c.value)).toEqual(expected);
  });

  it("is idempotent: repeat votes keep a single pending request", async () => {
    const { store, roomId, p1Token } = await seedFinishedGame();
    const first = await requestRematch(store, roomId, p1Token, 1);
    const again = await requestRematch(store, roomId, p1Token, 1);
    if (!first.ok || !again.ok) throw new Error("vote failed");
    expect(again.value.version).toBe(first.value.version);
  });

  it("concurrent requests start exactly one new round", async () => {
    const { store, roomId, p1Token, p2Token } = await seedFinishedGame();
    await Promise.all([
      requestRematch(store, roomId, p1Token, 1),
      requestRematch(store, roomId, p2Token, 1),
    ]);
    const view = await getRoomView(store, roomId, p1Token);
    expect(view.ok && view.value.roundId).toBe(2);
    expect(view.ok && view.value.status).toBe("playing");
  });

  it("rejects a non-player token", async () => {
    const { store, roomId } = await seedFinishedGame();
    const r = await requestRematch(store, roomId, "outsider", 1);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("not_a_player");
  });

  it("rejects a rematch while the game is in progress", async () => {
    const { store, roomId, p1Token } = await startedGame();
    const r = await requestRematch(store, roomId, p1Token, 1);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("rematch_unavailable");
  });

  it("rejects a stale roundId", async () => {
    const { store, roomId, p1Token } = await seedFinishedGame();
    const r = await requestRematch(store, roomId, p1Token, 42);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("stale_round");
  });

  it("allows a legal flip in the new round and rejects a stale old-round flip", async () => {
    const { store, roomId, p1Token, p2Token } = await seedFinishedGame();
    await requestRematch(store, roomId, p1Token, 1);
    await requestRematch(store, roomId, p2Token, 1);
    // Seats swapped → p2Token is now p1 (opener). A fresh flip works.
    const flip = await playMove(store, roomId, p2Token, 0, 2);
    expect(flip.ok).toBe(true);
    if (!flip.ok) return;
    expect(flip.value.revealed).toEqual([0]);
    // The same flip tagged with the OLD round is refused.
    const stale = await playMove(store, roomId, p2Token, 1, 1);
    expect(stale.ok).toBe(false);
    if (stale.ok) return;
    expect(stale.error.code).toBe("stale_round");
  });

  it("survives three consecutive rematches, alternating the opening seat", async () => {
    const { store, roomId, p1Token, p2Token } = await seedFinishedGame();
    for (const expectedRound of [2, 3, 4]) {
      await requestRematch(store, roomId, p1Token, expectedRound - 1);
      const done = await requestRematch(store, roomId, p2Token, expectedRound - 1);
      expect(done.ok && done.value.roundId).toBe(expectedRound);
      await forceFinish(store, roomId);
    }
    const view = await getRoomView(store, roomId, p1Token);
    expect(view.ok && view.value.roundId).toBe(4);
    expect(view.ok && view.value.yourRole).toBe("p2"); // 3 swaps
  });

  it("reconnect (getRoomView) restores the pending rematch state", async () => {
    const { store, roomId, p1Token, p2Token } = await seedFinishedGame();
    await requestRematch(store, roomId, p1Token, 1);
    const reconnected = await getRoomView(store, roomId, p2Token);
    expect(reconnected.ok).toBe(true);
    if (!reconnected.ok) return;
    expect(reconnected.value.rematch.opponentRequested).toBe(true);
  });

  it("never leaks token hashes or face-down symbols through the rematch view", async () => {
    const { store, roomId, p1Token, p2Token } = await seedFinishedGame();
    await requestRematch(store, roomId, p1Token, 1);
    const r = await requestRematch(store, roomId, p2Token, 1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const serialized = JSON.stringify(r.value);
    expect(serialized).not.toContain("TokenHash");
    // No face-down symbol leaks: every card value is null in the fresh round.
    expect(r.value.cards.every((c) => c.value === null)).toBe(true);
  });
});
