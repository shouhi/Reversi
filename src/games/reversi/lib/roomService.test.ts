import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createMemoryStore, __resetMemoryStore } from "@/lib/store/memory";
import {
  getStore,
  StoreNotConfiguredError,
  __resetStoreCache,
} from "@/lib/store";
import {
  createRoom,
  joinRoom,
  playMove,
  getRoomView,
  requestRematch,
  REVERSI_ROOM_PREFIX,
} from "./roomService";
import { hashToken } from "@/lib/tokens";
import { initialRematch } from "@/lib/rematch";
import { createInitialBoard, getValidMoves } from "./engine";
import type { RoomState } from "../types";
import type { Board, Player } from "./engine";

function freshStore() {
  __resetMemoryStore();
  return createMemoryStore<RoomState>(REVERSI_ROOM_PREFIX);
}

/** Sets up a started game and returns the store plus both players' tokens. */
async function startedGame() {
  const store = freshStore();
  const created = await createRoom(store);
  if (!created.ok) throw new Error("create failed");
  const joined = await joinRoom(store, created.value.roomId, null);
  if (!joined.ok || !joined.value.token) throw new Error("join failed");
  return {
    store,
    roomId: created.value.roomId,
    blackToken: created.value.token,
    whiteToken: joined.value.token,
  };
}

beforeEach(() => {
  __resetMemoryStore();
});

describe("createRoom", () => {
  it("creates a waiting room with the creator as black", async () => {
    const store = freshStore();
    const result = await createRoom(store);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.roomId).toMatch(/^[a-z0-9]{12}$/);
    expect(result.value.token).toBeTruthy();
    expect(result.value.publicState.status).toBe("waiting");
    expect(result.value.publicState.yourRole).toBe("black");
    expect(result.value.publicState.seats).toEqual({
      black: true,
      white: false,
    });
    expect(result.value.publicState.scores).toEqual({ black: 2, white: 2 });
  });

  it("never leaks token hashes in the public state", async () => {
    const store = freshStore();
    const result = await createRoom(store);
    if (!result.ok) throw new Error();
    const serialized = JSON.stringify(result.value.publicState);
    expect(serialized).not.toContain("TokenHash");
    expect(serialized).not.toContain(hashToken(result.value.token));
  });
});

describe("getRoomView", () => {
  it("reports the caller's role from their token", async () => {
    const store = freshStore();
    const created = await createRoom(store);
    if (!created.ok) throw new Error();
    const { roomId, token } = created.value;

    const asBlack = await getRoomView(store, roomId, token);
    expect(asBlack.ok && asBlack.value.yourRole).toBe("black");

    const asAnon = await getRoomView(store, roomId, null);
    expect(asAnon.ok && asAnon.value.yourRole).toBe(null);
  });

  it("returns not_found for unknown rooms", async () => {
    const store = freshStore();
    const result = await getRoomView(store, "doesnotexist1", null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("not_found");
  });
});

describe("joinRoom", () => {
  it("assigns white and starts the game", async () => {
    const store = freshStore();
    const created = await createRoom(store);
    if (!created.ok) throw new Error();

    const joined = await joinRoom(store, created.value.roomId, null);
    expect(joined.ok).toBe(true);
    if (!joined.ok) return;
    expect(joined.value.token).toBeTruthy();
    expect(joined.value.publicState.status).toBe("playing");
    expect(joined.value.publicState.yourRole).toBe("white");
    expect(joined.value.publicState.currentTurn).toBe("black");
    expect(joined.value.publicState.seats).toEqual({
      black: true,
      white: true,
    });
  });

  it("rejects a third player as room_full", async () => {
    const { store, roomId } = await startedGame();
    const third = await joinRoom(store, roomId, null);
    expect(third.ok).toBe(false);
    if (!third.ok) expect(third.error.code).toBe("room_full");
  });

  it("treats an existing player's token as a reconnect (no new token)", async () => {
    const { store, roomId, whiteToken } = await startedGame();
    const rejoin = await joinRoom(store, roomId, whiteToken);
    expect(rejoin.ok).toBe(true);
    if (!rejoin.ok) return;
    expect(rejoin.value.token).toBeUndefined();
    expect(rejoin.value.publicState.yourRole).toBe("white");
  });

  it("only one of two simultaneous joiners gets the white seat", async () => {
    const store = freshStore();
    const created = await createRoom(store);
    if (!created.ok) throw new Error();
    const roomId = created.value.roomId;

    const [a, b] = await Promise.all([
      joinRoom(store, roomId, null),
      joinRoom(store, roomId, null),
    ]);

    const successes = [a, b].filter(
      (r) => r.ok && r.value.token,
    );
    const failures = [a, b].filter((r) => !r.ok);
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    if (!failures[0].ok) expect(failures[0].error.code).toBe("room_full");
  });
});

describe("playMove — authorization & rules", () => {
  it("rejects a non-player token", async () => {
    const { store, roomId } = await startedGame();
    const result = await playMove(store, roomId, "bogus-token", 2, 3);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("not_a_player");
  });

  it("rejects moving out of turn", async () => {
    const { store, roomId, whiteToken } = await startedGame();
    // White tries to move first — it's black's turn.
    const result = await playMove(store, roomId, whiteToken, 2, 4);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("not_your_turn");
      expect(result.error.publicState?.currentTurn).toBe("black");
    }
  });

  it("rejects an illegal move", async () => {
    const { store, roomId, blackToken } = await startedGame();
    const result = await playMove(store, roomId, blackToken, 0, 0);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("illegal_move");
  });

  it("applies a legal move, flips pieces and passes the turn", async () => {
    const { store, roomId, blackToken } = await startedGame();
    const result = await playMove(store, roomId, blackToken, 2, 3);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.currentTurn).toBe("white");
    expect(result.value.lastMove).toEqual({ row: 2, col: 3 });
    expect(result.value.scores).toEqual({ black: 4, white: 1 });
    expect(result.value.version).toBe(3); // 1 create, 2 join, 3 move
  });

  it("refuses moves before the second player joins", async () => {
    const store = freshStore();
    const created = await createRoom(store);
    if (!created.ok) throw new Error();
    const result = await playMove(
      store,
      created.value.roomId,
      created.value.token,
      2,
      3,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("game_not_active");
  });
});

