import { describe, it, expect, beforeEach } from "vitest";
import { createMemoryStore, __resetMemoryStore } from "@/lib/store/memory";
import {
  createRoom,
  joinRoom,
  playMove,
  getRoomView,
  requestRematch,
  CHESS_ROOM_PREFIX,
} from "./roomService";
import { hashToken } from "@/lib/tokens";
import { createInitialPosition, getLegalMoves } from "./engine";
import type { RoomState } from "../types";
import type { Coord } from "./engine";

function freshStore() {
  __resetMemoryStore();
  return createMemoryStore<RoomState>(CHESS_ROOM_PREFIX);
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
    whiteToken: created.value.token,
    blackToken: joined.value.token,
  };
}

const sq = (row: number, col: number): Coord => ({ row, col });

beforeEach(() => {
  __resetMemoryStore();
});

describe("createRoom", () => {
  it("creates a waiting room with the creator as White", async () => {
    const store = freshStore();
    const result = await createRoom(store);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.roomId).toMatch(/^[a-z0-9]{12}$/);
    expect(result.value.publicState.status).toBe("waiting");
    expect(result.value.publicState.yourRole).toBe("white");
    expect(result.value.publicState.currentTurn).toBe("white");
    expect(result.value.publicState.seats).toEqual({ white: true, black: false });
    // The full position is present and public.
    expect(result.value.publicState.position.activeColor).toBe("white");
    expect(result.value.publicState.position.board).toHaveLength(8);
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
  it("assigns Black and starts the game", async () => {
    const store = freshStore();
    const created = await createRoom(store);
    if (!created.ok) throw new Error();

    const joined = await joinRoom(store, created.value.roomId, null);
    expect(joined.ok).toBe(true);
    if (!joined.ok) return;
    expect(joined.value.token).toBeTruthy();
    expect(joined.value.publicState.status).toBe("playing");
    expect(joined.value.publicState.yourRole).toBe("black");
    expect(joined.value.publicState.currentTurn).toBe("white");
    expect(joined.value.publicState.seats).toEqual({ white: true, black: true });
  });

  it("rejects a third player as room_full", async () => {
    const { store, roomId } = await startedGame();
    const third = await joinRoom(store, roomId, null);
    expect(third.ok).toBe(false);
    if (!third.ok) expect(third.error.code).toBe("room_full");
  });

  it("treats an existing player's token as a reconnect (no new token)", async () => {
    const { store, roomId, blackToken } = await startedGame();
    const rejoin = await joinRoom(store, roomId, blackToken);
    expect(rejoin.ok).toBe(true);
    if (!rejoin.ok) return;
    expect(rejoin.value.token).toBeUndefined();
    expect(rejoin.value.publicState.yourRole).toBe("black");
  });

  it("only one of two simultaneous joiners gets the Black seat", async () => {
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
    const result = await playMove(store, roomId, "bogus-token", sq(6, 4), sq(4, 4));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("not_a_player");
  });

  it("rejects moving out of turn", async () => {
    const { store, roomId, blackToken } = await startedGame();
    // Black tries to move first — it's White's turn.
    const result = await playMove(store, roomId, blackToken, sq(1, 4), sq(3, 4));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("not_your_turn");
      expect(result.error.publicState?.currentTurn).toBe("white");
    }
  });

  it("rejects an illegal move", async () => {
    const { store, roomId, whiteToken } = await startedGame();
    // Knight b1 (7,1) cannot jump to b3 (5,1).
    const result = await playMove(store, roomId, whiteToken, sq(7, 1), sq(5, 1));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("illegal_move");
  });

  it("rejects out-of-range coordinates", async () => {
    const { store, roomId, whiteToken } = await startedGame();
    const result = await playMove(store, roomId, whiteToken, sq(8, 0), sq(4, 0));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_request");
  });

  it("applies a legal move, passes the turn, and bumps the version", async () => {
    const { store, roomId, whiteToken } = await startedGame();
    const result = await playMove(store, roomId, whiteToken, sq(6, 4), sq(4, 4)); // e2-e4
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.currentTurn).toBe("black");
    expect(result.value.lastMove).toEqual({ from: { row: 6, col: 4 }, to: { row: 4, col: 4 } });
    expect(result.value.position.board[4][4]).toEqual({ type: "p", color: "white" });
    expect(result.value.position.board[6][4]).toBeNull();
    expect(result.value.position.enPassant).toEqual({ row: 5, col: 4 });
    expect(result.value.check).toBe(false);
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
      sq(6, 4),
      sq(4, 4),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("game_not_active");
  });
});

