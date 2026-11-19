import { describe, it, expect, beforeEach } from "vitest";
import { createMemoryStore, __resetMemoryStore } from "@/lib/store/memory";
import {
  createRoom,
  joinRoom,
  playMove,
  getRoomView,
  requestRematch,
  toPublicRoomState,
  ROOM_TTL_SECONDS,
  SHOGI_ROOM_PREFIX,
  type RoomStore,
} from "./roomService";
import { generateRoomId, generateToken, hashToken } from "@/lib/tokens";
import { initialRematch } from "@/lib/rematch";
import {
  createEmptyBoard,
  createInitialPosition,
  getAllLegalMoves,
  type Piece,
  type PieceType,
  type Player,
} from "./engine";
import type { RoomState } from "../types";

function freshStore(): RoomStore {
  __resetMemoryStore();
  return createMemoryStore<RoomState>(SHOGI_ROOM_PREFIX);
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
    senteToken: created.value.token,
    goteToken: joined.value.token,
  };
}

type PieceSpec = [number, number, PieceType, Player, boolean?];

/** Seeds a started, in-progress game with an arbitrary board + hands. */
async function seedGame(opts: {
  pieces: PieceSpec[];
  activeColor: Player;
  hands?: RoomState["position"]["hands"];
}) {
  const store = freshStore();
  const roomId = generateRoomId();
  const senteToken = generateToken();
  const goteToken = generateToken();

  const board = createEmptyBoard();
  for (const [r, c, type, owner, promoted] of opts.pieces) {
    board[r][c] = { type, owner, promoted: promoted ?? false } as Piece;
  }

  const ts = Date.now();
  const state: RoomState = {
    roomId,
    position: {
      board,
      hands: opts.hands ?? { sente: {}, gote: {} },
      activeColor: opts.activeColor,
    },
    currentTurn: opts.activeColor,
    status: "playing",
    winner: null,
    lastMove: null,
    check: false,
    senteTokenHash: hashToken(senteToken),
    goteTokenHash: hashToken(goteToken),
    rematch: initialRematch(),
    version: 2,
    createdAt: ts,
    updatedAt: ts,
  };
  await store.create(roomId, state, ROOM_TTL_SECONDS);
  return { store, roomId, senteToken, goteToken };
}

beforeEach(() => {
  __resetMemoryStore();
});

