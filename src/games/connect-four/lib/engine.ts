/**
 * Pure Connect Four (四目並べ) game logic.
 *
 * Like the other game engines, this module is free of any UI / network /
 * storage concerns so it can run identically on client and server and be unit
 * tested in isolation. The server is the source of truth and re-runs these
 * functions to validate every move.
 *
 * Players: "red" (the first player / room creator) and "yellow" (the joiner).
 * The board is 6 rows × 7 columns; `board[row][col]`, row 0 = TOP, row 5 =
 * BOTTOM. A move names a COLUMN and the disc falls to the lowest empty row.
 */

export type Player = "red" | "yellow";
export type Cell = Player | null;
/** A 6×7 grid. `board[row][col]`; row 0 = top, row 5 = bottom. */
export type Board = Cell[][];

export const ROWS = 6;
export const COLS = 7;

/** Returns the other player. */
export function opponent(player: Player): Player {
  return player === "red" ? "yellow" : "red";
}

function colInBounds(col: number): boolean {
  return Number.isInteger(col) && col >= 0 && col < COLS;
}

/** Deep-copies a board so callers never mutate shared state. */
export function cloneBoard(board: Board): Board {
  return board.map((row) => [...row]);
}

/** An empty 6×7 board. */
export function createInitialBoard(): Board {
  return Array.from({ length: ROWS }, () =>
    Array.from({ length: COLS }, () => null as Cell),
  );
}

/** Whether a disc can still be dropped into `col` (on board and not full). */
export function isColumnPlayable(board: Board, col: number): boolean {
  return colInBounds(col) && board[0][col] === null;
}

/**
 * The row a disc would land in if dropped into `col`: the lowest (largest index)
 * empty row. Returns -1 if the column is full or out of bounds.
 */
export function getDropRow(board: Board, col: number): number {
  if (!colInBounds(col)) return -1;
  for (let row = ROWS - 1; row >= 0; row--) {
    if (board[row][col] === null) return row;
  }
  return -1;
}

/**
 * Returns a NEW board with `player`'s disc dropped into `col`. Throws if the
 * column is off-board or full — callers accepting untrusted input (the server)
 * must validate first, but throwing makes misuse loud.
 */
export function applyMove(board: Board, col: number, player: Player): Board {
  const row = getDropRow(board, col);
  if (row < 0) {
    throw new Error(`Illegal move for ${player} in column ${col}`);
  }
  const next = cloneBoard(board);
  next[row][col] = player;
  return next;
}

/** The four scan directions: horizontal, vertical, and both diagonals. */
const DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, 1], // horizontal →
  [1, 0], // vertical ↓
  [1, 1], // diagonal ↘
  [1, -1], // diagonal ↙
];

export interface WinInfo {
  player: Player;
  /** The four cells forming the winning line. */
  line: Array<[number, number]>;
}

/** Returns the winner and winning line, or null if there is no four-in-a-row. */
export function getWinningLine(board: Board): WinInfo | null {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const first = board[r][c];
      if (!first) continue;
      for (const [dr, dc] of DIRECTIONS) {
        const line: Array<[number, number]> = [[r, c]];
        for (let i = 1; i < 4; i++) {
          const nr = r + dr * i;
          const nc = c + dc * i;
          if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) break;
          if (board[nr][nc] !== first) break;
          line.push([nr, nc]);
        }
        if (line.length === 4) {
          return { player: first, line };
        }
      }
    }
  }
  return null;
}

/** True when every cell is filled. */
export function isBoardFull(board: Board): boolean {
  return board.every((row) => row.every((cell) => cell !== null));
}

/** True once the game cannot continue (someone won, or the board is full). */
export function isGameOver(board: Board): boolean {
  return getWinningLine(board) !== null || isBoardFull(board);
}

/**
 * Given the board AFTER `currentPlayer` just moved, returns who plays next, or
 * `null` if the game is over. There is no passing in Connect Four: as long as
 * the game continues, the turn always goes to the opponent.
 */
export function getNextTurn(board: Board, currentPlayer: Player): Player | null {
  if (isGameOver(board)) return null;
  return opponent(currentPlayer);
}

/**
 * Current result: the winning player (with the line), `"draw"` on a full board
 * with no winner, or `null` while the game is still in progress.
 */
export function getGameResult(board: Board): {
  winner: Player | "draw" | null;
  line: Array<[number, number]> | null;
} {
  const win = getWinningLine(board);
  if (win) return { winner: win.player, line: win.line };
  if (isBoardFull(board)) return { winner: "draw", line: null };
  return { winner: null, line: null };
}

/** Every column that can still accept a disc. */
export function getPlayableColumns(board: Board): number[] {
  const cols: number[] = [];
  for (let c = 0; c < COLS; c++) {
    if (isColumnPlayable(board, c)) cols.push(c);
  }
  return cols;
}
