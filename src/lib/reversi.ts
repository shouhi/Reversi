/**
 * Pure Reversi (Othello) game logic.
 *
 * This module is intentionally free of any UI, network, or storage concerns so
 * that it can run identically on the client and on the server, and be unit
 * tested in isolation. The server is the source of truth: it re-runs these same
 * functions to validate every move it receives from a client.
 */

export type Player = "black" | "white";
export type Cell = Player | null;
/** An 8x8 grid. `board[row][col]`, row/col both 0-7. */
export type Board = Cell[][];

export const BOARD_SIZE = 8;

/** The eight directions (row delta, col delta) a line can extend. */
const DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, -1],
  [0, 1],
  [1, -1],
  [1, 0],
  [1, 1],
];

/** Returns the other player. */
export function opponent(player: Player): Player {
  return player === "black" ? "white" : "black";
}

function inBounds(row: number, col: number): boolean {
  return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;
}

/** Deep-copies a board so callers never mutate shared state. */
export function cloneBoard(board: Board): Board {
  return board.map((row) => [...row]);
}

/**
 * Creates the standard starting position: an empty 8x8 board with the centre
 * four squares occupied — white on the top-left/bottom-right diagonal, black on
 * the other — and black to move first.
 */
export function createInitialBoard(): Board {
  const board: Board = Array.from({ length: BOARD_SIZE }, () =>
    Array.from({ length: BOARD_SIZE }, () => null as Cell),
  );
  board[3][3] = "white";
  board[3][4] = "black";
  board[4][3] = "black";
  board[4][4] = "white";
  return board;
}

/**
 * Returns the list of opponent pieces that would be flipped if `player` placed
 * a stone at (row, col). Returns an empty array when the move is illegal (the
 * target cell is off-board, already occupied, or flips nothing).
 */
export function getFlippablePieces(
  board: Board,
  row: number,
  col: number,
  player: Player,
): Array<[number, number]> {
  if (!inBounds(row, col) || board[row][col] !== null) {
    return [];
  }

  const foe = opponent(player);
  const flipped: Array<[number, number]> = [];

  for (const [dr, dc] of DIRECTIONS) {
    const lineCandidates: Array<[number, number]> = [];
    let r = row + dr;
    let c = col + dc;

    // Walk over a contiguous run of opponent stones.
    while (inBounds(r, c) && board[r][c] === foe) {
      lineCandidates.push([r, c]);
      r += dr;
      c += dc;
    }

    // The run only counts if it is bookended by one of our own stones.
    if (lineCandidates.length > 0 && inBounds(r, c) && board[r][c] === player) {
      flipped.push(...lineCandidates);
    }
  }

  return flipped;
}

/** Whether `player` may legally place a stone at (row, col). */
export function isValidMove(
  board: Board,
  row: number,
  col: number,
  player: Player,
): boolean {
  return getFlippablePieces(board, row, col, player).length > 0;
}

/** Every legal move for `player` on the current board. */
export function getValidMoves(
  board: Board,
  player: Player,
): Array<[number, number]> {
  const moves: Array<[number, number]> = [];
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      if (board[row][col] === null && isValidMove(board, row, col, player)) {
        moves.push([row, col]);
      }
    }
  }
  return moves;
}

/**
 * Returns a NEW board with `player`'s stone placed at (row, col) and all
 * flanked opponent stones flipped. Throws if the move is illegal — callers that
 * accept untrusted input (the server) must validate first, but throwing makes
 * misuse loud rather than silently corrupting the board.
 */
export function applyMove(
  board: Board,
  row: number,
  col: number,
  player: Player,
): Board {
  const flippable = getFlippablePieces(board, row, col, player);
  if (flippable.length === 0) {
    throw new Error(`Illegal move for ${player} at (${row}, ${col})`);
  }

  const next = cloneBoard(board);
  next[row][col] = player;
  for (const [r, c] of flippable) {
    next[r][c] = player;
  }
  return next;
}

/**
 * Given the board AFTER `currentPlayer` has just moved, returns who plays next:
 *   - the opponent, if the opponent has at least one legal move;
 *   - `currentPlayer` again, if the opponent must pass but `currentPlayer` can
 *     still move;
 *   - `null`, if neither player can move (the game is over).
 */
export function getNextTurn(board: Board, currentPlayer: Player): Player | null {
  const foe = opponent(currentPlayer);
  if (getValidMoves(board, foe).length > 0) {
    return foe;
  }
  if (getValidMoves(board, currentPlayer).length > 0) {
    return currentPlayer;
  }
  return null;
}

/** Counts the stones of each colour on the board. */
export function countPieces(board: Board): { black: number; white: number } {
  let black = 0;
  let white = 0;
  for (const row of board) {
    for (const cell of row) {
      if (cell === "black") black++;
      else if (cell === "white") white++;
    }
  }
  return { black, white };
}

/** True once neither player has a legal move (covers a full board too). */
export function isGameOver(board: Board): boolean {
  return (
    getValidMoves(board, "black").length === 0 &&
    getValidMoves(board, "white").length === 0
  );
}

/**
 * Final (or current) result by stone count. `winner` is `"draw"` on a tie.
 * Note this reflects the score at any point; use `isGameOver` to decide whether
 * the game has actually finished.
 */
export function getGameResult(board: Board): {
  black: number;
  white: number;
  winner: Player | "draw";
} {
  const { black, white } = countPieces(board);
  let winner: Player | "draw";
  if (black > white) winner = "black";
  else if (white > black) winner = "white";
  else winner = "draw";
  return { black, white, winner };
}