describe("createRoom", () => {
  it("creates a waiting room with the creator as Sente", async () => {
    const store = freshStore();
    const result = await createRoom(store);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.roomId).toMatch(/^[a-z0-9]{12}$/);
    expect(result.value.publicState.status).toBe("waiting");
    expect(result.value.publicState.yourRole).toBe("sente");
    expect(result.value.publicState.currentTurn).toBe("sente");
    expect(result.value.publicState.seats).toEqual({ sente: true, gote: false });
    // The full position (board + both hands) is present and public.
    expect(result.value.publicState.position.activeColor).toBe("sente");
    expect(result.value.publicState.position.board).toHaveLength(9);
    expect(result.value.publicState.position.hands).toEqual({ sente: {}, gote: {} });
    // Standard start: Sente king on row 8, Gote king on row 0.
    expect(result.value.publicState.position.board[8][4]).toEqual({
      type: "OU",
      owner: "sente",
      promoted: false,
    });
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

describe("joinRoom", () => {
  it("assigns Gote and starts the game", async () => {
    const store = freshStore();
    const created = await createRoom(store);
    if (!created.ok) throw new Error();

    const joined = await joinRoom(store, created.value.roomId, null);
    expect(joined.ok).toBe(true);
    if (!joined.ok) return;
    expect(joined.value.token).toBeTruthy();
    expect(joined.value.publicState.status).toBe("playing");
    expect(joined.value.publicState.yourRole).toBe("gote");
    expect(joined.value.publicState.currentTurn).toBe("sente");
    expect(joined.value.publicState.seats).toEqual({ sente: true, gote: true });
  });

  it("rejects a third player as room_full", async () => {
    const { store, roomId } = await startedGame();
    const third = await joinRoom(store, roomId, null);
    expect(third.ok).toBe(false);
    if (!third.ok) expect(third.error.code).toBe("room_full");
  });

  it("treats an existing player's token as a reconnect (no new token)", async () => {
    const { store, roomId, goteToken } = await startedGame();
    const rejoin = await joinRoom(store, roomId, goteToken);
    expect(rejoin.ok).toBe(true);
    if (!rejoin.ok) return;
    expect(rejoin.value.token).toBeUndefined();
    expect(rejoin.value.publicState.yourRole).toBe("gote");
  });

  it("only one of two simultaneous joiners gets the Gote seat", async () => {
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

describe("playMove — authorization & rules", () => {
  it("rejects a non-player token", async () => {
    const { store, roomId } = await startedGame();
    const result = await playMove(store, roomId, "bogus-token", {
      from: { row: 6, col: 6 },
      to: { row: 5, col: 6 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("not_a_player");
  });

  it("rejects moving out of turn", async () => {
    const { store, roomId, goteToken } = await startedGame();
    // Gote tries to move first — it's Sente's turn.
    const result = await playMove(store, roomId, goteToken, {
      from: { row: 2, col: 2 },
      to: { row: 3, col: 2 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("not_your_turn");
      expect(result.error.publicState?.currentTurn).toBe("sente");
    }
  });

  it("rejects an illegal move", async () => {
    const { store, roomId, senteToken } = await startedGame();
    // Bishop at (7,1) cannot leap to (5,1).
    const result = await playMove(store, roomId, senteToken, {
      from: { row: 7, col: 1 },
      to: { row: 5, col: 1 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("illegal_move");
  });

  it("rejects out-of-range coordinates as invalid_request", async () => {
    const { store, roomId, senteToken } = await startedGame();
    const result = await playMove(store, roomId, senteToken, {
      from: { row: 9, col: 0 },
      to: { row: 5, col: 0 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_request");
  });

  it("rejects an unknown drop type as invalid_request", async () => {
    const { store, roomId, senteToken } = await startedGame();
    const result = await playMove(store, roomId, senteToken, {
      drop: "XX",
      to: { row: 4, col: 4 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_request");
  });

  it("applies a legal pawn push, passes the turn, and bumps the version", async () => {
    const { store, roomId, senteToken } = await startedGame();
    const result = await playMove(store, roomId, senteToken, {
      from: { row: 6, col: 6 },
      to: { row: 5, col: 6 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.currentTurn).toBe("gote");
    expect(result.value.lastMove).toEqual({
      from: { row: 6, col: 6 },
      to: { row: 5, col: 6 },
      promote: false,
    });
    expect(result.value.position.board[5][6]).toEqual({
      type: "FU",
      owner: "sente",
      promoted: false,
    });
    expect(result.value.position.board[6][6]).toBeNull();
    expect(result.value.check).toBe(false);
    expect(result.value.version).toBe(3); // 1 create, 2 join, 3 move
  });

  it("refuses moves before the second player joins", async () => {
    const store = freshStore();
    const created = await createRoom(store);
    if (!created.ok) throw new Error();
    const result = await playMove(store, created.value.roomId, created.value.token, {
      from: { row: 6, col: 6 },
      to: { row: 5, col: 6 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("game_not_active");
  });
});

describe("playMove — drops", () => {
  it("applies a drop from the hand and passes the turn", async () => {
    const { store, roomId, senteToken } = await seedGame({
      pieces: [
        [8, 4, "OU", "sente"],
        [0, 4, "OU", "gote"],
      ],
      activeColor: "sente",
      hands: { sente: { FU: 1 }, gote: {} },
    });

    const result = await playMove(store, roomId, senteToken, {
      drop: "FU",
      to: { row: 4, col: 4 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.position.board[4][4]).toEqual({
      type: "FU",
      owner: "sente",
      promoted: false,
    });
    expect(result.value.position.hands.sente.FU ?? 0).toBe(0);
    expect(result.value.currentTurn).toBe("gote");
    expect(result.value.lastMove).toEqual({ to: { row: 4, col: 4 }, drop: "FU" });
    expect(result.value.version).toBe(3);
  });

  it("rejects a drop that violates 二歩", async () => {
    const { store, roomId, senteToken } = await seedGame({
      pieces: [
        [8, 4, "OU", "sente"],
        [0, 4, "OU", "gote"],
        [6, 2, "FU", "sente"], // already a Sente pawn in file 2
      ],
      activeColor: "sente",
      hands: { sente: { FU: 1 }, gote: {} },
    });
    const result = await playMove(store, roomId, senteToken, {
      drop: "FU",
      to: { row: 4, col: 2 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("illegal_move");
  });
});

describe("playMove — checkmate via the service", () => {
  it("drives a head-gold mate to a Sente win and refuses further moves", async () => {
    // Sente gold on (2,5) will drop into (1,4): 頭金, defended by the silver.
    const { store, roomId, senteToken, goteToken } = await seedGame({
      pieces: [
        [0, 4, "OU", "gote"],
        [2, 4, "GI", "sente"], // defends the mating square
        [2, 5, "KI", "sente"], // the gold that delivers mate
        [8, 4, "OU", "sente"],
      ],
      activeColor: "sente",
    });

    const r = await playMove(store, roomId, senteToken, {
      from: { row: 2, col: 5 },
      to: { row: 1, col: 4 },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.status).toBe("finished");
    expect(r.value.winner).toBe("sente");
    expect(r.value.check).toBe(true);
    expect(r.value.currentTurn).toBe("gote");

    // Any further move is refused as the game is over.
    const after = await playMove(store, roomId, goteToken, {
      from: { row: 0, col: 4 },
      to: { row: 0, col: 3 },
    });
    expect(after.ok).toBe(false);
    if (!after.ok) expect(after.error.code).toBe("game_over");
  });
});

describe("playMove — concurrency", () => {
  it("double-tapping the same move only applies it once", async () => {
    const { store, roomId, senteToken } = await startedGame();
    const payload = { from: { row: 6, col: 6 }, to: { row: 5, col: 6 } };
    const [a, b] = await Promise.all([
      playMove(store, roomId, senteToken, payload),
      playMove(store, roomId, senteToken, payload),
    ]);
    const oks = [a, b].filter((r) => r.ok);
    const errs = [a, b].filter((r) => !r.ok);
    expect(oks).toHaveLength(1);
    expect(errs).toHaveLength(1);

    const view = await getRoomView(store, roomId, senteToken);
    expect(view.ok && view.value.version).toBe(3);
  });
});

describe("toPublicRoomState", () => {
  it("omits token hashes and reports seats + role", async () => {
    const { store, roomId, senteToken } = await startedGame();
    const state = await store.get(roomId);
    if (!state) throw new Error();
    const pub = toPublicRoomState(state, hashToken(senteToken));
    expect(pub.yourRole).toBe("sente");
    expect(pub.seats).toEqual({ sente: true, gote: true });
    expect(JSON.stringify(pub)).not.toContain(state.senteTokenHash);
    expect(JSON.stringify(pub)).not.toContain("TokenHash");
  });
});

// ---------------------------------------------------------------------------
// Rematch (same room, same players)
// ---------------------------------------------------------------------------

/** Seeds a FINISHED shogi game directly (sente won) with both tokens. */
async function seedFinishedGame() {
  const store = freshStore();
  const roomId = generateRoomId();
  const senteToken = generateToken();
  const goteToken = generateToken();
  const ts = Date.now();
  const state: RoomState = {
    roomId,
    // Seed non-empty hands (captured pieces) so the rematch reset is proven to
    // CLEAR them, not merely to leave an already-empty position untouched.
    position: {
      ...createInitialPosition(),
      hands: { sente: { FU: 2, KA: 1 }, gote: { GI: 1 } },
    },
    currentTurn: "sente",
    status: "finished",
    winner: "sente",
    lastMove: null,
    check: false,
    senteTokenHash: hashToken(senteToken),
    goteTokenHash: hashToken(goteToken),
    rematch: initialRematch(),
    version: 5,
    createdAt: ts,
    updatedAt: ts,
  };
  await store.create(roomId, state, ROOM_TTL_SECONDS);
  return { store, roomId, senteToken, goteToken };
}

/** Forces the current round to a finished state (isolated test helper). */
async function forceFinish(store: RoomStore, roomId: string) {
  const s = await store.get(roomId);
  if (!s) throw new Error("forceFinish: no room");
  const cas = await store.compareAndSwap(
    roomId,
    s.version,
    { ...s, status: "finished", winner: "sente", version: s.version + 1 },
    ROOM_TTL_SECONDS,
  );
  if (cas !== "ok") throw new Error("forceFinish: cas " + cas);
}

describe("requestRematch", () => {
  it("one-sided request does NOT start a new game", async () => {
    const { store, roomId, senteToken, goteToken } = await seedFinishedGame();
    const r = await requestRematch(store, roomId, senteToken, 1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.status).toBe("finished");
    expect(r.value.roundId).toBe(1);
    expect(r.value.rematch.youRequested).toBe(true);
    const g = await getRoomView(store, roomId, goteToken);
    expect(g.ok && g.value.rematch.opponentRequested).toBe(true);
  });

  it("both requests reset the 9x9 board + empty hands, swap seats, sente opens", async () => {
    const { store, roomId, senteToken, goteToken } = await seedFinishedGame();
    await requestRematch(store, roomId, senteToken, 1);
    const second = await requestRematch(store, roomId, goteToken, 1);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.status).toBe("playing");
    expect(second.value.roundId).toBe(2);
    expect(second.value.winner).toBeNull();
    expect(second.value.check).toBe(false);
    expect(second.value.lastMove).toBeNull();
    expect(second.value.currentTurn).toBe("sente");
    // Full position reset: initial board + BOTH hands empty.
    expect(second.value.position).toEqual(createInitialPosition());
    expect(second.value.position.hands).toEqual({ sente: {}, gote: {} });
    expect(second.value.rematch.youRequested).toBe(false);
    // Seats swapped: the previous Gote now plays Sente (opens).
    const senteView = await getRoomView(store, roomId, senteToken);
    const goteView = await getRoomView(store, roomId, goteToken);
    expect(senteView.ok && senteView.value.yourRole).toBe("gote");
    expect(goteView.ok && goteView.value.yourRole).toBe("sente");
  });

  it("is idempotent: repeat votes keep a single pending request", async () => {
    const { store, roomId, senteToken } = await seedFinishedGame();
    const first = await requestRematch(store, roomId, senteToken, 1);
    const again = await requestRematch(store, roomId, senteToken, 1);
    if (!first.ok || !again.ok) throw new Error("vote failed");
    expect(again.value.version).toBe(first.value.version);
  });

  it("concurrent requests start exactly one new round", async () => {
    const { store, roomId, senteToken, goteToken } = await seedFinishedGame();
    await Promise.all([
      requestRematch(store, roomId, senteToken, 1),
      requestRematch(store, roomId, goteToken, 1),
    ]);
    const view = await getRoomView(store, roomId, senteToken);
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
    const { store, roomId, senteToken } = await startedGame();
    const r = await requestRematch(store, roomId, senteToken, 1);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("rematch_unavailable");
  });

  it("rejects a stale roundId", async () => {
    const { store, roomId, senteToken } = await seedFinishedGame();
    const r = await requestRematch(store, roomId, senteToken, 77);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("stale_round");
  });

  it("allows a legal move in the new round (sente = the swapped player)", async () => {
    const { store, roomId, senteToken, goteToken } = await seedFinishedGame();
    await requestRematch(store, roomId, senteToken, 1);
    const started = await requestRematch(store, roomId, goteToken, 1);
    if (!started.ok) throw new Error();
    // goteToken now plays Sente (opens). Pick a real legal move for sente.
    const legal = getAllLegalMoves(started.value.position, "sente");
    expect(legal.length).toBeGreaterThan(0);
    const m = legal[0];
    const moved = await playMove(
      store,
      roomId,
      goteToken,
      { from: m.from, to: m.to, promote: m.promote === true },
      2,
    );
    expect(moved.ok).toBe(true);
  });

  it("rejects an old-round move after a rematch (stale operation)", async () => {
    const { store, roomId, senteToken, goteToken } = await seedFinishedGame();
    await requestRematch(store, roomId, senteToken, 1);
    const started = await requestRematch(store, roomId, goteToken, 1);
    if (!started.ok) throw new Error();
    const m = getAllLegalMoves(started.value.position, "sente")[0];
    const stale = await playMove(
      store,
      roomId,
      goteToken,
      { from: m.from, to: m.to, promote: m.promote === true },
      1, // old round id
    );
    expect(stale.ok).toBe(false);
    if (stale.ok) return;
    expect(stale.error.code).toBe("stale_round");
    expect(stale.error.publicState?.roundId).toBe(2);
  });

  it("survives three consecutive rematches, alternating the opening seat", async () => {
    const { store, roomId, senteToken, goteToken } = await seedFinishedGame();
    for (const expectedRound of [2, 3, 4]) {
      await requestRematch(store, roomId, senteToken, expectedRound - 1);
      const done = await requestRematch(store, roomId, goteToken, expectedRound - 1);
      expect(done.ok && done.value.roundId).toBe(expectedRound);
      await forceFinish(store, roomId);
    }
    const view = await getRoomView(store, roomId, senteToken);
    expect(view.ok && view.value.roundId).toBe(4);
    expect(view.ok && view.value.yourRole).toBe("gote"); // 3 swaps
  });

  it("reconnect (getRoomView) restores the pending rematch state", async () => {
    const { store, roomId, senteToken, goteToken } = await seedFinishedGame();
    await requestRematch(store, roomId, senteToken, 1);
    const reconnected = await getRoomView(store, roomId, goteToken);
    expect(reconnected.ok).toBe(true);
    if (!reconnected.ok) return;
    expect(reconnected.value.rematch.opponentRequested).toBe(true);
  });

  it("never leaks token hashes through the rematch view", async () => {
    const { store, roomId, senteToken } = await seedFinishedGame();
    const r = await requestRematch(store, roomId, senteToken, 1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(JSON.stringify(r.value)).not.toContain("TokenHash");
  });
});
