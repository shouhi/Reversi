import { describe, it, expect, beforeEach } from "vitest";
import { createMemoryStore, __resetMemoryStore } from "@/lib/store/memory";
import {
  createRoom,
  joinRoom,
  playMove,
  getRoomView,
  CONNECT_FOUR_ROOM_PREFIX,
} from "./roomService";
import { hashToken } from "@/lib/tokens";
import type { RoomState } from "../types";
import { createInitialBoard } from "./engine";

function freshStore() {
  __resetMemoryStore();
  return createMemoryStore<RoomState>(CONNECT_FOUR_ROOM_PREFIX);
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
    redToken: created.value.token,
    yellowToken: joined.value.token,
  };
}

beforeEach(() => {
  __resetMemoryStore();
});

describe("createRoom", () => {
  it("creates a waiting room with the creator as red", async () => {
    const store = freshStore();
    const result = await createRoom(store);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.roomId).toMatch(/^[a-z0-9]{12}$/);
    expect(result.value.publicState.status).toBe("waiting");
    expect(result.value.publicState.yourRole).toBe("red");
    expect(result.value.publicState.currentTurn).toBe("red");
    expect(result.value.publicState.seats).toEqual({ red: true, yellow: false });
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
  it("assigns yellow and starts the game", async () => {
    const store = freshStore();
    const created = await createRoom(store);
    if (!created.ok) throw new Error();

    const joined = await joinRoom(store, created.value.roomId, null);
    expect(joined.ok).toBe(true);
    if (!joined.ok) return;
    expect(joined.value.token).toBeTruthy();
    expect(joined.value.publicState.status).toBe("playing");
    expect(joined.value.publicState.yourRole).toBe("yellow");
    expect(joined.value.publicState.currentTurn).toBe("red");
    expect(joined.value.publicState.seats).toEqual({ red: true, yellow: true });
  });

  it("rejects a third player as room_full", async () => {
    const { store, roomId } = await startedGame();
    const third = await joinRoom(store, roomId, null);
    expect(third.ok).toBe(false);
    if (!third.ok) expect(third.error.code).toBe("room_full");
  });

  it("treats an existing player's token as a reconnect (no new token)", async () => {
    const { store, roomId, yellowToken } = await startedGame();
    const rejoin = await joinRoom(store, roomId, yellowToken);
    expect(rejoin.ok).toBe(true);
    if (!rejoin.ok) return;
    expect(rejoin.value.token).toBeUndefined();
    expect(rejoin.value.publicState.yourRole).toBe("yellow");
  });

  it("only one of two simultaneous joiners gets the yellow seat", async () => {
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
    const result = await playMove(store, roomId, "bogus-token", 0);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("not_a_player");
  });

  it("rejects moving out of turn", async () => {
    const { store, roomId, yellowToken } = await startedGame();
    // yellow tries to move first — it's red's turn.
    const result = await playMove(store, roomId, yellowToken, 0);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("not_your_turn");
      expect(result.error.publicState?.currentTurn).toBe("red");
    }
  });

  it("rejects a drop into a full column", async () => {
    const { store, roomId, redToken, yellowToken } = await startedGame();
    // Fill column 0 with alternating discs (no vertical win: never 3 in a row).
    await playMove(store, roomId, redToken, 0); // red
    await playMove(store, roomId, yellowToken, 0); // yellow
    await playMove(store, roomId, redToken, 0); // red
    await playMove(store, roomId, yellowToken, 0); // yellow
    await playMove(store, roomId, redToken, 0); // red
    await playMove(store, roomId, yellowToken, 0); // yellow — column now full
    const result = await playMove(store, roomId, redToken, 0);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("illegal_move");
  });

  it("rejects out-of-range columns", async () => {
    const { store, roomId, redToken } = await startedGame();
    const high = await playMove(store, roomId, redToken, 7);
    expect(high.ok).toBe(false);
    if (!high.ok) expect(high.error.code).toBe("invalid_request");

    const low = await playMove(store, roomId, redToken, -1);
    expect(low.ok).toBe(false);
    if (!low.ok) expect(low.error.code).toBe("invalid_request");
  });

  it("applies a legal move and passes the turn", async () => {
    const { store, roomId, redToken } = await startedGame();
    const result = await playMove(store, roomId, redToken, 3);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.currentTurn).toBe("yellow");
    expect(result.value.lastMove).toEqual({ row: 5, col: 3 });
    expect(result.value.board[5][3]).toBe("red");
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
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("game_not_active");
  });
});