describe("playMove — double operation & concurrency", () => {
  it("double-tapping the same move only applies it once", async () => {
    const { store, roomId, blackToken } = await startedGame();
    // Fire the identical move twice without awaiting between them.
    const [a, b] = await Promise.all([
      playMove(store, roomId, blackToken, 2, 3),
      playMove(store, roomId, blackToken, 2, 3),
    ]);

    const oks = [a, b].filter((r) => r.ok);
    const errs = [a, b].filter((r) => !r.ok);
    expect(oks).toHaveLength(1);
    expect(errs).toHaveLength(1);
    // The loser is rejected safely (turn already advanced), not applied twice.
    if (!errs[0].ok) {
      expect(["not_your_turn", "illegal_move"]).toContain(errs[0].error.code);
    }

    // State advanced by exactly one move.
    const view = await getRoomView(store, roomId, blackToken);
    expect(view.ok && view.value.version).toBe(3);
    expect(view.ok && view.value.scores).toEqual({ black: 4, white: 1 });
  });
});

describe("playMove — game end", () => {
  /** Builds a board that is one black move away from a full, finished board. */
  function nearlyFullBoard(): Board {
    const board: Board = Array.from({ length: 8 }, () =>
      Array.from({ length: 8 }, () => "black" as Player | null),
    );
    board[0][0] = null; // the one empty cell
    board[0][1] = "white"; // flanked by black at (0,2) when black plays (0,0)
    return board;
  }

  it("marks the game finished and sets the winner on the last move", async () => {
    const store = freshStore();
    const blackToken = "black-secret";
    const whiteToken = "white-secret";
    const seeded: RoomState = {
      roomId: "endgamexxxxx",
      board: nearlyFullBoard(),
      currentTurn: "black",
      status: "playing",
      winner: null,
      blackTokenHash: hashToken(blackToken),
      whiteTokenHash: hashToken(whiteToken),
      lastMove: null,
      rematch: initialRematch(),
      version: 5,
      createdAt: 1,
      updatedAt: 1,
    };
    expect(await store.create(seeded.roomId, seeded, 3600)).toBe(true);

    const result = await playMove(store, seeded.roomId, blackToken, 0, 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("finished");
    expect(result.value.winner).toBe("black");
    expect(result.value.scores).toEqual({ black: 64, white: 0 });

    // Any further move is refused.
    const after = await playMove(store, seeded.roomId, whiteToken, 1, 1);
    expect(after.ok).toBe(false);
    if (!after.ok) expect(after.error.code).toBe("game_over");
  });
});

describe("getStore — store selection", () => {
  beforeEach(() => {
    __resetStoreCache();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    __resetStoreCache();
  });

  it("throws when unconfigured and not opted in", () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    vi.stubEnv("KV_REST_API_URL", "");
    vi.stubEnv("KV_REST_API_TOKEN", "");
    vi.stubEnv("REVERSI_MEMORY_STORE", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(() => getStore(REVERSI_ROOM_PREFIX)).toThrow(StoreNotConfiguredError);
  });

  it("accepts the Vercel Upstash KV_* env var names", () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    vi.stubEnv("KV_REST_API_URL", "https://example.upstash.io");
    vi.stubEnv("KV_REST_API_TOKEN", "example-token");
    expect(getStore(REVERSI_ROOM_PREFIX).kind).toBe("redis");
  });

  it("prefers Redis when credentials are present", () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://example.upstash.io");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "example-token");
    expect(getStore(REVERSI_ROOM_PREFIX).kind).toBe("redis");
  });

  it("uses memory only when explicitly opted in", () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    vi.stubEnv("KV_REST_API_URL", "");
    vi.stubEnv("KV_REST_API_TOKEN", "");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("REVERSI_MEMORY_STORE", "1");
    expect(getStore(REVERSI_ROOM_PREFIX).kind).toBe("memory");
  });
});

