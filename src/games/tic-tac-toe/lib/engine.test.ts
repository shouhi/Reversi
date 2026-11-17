import { describe, it, expect } from "vitest";
import {
  type Board,
  type Cell,
  BOARD_SIZE,
  createInitialBoard,
  getValidMoves,
  applyMove,
  getWinningLine,
  getNextTurn,
  getGameResult,
  isBoardFull,
  isGameOver,
  isValidMove,
  opponent,
} from "./engine";

/** Builds a board from a compact string map: `.`=empty, `O`=o, `X`=x. */
function boardFromRows(rows: string[]): Board {
  expect(rows).toHaveLength(BOARD_SIZE);
  return rows.map((row) => {
    expect(row).toHaveLength(BOARD_SIZE);
    return [...row].map<Cell>((ch) => {
      if (ch === "O") return "o";
      if (ch === "X") return "x";
      return null;
    });
  });
}

describe("createInitialBoard", () => {
  it("is a 3x3 empty board", () => {
    const board = createInitialBoard();
    expect(board).toHaveLength(3);
    for (const row of board) expect(row).toHaveLength(3);
    expect(getValidMoves(board)).toHaveLength(9);
  });
});

describe("opponent", () => {
  it("swaps marks", () => {
    expect(opponent("o")).toBe("x");
    expect(opponent("x")).toBe("o");
  });
});

describe("isValidMove / applyMove", () => {
  it("allows empty in-bounds cells and rejects the rest", () => {
    const board = applyMove(createInitialBoard(), 1, 1, "o");
    expect(isValidMove(board, 1, 1)).toBe(false); // occupied
    expect(isValidMove(board, 0, 0)).toBe(true);
    expect(isValidMove(board, -1, 0)).toBe(false);
    expect(isValidMove(board, 3, 3)).toBe(false);
  });

  it("applyMove returns a new board and does not mutate the original", () => {
    const board = createInitialBoard();
    const next = applyMove(board, 0, 0, "o");
    expect(board[0][0]).toBeNull();
    expect(next[0][0]).toBe("o");
  });

  it("throws on an illegal placement", () => {
    const board = applyMove(createInitialBoard(), 0, 0, "o");
    expect(() => applyMove(board, 0, 0, "x")).toThrow();
    expect(() => applyMove(board, 9, 9, "x")).toThrow();
  });
});

describe("getWinningLine", () => {
  it("detects a row win", () => {
    const board = boardFromRows(["OOO", "XX.", "..."]);
    const win = getWinningLine(board);
    expect(win?.player).toBe("o");
    expect(win?.line).toEqual([
      [0, 0],
      [0, 1],
      [0, 2],
    ]);
  });

  it("detects a column win", () => {
    const board = boardFromRows(["X.O", "X.O", "X.."]);
    expect(getWinningLine(board)?.player).toBe("x");
  });

  it("detects a diagonal win", () => {
    const board = boardFromRows(["O..", "XO.", "X.O"]);
    const win = getWinningLine(board);
    expect(win?.player).toBe("o");
    expect(win?.line).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
    ]);
  });

  it("returns null when there is no three-in-a-row", () => {
    const board = boardFromRows(["OX.", "...", "..."]);
    expect(getWinningLine(board)).toBeNull();
  });
});

describe("isBoardFull / isGameOver", () => {
  it("full board with no winner is a draw and game over", () => {
    const board = boardFromRows(["OXO", "OXX", "XOO"]);
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
    const board = applyMove(createInitialBoard(), 1, 1, "o");
    expect(getNextTurn(board, "o")).toBe("x");
  });

  it("returns null once the game is won", () => {
    const board = boardFromRows(["OOO", "XX.", "..."]);
    expect(getNextTurn(board, "o")).toBeNull();
  });

  it("returns null once the board is full", () => {
    const board = boardFromRows(["OXO", "OXX", "XOO"]);
    expect(getNextTurn(board, "x")).toBeNull();
  });
});
