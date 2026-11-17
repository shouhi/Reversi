import { describe, it, expect, beforeEach } from "vitest";
import { createMemoryStore, __resetMemoryStore } from "@/lib/store/memory";
import {
  createRoom,
  joinRoom,
  playMove,
  getRoomView,
  TICTACTOE_ROOM_PREFIX,
} from "./roomService";
import { hashToken } from "@/lib/tokens";
import type { RoomState } from "../types";
import type { Board } from "./engine";

function freshStore() {
  __resetMemoryStore();
  return createMemoryStore<RoomState>(TICTACTOE_ROOM_PREFIX);
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
    oToken: created.value.token,
    xToken: joined.value.token,
  };
}

beforeEach(() => {
  __resetMemoryStore();
});

describe("createRoom", () => {
  it("creates a waiting room with the creator as ○", async () => {
    const store = freshStore();
    const result = await createRoom(store);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.roomId).toMatch(/^[a-z0-9]{12}$/);
    expect(result.value.publicState.status).toBe("waiting");
    expect(result.value.publicState.yourRole).toBe("o");
    expect(result.value.publicState.seats).toEqual({ o: true, x: false });
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
  it("assigns × and starts the game", async () => {
    const store = freshStore();
    const created = await createRoom(store);
    if (!created.ok) throw new Error();

    const joined = await joinRoom(store, created.value.roomId, null);
    expect(joined.ok).toBe(true);
    if (!joined.ok) return;
    expect(joined.value.token).toBeTruthy();
    expect(joined.value.publicState.status).toBe("playing");
    expect(joined.value.publicState.yourRole).toBe("x");
    expect(joined.value.publicState.currentTurn).toBe("o");
    expect(joined.value.publicState.seats).toEqual({ o: true, x: true });
  });

  it("rejects a third player as room_full", async () => {
    const { store, roomId } = await startedGame();
    const third = await joinRoom(store, roomId, null);
    expect(third.ok).toBe(false);
    if (!third.ok) expect(third.error.code).toBe("room_full");
  });

  it("treats an existing player's token as a reconnect (no new token)", async () => {
    const { store, roomId, xToken } = await startedGame();
    const rejoin = await joinRoom(store, roomId, xToken);
    expect(rejoin.ok).toBe(true);
    if (!rejoin.ok) return;
    expect(rejoin.value.token).toBeUndefined();
    expect(rejoin.value.publicState.yourRole).toBe("x");
  });

  it("only one of two simultaneous joiners gets the × seat", async () => {
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
    const result = await playMove(store, roomId, "bogus-token", 0, 0);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("not_a_player");
  });

  it("rejects moving out of turn", async () => {
    const { store, roomId, xToken } = await startedGame();
    // × tries to move first — it's ○'s turn.
    const result = await playMove(store, roomId, xToken, 0, 0);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("not_your_turn");
      expect(result.error.publicState?.currentTurn).toBe("o");
    }
  });

  it("rejects a move on an occupied cell", async () => {
    const { store, roomId, oToken, xToken } = await startedGame();
    await playMove(store, roomId, oToken, 1, 1);
    const result = await playMove(store, roomId, xToken, 1, 1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("illegal_move");
  });

  it("rejects out-of-range coordinates", async () => {
    const { store, roomId, oToken } = await startedGame();
    const result = await playMove(store, roomId, oToken, 3, 0);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_request");
  });

  it("applies a legal move and passes the turn", async () => {
    const { store, roomId, oToken } = await startedGame();
    const result = await playMove(store, roomId, oToken, 1, 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.currentTurn).toBe("x");
    expect(result.value.lastMove).toEqual({ row: 1, col: 1 });
    expect(result.value.board[1][1]).toBe("o");
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
      0,
      0,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("game_not_active");
  });
});

describe("playMove — winning & drawing", () => {
  it("marks the game finished with a winner and a winning line", async () => {
    const { store, roomId, oToken, xToken } = await startedGame();
    // ○ takes the top row; × plays harmlessly below.
    await playMove(store, roomId, oToken, 0, 0); // o
    await playMove(store, roomId, xToken, 1, 0); // x
    await playMove(store, roomId, oToken, 0, 1); // o
    await playMove(store, roomId, xToken, 1, 1); // x
    const win = await playMove(store, roomId, oToken, 0, 2); // o completes row 0
    expect(win.ok).toBe(true);
    if (!win.ok) return;
    expect(win.value.status).toBe("finished");
    expect(win.value.winner).toBe("o");
    expect(win.value.winningLine).toEqual([
      [0, 0],
      [0, 1],
      [0, 2],
    ]);

    // Any further move is refused.
    const after = await playMove(store, roomId, xToken, 2, 2);
    expect(after.ok).toBe(false);
    if (!after.ok) expect(after.error.code).toBe("game_over");
  });

  it("detects a draw on a full board", async () => {
    // Seed a board one ○ move from a full draw.
    //   O X O
    //   O X X
    //   X O .
    const board: Board = [
      ["o", "x", "o"],
      ["o", "x", "x"],
      ["x", "o", null],
    ];
    const store = freshStore();
    const oToken = "o-secret";
    const xToken = "x-secret";
    const seeded: RoomState = {
      roomId: "drawgamexxxx",
      board,
      currentTurn: "o",
      status: "playing",
      winner: null,
      oTokenHash: hashToken(oToken),
      xTokenHash: hashToken(xToken),
      lastMove: null,
      winningLine: null,
      version: 5,
      createdAt: 1,
      updatedAt: 1,
    };
    expect(await store.create(seeded.roomId, seeded, 3600)).toBe(true);

    const result = await playMove(store, seeded.roomId, oToken, 2, 2);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("finished");
    expect(result.value.winner).toBe("draw");
    expect(result.value.winningLine).toBeNull();
  });
});

describe("playMove — double operation", () => {
  it("double-tapping the same move only applies it once", async () => {
    const { store, roomId, oToken } = await startedGame();
    const [a, b] = await Promise.all([
      playMove(store, roomId, oToken, 0, 0),
      playMove(store, roomId, oToken, 0, 0),
    ]);
    const oks = [a, b].filter((r) => r.ok);
    const errs = [a, b].filter((r) => !r.ok);
    expect(oks).toHaveLength(1);
    expect(errs).toHaveLength(1);

    const view = await getRoomView(store, roomId, oToken);
    expect(view.ok && view.value.version).toBe(3);
  });
});