// ---------------------------------------------------------------------------
// Rematch (same room, same players)
// ---------------------------------------------------------------------------

/**
 * Seeds a FINISHED reversi game directly (a real game is long; the spec allows
 * isolated test data for reversi). Returns the store, room id, and both tokens.
 */
async function seedFinishedGame() {
  const store = freshStore();
  const roomId = "rematchtest1";
  const blackToken = "black-secret";
  const whiteToken = "white-secret";
  const state: RoomState = {
    roomId,
    board: createInitialBoard(),
    currentTurn: "black",
    status: "finished",
    winner: "black",
    blackTokenHash: hashToken(blackToken),
    whiteTokenHash: hashToken(whiteToken),
    lastMove: null,
    rematch: initialRematch(),
    version: 10,
    createdAt: 1,
    updatedAt: 1,
  };
  if (!(await store.create(roomId, state, 3600))) throw new Error("seed failed");
  return { store, roomId, blackToken, whiteToken };
}

/** Forces the current round to a finished state (isolated test helper). */
async function forceFinish(store: ReturnType<typeof freshStore>, roomId: string) {
  const s = await store.get(roomId);
  if (!s) throw new Error("forceFinish: no room");
  const cas = await store.compareAndSwap(
    roomId,
    s.version,
    { ...s, status: "finished", winner: "black", version: s.version + 1 },
    3600,
  );
  if (cas !== "ok") throw new Error("forceFinish: cas " + cas);
}

