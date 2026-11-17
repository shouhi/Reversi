import { describe, it, expect, beforeEach } from "vitest";
import { createMemoryStore, __resetMemoryStore } from "@/lib/store/memory";
import {
  createRoom,
  joinRoom,
  playMove,
  getRoomView,
  CHESS_ROOM_PREFIX,
} from "./roomService";
import { hashToken } from "@/lib/tokens";
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
