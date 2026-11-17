/**
 * Pure Tic-Tac-Toe (○×ゲーム) game logic.
 *
 * Like the Reversi engine, this module is free of any UI / network / storage
 * concerns so it can run identically on client and server and be unit tested in
 * isolation. The server is the source of truth and re-runs these functions to
 * validate every move.
 *
 * Players: "o" (○, the first player / room creator) and "x" (×, the joiner).
 */

export type Player = "o" | "x";
export type Cell = Player | null;
/** A 3x3 grid. `board[row][col]`, row/col both 0-2. */
export type Board = Cell[][];

export const BOARD_SIZE = 3;

/** Returns the other player. */
export function opponent(player: Player): Player {
  return player === "o" ? "x" : "o";
}

function inBounds(row: number, col: number): boolean {
  return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;
}

/** Deep-copies a board so callers never mutate shared state. */
export function cloneBoard(board: Board): Board {
  return board.map((row) => [...row]);
}

/** An empty 3x3 board. */
export function createInitialBoard(): Board {
  return Array.from({ length: BOARD_SIZE }, () =>
    Array.from({ length: BOARD_SIZE }, () => null as Cell),
  );
}

/** Whether (row, col) is on the board and currently empty. */
export function isValidMove(board: Board, row: number, col: number): boolean {
  return inBounds(row, col) && board[row][col] === null;
}

/** Every empty cell. */
export function getValidMoves(board: Board): Array<[number, number]> {
  const moves: Array<[number, number]> = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] === null) moves.push([r, c]);
    }
  }
  return moves;
}

/**
 * Returns a NEW board with `player`'s mark placed at (row, col). Throws if the
 * cell is off-board or occupied — callers accepting untrusted input (the server)
 * must validate first, but throwing makes misuse loud.
 */
export function applyMove(
  board: Board,
  row: number,
  col: number,
  player: Player,
): Board {
  if (!isValidMove(board, row, col)) {
    throw new Error(`Illegal move for ${player} at (${row}, ${col})`);
  }
  const next = cloneBoard(board);
  next[row][col] = player;
  return next;
}

/** The eight winning lines, each as three [row, col] coordinates. */
const LINES: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  // rows
  [[0, 0], [0, 1], [0, 2]],
  [[1, 0], [1, 1], [1, 2]],
  [[2, 0], [2, 1], [2, 2]],
  // columns
  [[0, 0], [1, 0], [2, 0]],
  [[0, 1], [1, 1], [2, 1]],
  [[0, 2], [1, 2], [2, 2]],
  // diagonals
  [[0, 0], [1, 1], [2, 2]],
  [[0, 2], [1, 1], [2, 0]],
];

export interface WinInfo {
  player: Player;
  /** The three cells forming the winning line. */
  line: Array<[number, number]>;
}

/** Returns the winner and winning line, or null if there is no three-in-a-row. */
export function getWinningLine(board: Board): WinInfo | null {
  for (const line of LINES) {
    const [a, b, c] = line;
    const first = board[a[0]][a[1]];
    if (first && first === board[b[0]][b[1]] && first === board[c[0]][c[1]]) {
      return { player: first, line: line.map(([r, col]) => [r, col]) };
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
 * `null` if the game is over. There is no passing in Tic-Tac-Toe: as long as
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
