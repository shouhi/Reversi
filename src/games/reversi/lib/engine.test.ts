import { describe, it, expect } from "vitest";
import {
  type Board,
  type Cell,
  type Player,
  BOARD_SIZE,
  createInitialBoard,
  getValidMoves,
  getFlippablePieces,
  applyMove,
  getNextTurn,
  getGameResult,
  countPieces,
  isGameOver,
  isValidMove,
  opponent,
} from "./engine";

/** Builds a board from a compact string map: `.`=empty, `B`=black, `W`=white. */
function boardFromRows(rows: string[]): Board {
  expect(rows).toHaveLength(BOARD_SIZE);
  return rows.map((row) => {
    expect(row).toHaveLength(BOARD_SIZE);
    return [...row].map<Cell>((ch) => {
      if (ch === "B") return "black";
      if (ch === "W") return "white";
      return null;
    });
  });
}

/** Sorts a list of coordinates for order-independent comparison. */
function sortCoords(coords: Array<[number, number]>): Array<[number, number]> {
  return [...coords].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

const emptyRow = "........";

describe("createInitialBoard", () => {
  it("places the four centre stones correctly", () => {
    const board = createInitialBoard();
    expect(board[3][3]).toBe("white");
    expect(board[3][4]).toBe("black");
    expect(board[4][3]).toBe("black");
    expect(board[4][4]).toBe("white");
  });

  it("leaves every other square empty (2 black, 2 white)", () => {
    const board = createInitialBoard();
    expect(countPieces(board)).toEqual({ black: 2, white: 2 });
  });

  it("returns an 8x8 board", () => {
    const board = createInitialBoard();
    expect(board).toHaveLength(8);
    for (const row of board) expect(row).toHaveLength(8);
  });
});

describe("getValidMoves — opening position", () => {
  it("gives black exactly the four standard opening moves", () => {
    const board = createInitialBoard();
    const moves = sortCoords(getValidMoves(board, "black"));
    expect(moves).toEqual([
      [2, 3],
      [3, 2],
      [4, 5],
      [5, 4],
    ]);
  });

  it("gives white four symmetric opening moves", () => {
    const board = createInitialBoard();
    const moves = sortCoords(getValidMoves(board, "white"));
    expect(moves).toEqual([
      [2, 4],
      [3, 5],
      [4, 2],
      [5, 3],
    ]);
  });
});

describe("getFlippablePieces — directional flips", () => {
  it("flips horizontally", () => {
    const board = boardFromRows([
      emptyRow,
      emptyRow,
      emptyRow,
      ".BWW....", // black at 1, white at 2,3 -> playing at (3,4) flips 2,3
      emptyRow,
      emptyRow,
      emptyRow,
      emptyRow,
    ]);
    const flipped = sortCoords(getFlippablePieces(board, 3, 4, "black"));
    expect(flipped).toEqual([
      [3, 2],
      [3, 3],
    ]);
  });

  it("flips vertically", () => {
    const board = boardFromRows([
      "...B....",
      "...W....",
      "...W....",
      emptyRow, // play black at (3,3) flips (1,3),(2,3)
      emptyRow,
      emptyRow,
      emptyRow,
      emptyRow,
    ]);
    const flipped = sortCoords(getFlippablePieces(board, 3, 3, "black"));
    expect(flipped).toEqual([
      [1, 3],
      [2, 3],
    ]);
  });

  it("flips diagonally", () => {
    const board = boardFromRows([
      "B.......",
      ".W......",
      "..W.....",
      emptyRow, // play black at (3,3) flips (1,1),(2,2)
      emptyRow,
      emptyRow,
      emptyRow,
      emptyRow,
    ]);
    const flipped = sortCoords(getFlippablePieces(board, 3, 3, "black"));
    expect(flipped).toEqual([
      [1, 1],
      [2, 2],
    ]);
  });

  it("flips in multiple directions at once", () => {
    // A cross centred on the empty square (2,3): a white stone immediately in
    // each of the four cardinal directions, each backed by a black stone.
    const board = boardFromRows([
      "...B....", // (0,3) B  — backs the upward run
      "...W....", // (1,3) W
      ".BW.WB..", // (2,1) B, (2,2) W, (2,3) empty, (2,4) W, (2,5) B
      "...W....", // (3,3) W
      "...B....", // (4,3) B  — backs the downward run
      emptyRow,
      emptyRow,
      emptyRow,
    ]);
    // Black plays (2,3): up flips (1,3), down flips (3,3), left flips (2,2),
    // right flips (2,4) — four captures from a single stone.
    const flipped = sortCoords(getFlippablePieces(board, 2, 3, "black"));
    expect(flipped).toEqual([
      [1, 3],
      [2, 2],
      [2, 4],
      [3, 3],
    ]);
  });

  it("does not flip when the run is not bracketed by own colour", () => {
    const board = boardFromRows([
      emptyRow,
      emptyRow,
      emptyRow,
      "..WW....", // no black bracket -> illegal
      emptyRow,
      emptyRow,
      emptyRow,
      emptyRow,
    ]);
    expect(getFlippablePieces(board, 3, 4, "black")).toEqual([]);
    expect(isValidMove(board, 3, 4, "black")).toBe(false);
  });
});

describe("applyMove", () => {
  it("places the stone and flips the captured pieces, returning a new board", () => {
    const board = createInitialBoard();
    const next = applyMove(board, 2, 3, "black");
    // Original board is untouched (purity).
    expect(board[2][3]).toBeNull();
    // New stone placed.
    expect(next[2][3]).toBe("black");
    // The white stone at (3,3) is flipped to black.
    expect(next[3][3]).toBe("black");
    expect(countPieces(next)).toEqual({ black: 4, white: 1 });
  });

  it("rejects an illegal placement by throwing", () => {
    const board = createInitialBoard();
    // (0,0) flips nothing.
    expect(() => applyMove(board, 0, 0, "black")).toThrow();
    // A cell that is already occupied.
    expect(() => applyMove(board, 3, 3, "black")).toThrow();
    // Out of bounds.
    expect(() => applyMove(board, -1, 0, "black")).toThrow();
    expect(() => applyMove(board, 8, 8, "black")).toThrow();
  });
});

describe("getNextTurn — turn passing", () => {
  it("passes to the opponent in the normal case", () => {
    const board = applyMove(createInitialBoard(), 2, 3, "black");
    expect(getNextTurn(board, "black")).toBe("white");
  });

  it("auto-passes back to the mover when the opponent has no move", () => {
    // White just moved. Black (opponent) is stuck but white can still play, so
    // the turn passes back to white.
    //
    //   (0,0) W  — in the corner, impossible for black to flank
    //   (0,1) B  — the only black stone
    //
    // Black cannot flank the lone corner white stone from anywhere, so black has
    // zero legal moves. White can play (0,2), flanking the black stone at (0,1)
    // against its own stone at (0,0).
    const board = boardFromRows([
      "WB......",
      emptyRow,
      emptyRow,
      emptyRow,
      emptyRow,
      emptyRow,
      emptyRow,
      emptyRow,
    ]);
    expect(getValidMoves(board, "black")).toEqual([]);
    expect(getValidMoves(board, "white").length).toBeGreaterThan(0);
    expect(getNextTurn(board, "white")).toBe("white");
  });

  it("returns null when neither player can move", () => {
    // Board completely full of black -> nobody can move.
    const full: Board = Array.from({ length: 8 }, () =>
      Array.from({ length: 8 }, () => "black" as Player),
    );
    expect(getNextTurn(full, "black")).toBeNull();
    expect(getNextTurn(full, "white")).toBeNull();
  });
});

describe("isGameOver", () => {
  it("is false at the opening", () => {
    expect(isGameOver(createInitialBoard())).toBe(false);
  });

  it("is true when the board is full", () => {
    const full: Board = Array.from({ length: 8 }, (_, r) =>
      Array.from({ length: 8 }, (_, c) =>
        ((r + c) % 2 === 0 ? "black" : "white") as Player,
      ),
    );
    expect(isGameOver(full)).toBe(true);
  });

  it("is true when both players are stuck though the board is not full", () => {
    // Only black stones on the board + empty cells with no brackets for anyone.
    const board = boardFromRows([
      "B.......",
      "........",
      "........",
      "........",
      "........",
      "........",
      "........",
      "........",
    ]);
    expect(isGameOver(board)).toBe(true);
  });
});

describe("getGameResult — scoring", () => {
  it("declares the player with more stones the winner", () => {
    const board = boardFromRows([
      "BBBBBBBB",
      "BBBBBBBB",
      "BBBBBBBB",
      "BBBBWWWW",
      "WWWWWWWW",
      "WWWWWWWW",
      "WWWWWWWW",
      "WWWWWWWW",
    ]);
    const result = getGameResult(board);
    expect(result.black).toBe(28);
    expect(result.white).toBe(36);
    expect(result.winner).toBe("white");
  });

  it("declares a draw at 32-32", () => {
    const board = boardFromRows([
      "BBBBBBBB",
      "BBBBBBBB",
      "BBBBBBBB",
      "BBBBBBBB",
      "WWWWWWWW",
      "WWWWWWWW",
      "WWWWWWWW",
      "WWWWWWWW",
    ]);
    const result = getGameResult(board);
    expect(result).toEqual({ black: 32, white: 32, winner: "draw" });
  });

  it("black wins when ahead", () => {
    const board = boardFromRows([
      "BBBBBBBB",
      "BBBBBBBB",
      "BBBBBBBB",
      "BBBBBBBB",
      "BWWWWWWW", // 1 black, 7 white
      "WWWWWWWW",
      "WWWWWWWW",
      "WWWWWWWW",
    ]);
    const result = getGameResult(board);
    expect(result.black).toBe(33);
    expect(result.white).toBe(31);
    expect(result.winner).toBe("black");
  });
});

describe("opponent", () => {
  it("swaps colours", () => {
    expect(opponent("black")).toBe("white");
    expect(opponent("white")).toBe("black");
  });
});

describe("a full self-played game stays internally consistent", () => {
  it("always-first-legal-move terminates with a valid result", () => {
    let board = createInitialBoard();
    let turn: Player | null = "black";
    let plies = 0;

    while (turn !== null && plies < 200) {
      const moves = getValidMoves(board, turn);
      // getNextTurn should never hand us a player with no move.
      expect(moves.length).toBeGreaterThan(0);
      const [r, c] = moves[0];
      expect(isValidMove(board, r, c, turn)).toBe(true);
      board = applyMove(board, r, c, turn);
      turn = getNextTurn(board, turn);
      plies++;
    }

    // The game reaches a terminal state via the getNextTurn === null contract.
    expect(turn).toBeNull();
    expect(isGameOver(board)).toBe(true);

    const { black, white } = countPieces(board);
    expect(black + white).toBeGreaterThan(4);
    expect(black + white).toBeLessThanOrEqual(64);
    expect(["black", "white", "draw"]).toContain(getGameResult(board).winner);
  });
});