describe("playMove — checkmate (Fool's mate via the service)", () => {
  it("drives Fool's mate to a Black win and then refuses further moves", async () => {
    const { store, roomId, whiteToken, blackToken } = await startedGame();

    // 1. f3
    let r = await playMove(store, roomId, whiteToken, sq(6, 5), sq(5, 5));
    expect(r.ok).toBe(true);
    // 1... e5
    r = await playMove(store, roomId, blackToken, sq(1, 4), sq(3, 4));
    expect(r.ok).toBe(true);
    // 2. g4
    r = await playMove(store, roomId, whiteToken, sq(6, 6), sq(4, 6));
    expect(r.ok).toBe(true);
    // 2... Qh4#
    r = await playMove(store, roomId, blackToken, sq(0, 3), sq(4, 7));
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.value.status).toBe("finished");
    expect(r.value.winner).toBe("black");
    expect(r.value.check).toBe(true);
    expect(r.value.currentTurn).toBe("white");

    // Any further move is refused as the game is over.
    const after = await playMove(store, roomId, whiteToken, sq(7, 1), sq(5, 2));
    expect(after.ok).toBe(false);
    if (!after.ok) expect(after.error.code).toBe("game_over");
  });
});

describe("playMove — double operation", () => {
  it("double-tapping the same move only applies it once", async () => {
    const { store, roomId, whiteToken } = await startedGame();
    const [a, b] = await Promise.all([
      playMove(store, roomId, whiteToken, sq(6, 4), sq(4, 4)),
      playMove(store, roomId, whiteToken, sq(6, 4), sq(4, 4)),
    ]);
    const oks = [a, b].filter((r) => r.ok);
    const errs = [a, b].filter((r) => !r.ok);
    expect(oks).toHaveLength(1);
    expect(errs).toHaveLength(1);

    const view = await getRoomView(store, roomId, whiteToken);
    expect(view.ok && view.value.version).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Rematch (same room, same players)
// ---------------------------------------------------------------------------

/** Plays Fool's mate (black mates white) and returns a finished game + tokens. */
async function finishedGame() {
  const g = await startedGame();
  await playMove(g.store, g.roomId, g.whiteToken, sq(6, 5), sq(5, 5)); // f3
  await playMove(g.store, g.roomId, g.blackToken, sq(1, 4), sq(3, 4)); // e5
  await playMove(g.store, g.roomId, g.whiteToken, sq(6, 6), sq(4, 6)); // g4
  const mate = await playMove(g.store, g.roomId, g.blackToken, sq(0, 3), sq(4, 7)); // Qh4#
  if (!mate.ok || mate.value.status !== "finished") {
    throw new Error("setup: game did not reach checkmate");
  }
  return g;
}

/** Forces the current round to a finished state (isolated test helper). */
async function forceFinish(store: ReturnType<typeof freshStore>, roomId: string) {
  const s = await store.get(roomId);
  if (!s) throw new Error("forceFinish: no room");
  const cas = await store.compareAndSwap(
    roomId,
    s.version,
    { ...s, status: "finished", winner: "white", version: s.version + 1 },
    3600,
  );
  if (cas !== "ok") throw new Error("forceFinish: cas " + cas);
}

describe("requestRematch", () => {
  it("one-sided request does NOT start a new game", async () => {
    const { store, roomId, whiteToken, blackToken } = await finishedGame();
    const r = await requestRematch(store, roomId, whiteToken, 1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.status).toBe("finished");
    expect(r.value.roundId).toBe(1);
    expect(r.value.rematch.youRequested).toBe(true);
    const b = await getRoomView(store, roomId, blackToken);
    expect(b.ok && b.value.rematch.opponentRequested).toBe(true);
  });

  it("both requests start a new round from the true initial position, swap colors", async () => {
    const { store, roomId, whiteToken, blackToken } = await finishedGame();
    await requestRematch(store, roomId, whiteToken, 1);
    const second = await requestRematch(store, roomId, blackToken, 1);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.status).toBe("playing");
    expect(second.value.roundId).toBe(2);
    expect(second.value.winner).toBeNull();
    expect(second.value.check).toBe(false);
    expect(second.value.lastMove).toBeNull();
    expect(second.value.currentTurn).toBe("white");
    // Full position reset — board, active color, castling rights, en passant.
    expect(second.value.position).toEqual(createInitialPosition());
    expect(second.value.rematch.youRequested).toBe(false);
    // Colors swapped: the previous Black now plays White (opens).
    const whiteView = await getRoomView(store, roomId, whiteToken);
    const blackView = await getRoomView(store, roomId, blackToken);
    expect(whiteView.ok && whiteView.value.yourRole).toBe("black");
    expect(blackView.ok && blackView.value.yourRole).toBe("white");
  });

  it("is idempotent: repeat votes keep a single pending request", async () => {
    const { store, roomId, whiteToken } = await finishedGame();
    const first = await requestRematch(store, roomId, whiteToken, 1);
    const again = await requestRematch(store, roomId, whiteToken, 1);
    if (!first.ok || !again.ok) throw new Error("vote failed");
    expect(again.value.version).toBe(first.value.version);
  });

  it("concurrent requests start exactly one new round", async () => {
    const { store, roomId, whiteToken, blackToken } = await finishedGame();
    await Promise.all([
      requestRematch(store, roomId, whiteToken, 1),
      requestRematch(store, roomId, blackToken, 1),
    ]);
    const view = await getRoomView(store, roomId, whiteToken);
    expect(view.ok && view.value.roundId).toBe(2);
    expect(view.ok && view.value.status).toBe("playing");
  });

  it("rejects a non-player token", async () => {
    const { store, roomId } = await finishedGame();
    const r = await requestRematch(store, roomId, "outsider", 1);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("not_a_player");
  });

  it("rejects a rematch while the game is in progress", async () => {
    const { store, roomId, whiteToken } = await startedGame();
    const r = await requestRematch(store, roomId, whiteToken, 1);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("rematch_unavailable");
  });

  it("rejects a stale roundId", async () => {
    const { store, roomId, whiteToken } = await finishedGame();
    const r = await requestRematch(store, roomId, whiteToken, 99);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("stale_round");
  });

  it("allows a legal move in the new round (white = the swapped player)", async () => {
    const { store, roomId, whiteToken, blackToken } = await finishedGame();
    await requestRematch(store, roomId, whiteToken, 1);
    const started = await requestRematch(store, roomId, blackToken, 1);
    if (!started.ok) throw new Error();
    // blackToken now plays White (opens). Pick a real legal pawn move.
    const legal = getLegalMoves(started.value.position, sq(6, 4)); // e2
    expect(legal.length).toBeGreaterThan(0);
    const moved = await playMove(store, roomId, blackToken, sq(6, 4), legal[0].to, undefined, 2);
    expect(moved.ok).toBe(true);
  });

  it("rejects an old-round move after a rematch (stale operation)", async () => {
    const { store, roomId, whiteToken, blackToken } = await finishedGame();
    await requestRematch(store, roomId, whiteToken, 1);
    await requestRematch(store, roomId, blackToken, 1);
    const stale = await playMove(store, roomId, blackToken, sq(6, 4), sq(4, 4), undefined, 1);
    expect(stale.ok).toBe(false);
    if (stale.ok) return;
    expect(stale.error.code).toBe("stale_round");
    expect(stale.error.publicState?.roundId).toBe(2);
  });

  it("survives three consecutive rematches, alternating the opening color", async () => {
    const { store, roomId, whiteToken, blackToken } = await finishedGame();
    for (const expectedRound of [2, 3, 4]) {
      await requestRematch(store, roomId, whiteToken, expectedRound - 1);
      const done = await requestRematch(store, roomId, blackToken, expectedRound - 1);
      expect(done.ok && done.value.roundId).toBe(expectedRound);
      await forceFinish(store, roomId);
    }
    const view = await getRoomView(store, roomId, whiteToken);
    expect(view.ok && view.value.roundId).toBe(4);
    expect(view.ok && view.value.yourRole).toBe("black"); // 3 swaps
  });

  it("reconnect (getRoomView) restores the pending rematch state", async () => {
    const { store, roomId, whiteToken, blackToken } = await finishedGame();
    await requestRematch(store, roomId, whiteToken, 1);
    const reconnected = await getRoomView(store, roomId, blackToken);
    expect(reconnected.ok).toBe(true);
    if (!reconnected.ok) return;
    expect(reconnected.value.rematch.opponentRequested).toBe(true);
  });

  it("never leaks token hashes through the rematch view", async () => {
    const { store, roomId, whiteToken } = await finishedGame();
    const r = await requestRematch(store, roomId, whiteToken, 1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(JSON.stringify(r.value)).not.toContain("TokenHash");
  });
});