describe("requestRematch", () => {
  it("one-sided request does NOT start a new game", async () => {
    const { store, roomId, blackToken, whiteToken } = await seedFinishedGame();
    const r = await requestRematch(store, roomId, blackToken, 1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.status).toBe("finished");
    expect(r.value.roundId).toBe(1);
    expect(r.value.rematch.youRequested).toBe(true);
    expect(r.value.rematch.opponentRequested).toBe(false);

    const wView = await getRoomView(store, roomId, whiteToken);
    expect(wView.ok && wView.value.rematch.opponentRequested).toBe(true);
    expect(wView.ok && wView.value.status).toBe("finished");
  });

  it("works the same when only white requests first", async () => {
    const { store, roomId, whiteToken } = await seedFinishedGame();
    const r = await requestRematch(store, roomId, whiteToken, 1);
    expect(r.ok && r.value.status).toBe("finished");
    expect(r.ok && r.value.rematch.youRequested).toBe(true);
  });

  it("both requests start a new round, reset to the initial board, swap seats", async () => {
    const { store, roomId, blackToken, whiteToken } = await seedFinishedGame();
    await requestRematch(store, roomId, blackToken, 1);
    const second = await requestRematch(store, roomId, whiteToken, 1);
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.value.status).toBe("playing");
    expect(second.value.roundId).toBe(2);
    expect(second.value.winner).toBeNull();
    expect(second.value.lastMove).toBeNull();
    expect(second.value.currentTurn).toBe("black");
    // board reset to the canonical opening (2 black, 2 white)
    expect(second.value.scores).toEqual({ black: 2, white: 2 });
    expect(second.value.board).toEqual(createInitialBoard());
    expect(second.value.rematch.youRequested).toBe(false);

    // Seat swap: the previous white is now black (opens).
    const blackView = await getRoomView(store, roomId, blackToken);
    const whiteView = await getRoomView(store, roomId, whiteToken);
    expect(blackView.ok && blackView.value.yourRole).toBe("white");
    expect(whiteView.ok && whiteView.value.yourRole).toBe("black");
  });

  it("is idempotent: repeat votes keep a single pending request", async () => {
    const { store, roomId, blackToken } = await seedFinishedGame();
    const first = await requestRematch(store, roomId, blackToken, 1);
    const again = await requestRematch(store, roomId, blackToken, 1);
    expect(first.ok && again.ok).toBe(true);
    if (!first.ok || !again.ok) return;
    expect(again.value.status).toBe("finished");
    expect(again.value.version).toBe(first.value.version); // no extra churn
  });

  it("concurrent requests from both players start exactly one new round", async () => {
    const { store, roomId, blackToken, whiteToken } = await seedFinishedGame();
    await Promise.all([
      requestRematch(store, roomId, blackToken, 1),
      requestRematch(store, roomId, whiteToken, 1),
    ]);
    const view = await getRoomView(store, roomId, blackToken);
    expect(view.ok).toBe(true);
    if (!view.ok) return;
    expect(view.value.status).toBe("playing");
    expect(view.value.roundId).toBe(2);
    expect(view.value.rematch.youRequested).toBe(false);
  });

  it("rejects a non-player token", async () => {
    const { store, roomId } = await seedFinishedGame();
    const r = await requestRematch(store, roomId, "outsider", 1);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("not_a_player");
  });

  it("rejects a rematch for a game still in progress", async () => {
    const store = freshStore();
    const created = await createRoom(store);
    if (!created.ok) throw new Error();
    const joined = await joinRoom(store, created.value.roomId, null);
    if (!joined.ok) throw new Error();
    const r = await requestRematch(store, created.value.roomId, created.value.token, 1);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("rematch_unavailable");
  });

  it("rejects a stale roundId", async () => {
    const { store, roomId, blackToken } = await seedFinishedGame();
    const r = await requestRematch(store, roomId, blackToken, 99);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("stale_round");
  });

  it("allows a legal move in the new round", async () => {
    const { store, roomId, blackToken, whiteToken } = await seedFinishedGame();
    await requestRematch(store, roomId, blackToken, 1);
    const started = await requestRematch(store, roomId, whiteToken, 1);
    if (!started.ok) throw new Error();
    // Seats swapped → whiteToken now plays black (opens). Pick a real legal move.
    const [r, c] = getValidMoves(started.value.board, "black")[0];
    const moved = await playMove(store, roomId, whiteToken, r, c, 2);
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(moved.value.lastMove).toEqual({ row: r, col: c });
  });

  it("rejects an old-round move after a rematch (stale operation)", async () => {
    const { store, roomId, blackToken, whiteToken } = await seedFinishedGame();
    await requestRematch(store, roomId, blackToken, 1);
    await requestRematch(store, roomId, whiteToken, 1);
    const stale = await playMove(store, roomId, whiteToken, 2, 3, 1); // old round id
    expect(stale.ok).toBe(false);
    if (stale.ok) return;
    expect(stale.error.code).toBe("stale_round");
    expect(stale.error.publicState?.roundId).toBe(2);
  });

  it("survives three consecutive rematches, alternating the opening seat", async () => {
    const { store, roomId, blackToken, whiteToken } = await seedFinishedGame();
    for (const expectedRound of [2, 3, 4]) {
      const prevRound = expectedRound - 1;
      await requestRematch(store, roomId, blackToken, prevRound);
      const done = await requestRematch(store, roomId, whiteToken, prevRound);
      expect(done.ok && done.value.roundId).toBe(expectedRound);
      expect(done.ok && done.value.status).toBe("playing");
      await forceFinish(store, roomId); // isolated: pretend they played it out
    }
    // Seats alternate each rematch: after 3 swaps, black's token holds white.
    const view = await getRoomView(store, roomId, blackToken);
    expect(view.ok && view.value.roundId).toBe(4);
    expect(view.ok && view.value.yourRole).toBe("white");
  });

  it("reconnect (getRoomView) restores the pending rematch state", async () => {
    const { store, roomId, blackToken, whiteToken } = await seedFinishedGame();
    await requestRematch(store, roomId, blackToken, 1);
    const reconnected = await getRoomView(store, roomId, whiteToken);
    expect(reconnected.ok).toBe(true);
    if (!reconnected.ok) return;
    expect(reconnected.value.roundId).toBe(1);
    expect(reconnected.value.rematch.opponentRequested).toBe(true);
    expect(reconnected.value.rematch.youRequested).toBe(false);
  });

  it("never leaks token hashes through the rematch view", async () => {
    const { store, roomId, blackToken } = await seedFinishedGame();
    const r = await requestRematch(store, roomId, blackToken, 1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(JSON.stringify(r.value)).not.toContain("TokenHash");
  });
});
