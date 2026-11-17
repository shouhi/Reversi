import { describe, it, expect } from "vitest";
import {
  type Board,
  type Cell,
  ROWS,
  COLS,
  createInitialBoard,
  getPlayableColumns,
  isColumnPlayable,
  getDropRow,
  applyMove,
  getWinningLine,
  getNextTurn,
  getGameResult,
  isBoardFull,
  isGameOver,
  opponent,
} from "./engine";

/** Builds a board from a compact string map: `.`=empty, `R`=red, `Y`=yellow. */
function boardFromRows(rows: string[]): Board {
  expect(rows).toHaveLength(ROWS);
  return rows.map((row) => {
    expect(row).toHaveLength(COLS);
    return [...row].map<Cell>((ch) => {
      if (ch === "R") return "red";
      if (ch === "Y") return "yellow";
      return null;
    });
  });
}

describe("createInitialBoard", () => {
  it("is a 6x7 empty board", () => {
    const board = createInitialBoard();
    expect(board).toHaveLength(6);
    for (const row of board) expect(row).toHaveLength(7);
    expect(getPlayableColumns(board)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});

describe("opponent", () => {
  it("swaps discs", () => {
    expect(opponent("red")).toBe("yellow");
    expect(opponent("yellow")).toBe("red");
  });
});

describe("drop mechanics", () => {
  it("a disc lands at the bottom of an empty column", () => {
    const board = createInitialBoard();
    expect(getDropRow(board, 3)).toBe(5);
    const next = applyMove(board, 3, "red");
    expect(next[5][3]).toBe("red");
    // original board is untouched
    expect(board[5][3]).toBeNull();
  });

  it("stacks discs upward on repeated drops", () => {
    let board = createInitialBoard();
    board = applyMove(board, 2, "red");
    expect(getDropRow(board, 2)).toBe(4);
    board = applyMove(board, 2, "yellow");
    expect(board[5][2]).toBe("red");
    expect(board[4][2]).toBe("yellow");
    expect(getDropRow(board, 2)).toBe(3);
  });

  it("rejects drops into a full column", () => {
    let board = createInitialBoard();
    for (let i = 0; i < ROWS; i++) {
      board = applyMove(board, 0, i % 2 === 0 ? "red" : "yellow");
    }
    expect(isColumnPlayable(board, 0)).toBe(false);
    expect(getDropRow(board, 0)).toBe(-1);
    expect(() => applyMove(board, 0, "red")).toThrow();
    // other columns remain playable
    expect(isColumnPlayable(board, 1)).toBe(true);
    expect(getPlayableColumns(board)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("treats out-of-bounds columns as unplayable", () => {
    const board = createInitialBoard();
    expect(isColumnPlayable(board, -1)).toBe(false);
    expect(isColumnPlayable(board, 7)).toBe(false);
    expect(getDropRow(board, 7)).toBe(-1);
    expect(() => applyMove(board, 9, "red")).toThrow();
  });
});

describe("getWinningLine", () => {
  it("detects a horizontal win along the bottom row", () => {
    const board = boardFromRows([
      ".......",
      ".......",
      ".......",
      ".......",
      "YYY....",
      "RRRR...",
    ]);
    const win = getWinningLine(board);
    expect(win?.player).toBe("red");
    expect(win?.line).toEqual([
      [5, 0],
      [5, 1],
      [5, 2],
      [5, 3],
    ]);
  });

  it("detects a vertical win", () => {
    const board = boardFromRows([
      ".......",
      ".......",
      "Y......",
      "Y......",
      "Y......",
      "Y......",
    ]);
    const win = getWinningLine(board);
    expect(win?.player).toBe("yellow");
    expect(win?.line).toEqual([
      [2, 0],
      [3, 0],
      [4, 0],
      [5, 0],
    ]);
  });

  it("detects a down-right diagonal win", () => {
    const board = boardFromRows([
      ".......",
      ".......",
      "R......",
      ".R.....",
      "..R....",
      "...R...",
    ]);
    const win = getWinningLine(board);
    expect(win?.player).toBe("red");
    expect(win?.line).toEqual([
      [2, 0],
      [3, 1],
      [4, 2],
      [5, 3],
    ]);
  });

  it("detects a down-left diagonal win", () => {
    const board = boardFromRows([
      ".......",
      ".......",
      "...Y...",
      "..Y....",
      ".Y.....",
      "Y......",
    ]);
    const win = getWinningLine(board);
    expect(win?.player).toBe("yellow");
    expect(win?.line).toEqual([
      [2, 3],
      [3, 2],
      [4, 1],
      [5, 0],
    ]);
  });

  it("returns null when there is no four-in-a-row", () => {
    const board = boardFromRows([
      ".......",
      ".......",
      ".......",
      ".......",
      ".......",
      "RRR.YYY",
    ]);
    expect(getWinningLine(board)).toBeNull();
  });
});

describe("draw / isBoardFull / isGameOver", () => {
  it("a full board with no winner is a draw and game over", () => {
    // color(r,c) = ((r + 2c) mod 4) < 2 ? red : yellow. This yields at most two
    // consecutive same-colored cells in every direction, so no four-in-a-row.
    const board: Board = Array.from({ length: ROWS }, (_, r) =>
      Array.from({ length: COLS }, (_, c) =>
        ((r + 2 * c) % 4 < 2 ? "red" : "yellow") as Cell,
      ),
    );
    expect(isBoardFull(board)).toBe(true);
    expect(getWinningLine(board)).toBeNull();
    expect(isGameOver(board)).toBe(true);
    expect(getGameResult(board)).toEqual({ winner: "draw", line: null });
  });

  it("is not over at the opening", () => {
    expect(isGameOver(createInitialBoard())).toBe(false);
    expect(getGameResult(createInitialBoard())).toEqual({
      winner: null,
      line: null,
    });
  });
});

describe("getNextTurn", () => {
  it("passes to the opponent while the game continues", () => {
    const board = applyMove(createInitialBoard(), 3, "red");
    expect(getNextTurn(board, "red")).toBe("yellow");
  });

  it("returns null once the game is won", () => {
    const board = boardFromRows([
      ".......",
      ".......",
      ".......",
      ".......",
      ".......",
      "RRRR...",
    ]);
    expect(getNextTurn(board, "red")).toBeNull();
  });

  it("returns null once the board is full", () => {
    const board: Board = Array.from({ length: ROWS }, (_, r) =>
      Array.from({ length: COLS }, (_, c) =>
        ((r + 2 * c) % 4 < 2 ? "red" : "yellow") as Cell,
      ),
    );
    expect(getNextTurn(board, "yellow")).toBeNull();
  });
});