describe("playMove — winning & drawing", () => {
  it("marks the game finished with a winner and a winning line", async () => {
    // Seed a board one red move from a bottom-row four-in-a-row.
    //   red on (5,0),(5,1),(5,2); yellow harmlessly on (4,0),(4,1). Red to move.
    const board = createInitialBoard();
    board[5][0] = "red";
    board[5][1] = "red";
    board[5][2] = "red";
    board[4][0] = "yellow";
    board[4][1] = "yellow";

    const store = freshStore();
    const redToken = "red-secret";
    const yellowToken = "yellow-secret";
    const seeded: RoomState = {
      roomId: "wingamexxxxx",
      board,
      currentTurn: "red",
      status: "playing",
      winner: null,
      redTokenHash: hashToken(redToken),
      yellowTokenHash: hashToken(yellowToken),
      lastMove: { row: 4, col: 1 },
      winningLine: null,
      version: 7,
      createdAt: 1,
      updatedAt: 1,
    };
    expect(await store.create(seeded.roomId, seeded, 3600)).toBe(true);

    const win = await playMove(store, seeded.roomId, redToken, 3);
    expect(win.ok).toBe(true);
    if (!win.ok) return;
    expect(win.value.status).toBe("finished");
    expect(win.value.winner).toBe("red");
    expect(win.value.winningLine).toEqual([
      [5, 0],
      [5, 1],
      [5, 2],
      [5, 3],
    ]);
    expect(win.value.version).toBe(8);

    // Any further move is refused.
    const after = await playMove(store, seeded.roomId, yellowToken, 4);
    expect(after.ok).toBe(false);
    if (!after.ok) expect(after.error.code).toBe("game_over");
  });

  it("detects a draw on a full board", async () => {
    // Seed a board one red move from a full draw: a single empty cell at (0,6).
    // color(r,c) = ((r + 2c) mod 4) < 2 ? red : yellow keeps runs <= 2, so no win.
    const board = Array.from({ length: 6 }, (_, r) =>
      Array.from({ length: 7 }, (_, c) =>
        (r + 2 * c) % 4 < 2 ? "red" : "yellow",
      ),
    ) as RoomState["board"];
    // Decide whose move fills the last cell so the colour still matches.
    const lastColor = (0 + 2 * 6) % 4 < 2 ? "red" : "yellow"; // red
    board[0][6] = null;

    const store = freshStore();
    const redToken = "red-secret";
    const yellowToken = "yellow-secret";
    const seeded: RoomState = {
      roomId: "drawgamexxxx",
      board,
      currentTurn: lastColor,
      status: "playing",
      winner: null,
      redTokenHash: hashToken(redToken),
      yellowTokenHash: hashToken(yellowToken),
      lastMove: null,
      winningLine: null,
      version: 5,
      createdAt: 1,
      updatedAt: 1,
    };
    expect(await store.create(seeded.roomId, seeded, 3600)).toBe(true);

    const result = await playMove(store, seeded.roomId, redToken, 6);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("finished");
    expect(result.value.winner).toBe("draw");
    expect(result.value.winningLine).toBeNull();
  });
});

describe("playMove — double operation", () => {
  it("double-tapping the same column only applies it once", async () => {
    const { store, roomId, redToken } = await startedGame();
    const [a, b] = await Promise.all([
      playMove(store, roomId, redToken, 0),
      playMove(store, roomId, redToken, 0),
    ]);
    const oks = [a, b].filter((r) => r.ok);
    const errs = [a, b].filter((r) => !r.ok);
    expect(oks).toHaveLength(1);
    expect(errs).toHaveLength(1);

    const view = await getRoomView(store, roomId, redToken);
    expect(view.ok && view.value.version).toBe(3);
  });
});

describe("getRoomView", () => {
  it("returns not_found for a missing room", async () => {
    const store = freshStore();
    const view = await getRoomView(store, "doesnotexist", null);
    expect(view.ok).toBe(false);
    if (!view.ok) expect(view.error.code).toBe("not_found");
  });
});
