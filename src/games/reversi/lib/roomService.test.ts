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
  REVERSI_ROOM_PREFIX,
} from "./roomService";
import { hashToken } from "@/lib/tokens";
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
