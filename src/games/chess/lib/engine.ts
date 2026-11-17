/**
 * Pure Chess (チェス) game logic.
 *
 * Like the other game engines on this platform, this module is free of any UI /
 * network / storage concerns so it runs identically on client and server and can
 * be unit tested in isolation. The server is the source of truth and re-runs
 * these functions to validate every move.
 *
 * Board orientation (fixed by the platform conventions):
 *   - `board[row][col]`, row 0 = top = Black's back rank (rank 8),
 *     row 7 = bottom = White's back rank (rank 1).
 *   - col 0 = file a, col 7 = file h.
 *   - White pawns start on row 6 and move UP (decreasing row).
 *   - Black pawns start on row 1 and move DOWN (increasing row).
 *
 * Players: "white" (the room creator, moves first) and "black" (the joiner).
 */

export type Color = "white" | "black";
export type PieceType = "p" | "n" | "b" | "r" | "q" | "k";

export interface Piece {
  type: PieceType;
  color: Color;
}

/** A single board square: a piece or empty. */
export type Square = Piece | null;

/** An 8x8 board. `board[row][col]`, row/col both 0-7. */
export type Board = Square[][];

export const BOARD_SIZE = 8;

/** A board coordinate. */
export interface Coord {
  row: number;
  col: number;
}

/** Castling availability flags. w/b = color, K/Q = king-/queen-side. */
export interface CastlingRights {
  wK: boolean;
  wQ: boolean;
  bK: boolean;
  bQ: boolean;
}

/**
 * A full FEN-like position. Halfmove / fullmove counters are intentionally
 * omitted (the 50-move rule is not implemented — see the module notes).
 */
export interface Position {
  board: Board;
  activeColor: Color;
  castling: CastlingRights;
  /**
   * The square a pawn may move onto to capture en passant, set only on the move
   * immediately after a two-square pawn advance; otherwise null.
   */
  enPassant: Coord | null;
}

/** Flags describing special characteristics of a move. */
export interface MoveFlags {
  /** "K" = kingside castle, "Q" = queenside castle. */
  castle?: "K" | "Q";
  /** True when this move is an en passant capture. */
  enPassant?: boolean;
  /** True when this move is a pawn promotion (promotion piece in `promotion`). */
  promotion?: boolean;
  /** True when this is a two-square pawn advance. */
  doublePawn?: boolean;
}

export interface Move {
  from: Coord;
  to: Coord;
  /** The chosen promotion piece; present on promotion moves. */
  promotion?: PieceType;
  flags?: MoveFlags;
}

export type GameStatus = "playing" | "checkmate" | "stalemate";

// ---------------------------------------------------------------------------
// Direction tables
// ---------------------------------------------------------------------------

const KNIGHT_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [-2, -1],
  [-2, 1],
  [-1, -2],
  [-1, 2],
  [1, -2],
  [1, 2],
  [2, -1],
  [2, 1],
];

const KING_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, -1],
  [0, 1],
  [1, -1],
  [1, 0],
  [1, 1],
];

const DIAGONALS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
];

const ORTHOGONALS: ReadonlyArray<readonly [number, number]> = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

const PROMOTION_PIECES: ReadonlyArray<PieceType> = ["q", "r", "b", "n"];

// ---------------------------------------------------------------------------
// Basic helpers
// ---------------------------------------------------------------------------

/** Returns the other color. */
export function opponent(color: Color): Color {
  return color === "white" ? "black" : "white";
}

/** Whether (row, col) is on the board. */
export function inBounds(row: number, col: number): boolean {
  return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;
}

/** Coordinate equality. */
export function sameSquare(a: Coord, b: Coord): boolean {
  return a.row === b.row && a.col === b.col;
}

/** Deep-copies a board so callers never mutate shared state. */
export function cloneBoard(board: Board): Board {
  return board.map((row) => row.map((cell) => (cell ? { ...cell } : null)));
}

/** Deep-copies a whole position. */
export function clonePosition(pos: Position): Position {
  return {
    board: cloneBoard(pos.board),
    activeColor: pos.activeColor,
    castling: { ...pos.castling },
    enPassant: pos.enPassant ? { ...pos.enPassant } : null,
  };
}

const BACK_RANK: ReadonlyArray<PieceType> = [
  "r",
  "n",
  "b",
  "q",
  "k",
  "b",
  "n",
  "r",
];

/** An empty 8x8 board. */
export function createEmptyBoard(): Board {
  return Array.from({ length: BOARD_SIZE }, () =>
    Array.from({ length: BOARD_SIZE }, () => null as Square),
  );
}

/** The standard chess starting position. */
export function createInitialPosition(): Position {
  const board = createEmptyBoard();

  // Black back rank (row 0) and pawns (row 1).
  for (let col = 0; col < BOARD_SIZE; col++) {
    board[0][col] = { type: BACK_RANK[col], color: "black" };
    board[1][col] = { type: "p", color: "black" };
  }
  // White pawns (row 6) and back rank (row 7).
  for (let col = 0; col < BOARD_SIZE; col++) {
    board[6][col] = { type: "p", color: "white" };
    board[7][col] = { type: BACK_RANK[col], color: "white" };
  }

  return {
    board,
    activeColor: "white",
    castling: { wK: true, wQ: true, bK: true, bQ: true },
    enPassant: null,
  };
}

/** Finds the given color's king, or null if (illegally) absent. */
export function findKing(pos: Position, color: Color): Coord | null {
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const p = pos.board[r][c];
      if (p && p.type === "k" && p.color === color) return { row: r, col: c };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Attack & check detection
// ---------------------------------------------------------------------------

/**
 * Whether `sq` is attacked by any piece of `byColor`. Used for check detection
 * and castling legality. Pins are irrelevant here — an attack counts even if the
 * attacking piece is itself pinned.
 */
export function isSquareAttacked(
  pos: Position,
  sq: Coord,
  byColor: Color,
): boolean {
  const b = pos.board;
  const { row, col } = sq;

  // Pawn attacks. A white pawn attacks toward row 0, so a white pawn that
  // attacks (row,col) sits at (row+1, col±1); a black pawn at (row-1, col±1).
  const pawnSourceRow = byColor === "white" ? row + 1 : row - 1;
  for (const dc of [-1, 1]) {
    const c = col + dc;
    if (inBounds(pawnSourceRow, c)) {
      const p = b[pawnSourceRow][c];
      if (p && p.color === byColor && p.type === "p") return true;
    }
  }

  // Knight attacks.
  for (const [dr, dc] of KNIGHT_OFFSETS) {
    const r = row + dr;
    const c = col + dc;
    if (inBounds(r, c)) {
      const p = b[r][c];
      if (p && p.color === byColor && p.type === "n") return true;
    }
  }

  // Adjacent king.
  for (const [dr, dc] of KING_OFFSETS) {
    const r = row + dr;
    const c = col + dc;
    if (inBounds(r, c)) {
      const p = b[r][c];
      if (p && p.color === byColor && p.type === "k") return true;
    }
  }

  // Diagonal sliders (bishop / queen).
  for (const [dr, dc] of DIAGONALS) {
    let r = row + dr;
    let c = col + dc;
    while (inBounds(r, c)) {
      const p = b[r][c];
      if (p) {
        if (p.color === byColor && (p.type === "b" || p.type === "q")) {
          return true;
        }
        break;
      }
      r += dr;
      c += dc;
    }
  }

  // Orthogonal sliders (rook / queen).
  for (const [dr, dc] of ORTHOGONALS) {
    let r = row + dr;
    let c = col + dc;
    while (inBounds(r, c)) {
      const p = b[r][c];
      if (p) {
        if (p.color === byColor && (p.type === "r" || p.type === "q")) {
          return true;
        }
        break;
      }
      r += dr;
      c += dc;
    }
  }

  return false;
}

/** Whether `color`'s king is currently in check. */
export function isInCheck(pos: Position, color: Color): boolean {
  const king = findKing(pos, color);
  if (!king) return false;
  return isSquareAttacked(pos, king, opponent(color));
}

// ---------------------------------------------------------------------------
// Applying a move (internal, no legality validation)
// ---------------------------------------------------------------------------

/**
 * Returns a NEW position with `move` applied. Performs no legality check beyond
 * requiring a piece on the source square — callers (getLegalMoves / applyMove)
 * are responsible for only passing legal or pseudo-legal moves.
 */
function makeMove(pos: Position, move: Move): Position {
  const board = cloneBoard(pos.board);
  const piece = board[move.from.row][move.from.col];
  if (!piece) {
    throw new Error("makeMove: no piece on the source square");
  }
  const color = piece.color;
  const dir = color === "white" ? -1 : 1;

  // En passant is the only way a pawn moves diagonally onto an empty square.
  const isEnPassant =
    piece.type === "p" &&
    move.from.col !== move.to.col &&
    board[move.to.row][move.to.col] === null;

  // Lift the piece.
  board[move.from.row][move.from.col] = null;

  if (isEnPassant) {
    // The captured pawn sits on the mover's start row, in the target column.
    board[move.from.row][move.to.col] = null;
  }

  // Place the piece, applying promotion on reaching the last rank.
  if (piece.type === "p" && (move.to.row === 0 || move.to.row === 7)) {
    const promo = move.promotion ?? "q";
    board[move.to.row][move.to.col] = { type: promo, color };
  } else {
    board[move.to.row][move.to.col] = piece;
  }

  // Castling: relocate the rook alongside the king.
  if (piece.type === "k" && Math.abs(move.to.col - move.from.col) === 2) {
    const row = move.from.row;
    if (move.to.col === 6) {
      // Kingside: rook h -> f.
      board[row][5] = board[row][7];
      board[row][7] = null;
    } else if (move.to.col === 2) {
      // Queenside: rook a -> d.
      board[row][3] = board[row][0];
      board[row][0] = null;
    }
  }

  // Update castling rights.
  const castling: CastlingRights = { ...pos.castling };
  if (piece.type === "k") {
    if (color === "white") {
      castling.wK = false;
      castling.wQ = false;
    } else {
      castling.bK = false;
      castling.bQ = false;
    }
  }
  // A rook leaving its home square forfeits that right.
  if (piece.type === "r") {
    if (move.from.row === 7 && move.from.col === 0) castling.wQ = false;
    if (move.from.row === 7 && move.from.col === 7) castling.wK = false;
    if (move.from.row === 0 && move.from.col === 0) castling.bQ = false;
    if (move.from.row === 0 && move.from.col === 7) castling.bK = false;
  }
  // A rook captured on its home square forfeits the opponent's right there.
  if (move.to.row === 7 && move.to.col === 0) castling.wQ = false;
  if (move.to.row === 7 && move.to.col === 7) castling.wK = false;
  if (move.to.row === 0 && move.to.col === 0) castling.bQ = false;
  if (move.to.row === 0 && move.to.col === 7) castling.bK = false;

  // Set the en passant target on a two-square pawn advance.
  let enPassant: Coord | null = null;
  if (piece.type === "p" && Math.abs(move.to.row - move.from.row) === 2) {
    enPassant = { row: move.from.row + dir, col: move.from.col };
  }

  return {
    board,
    activeColor: opponent(color),
    castling,
    enPassant,
  };
}

// ---------------------------------------------------------------------------
// Pseudo-legal move generation (per piece type)
// ---------------------------------------------------------------------------

function pushPawnMove(
  moves: Move[],
  from: Coord,
  to: Coord,
  promoRow: number,
  flags?: MoveFlags,
): void {
  if (to.row === promoRow) {
    for (const promo of PROMOTION_PIECES) {
      moves.push({ from, to, promotion: promo, flags: { ...flags, promotion: true } });
    }
  } else {
    moves.push(flags ? { from, to, flags } : { from, to });
  }
}

function pawnMoves(pos: Position, from: Coord): Move[] {
  const moves: Move[] = [];
  const b = pos.board;
  const piece = b[from.row][from.col];
  if (!piece) return moves;
  const color = piece.color;
  const dir = color === "white" ? -1 : 1;
  const startRow = color === "white" ? 6 : 1;
  const promoRow = color === "white" ? 0 : 7;

  // Forward one.
  const oneRow = from.row + dir;
  if (inBounds(oneRow, from.col) && b[oneRow][from.col] === null) {
    pushPawnMove(moves, from, { row: oneRow, col: from.col }, promoRow);

    // Forward two (only from the start rank, both squares empty).
    const twoRow = from.row + 2 * dir;
    if (
      from.row === startRow &&
      inBounds(twoRow, from.col) &&
      b[twoRow][from.col] === null
    ) {
      moves.push({
        from,
        to: { row: twoRow, col: from.col },
        flags: { doublePawn: true },
      });
    }
  }

  // Diagonal captures (including en passant).
  for (const dc of [-1, 1]) {
    const r = from.row + dir;
    const c = from.col + dc;
    if (!inBounds(r, c)) continue;
    const target = b[r][c];
    if (target && target.color !== color) {
      pushPawnMove(moves, from, { row: r, col: c }, promoRow);
    } else if (
      target === null &&
      pos.enPassant &&
      pos.enPassant.row === r &&
      pos.enPassant.col === c
    ) {
      moves.push({ from, to: { row: r, col: c }, flags: { enPassant: true } });
    }
  }

  return moves;
}

function jumpMoves(
  pos: Position,
  from: Coord,
  offsets: ReadonlyArray<readonly [number, number]>,
): Move[] {
  const moves: Move[] = [];
  const piece = pos.board[from.row][from.col];
  if (!piece) return moves;
  for (const [dr, dc] of offsets) {
    const r = from.row + dr;
    const c = from.col + dc;
    if (!inBounds(r, c)) continue;
    const target = pos.board[r][c];
    if (!target || target.color !== piece.color) {
      moves.push({ from, to: { row: r, col: c } });
    }
  }
  return moves;
}

function slideMoves(
  pos: Position,
  from: Coord,
  dirs: ReadonlyArray<readonly [number, number]>,
): Move[] {
  const moves: Move[] = [];
  const piece = pos.board[from.row][from.col];
  if (!piece) return moves;
  for (const [dr, dc] of dirs) {
    let r = from.row + dr;
    let c = from.col + dc;
    while (inBounds(r, c)) {
      const target = pos.board[r][c];
      if (!target) {
        moves.push({ from, to: { row: r, col: c } });
      } else {
        if (target.color !== piece.color) {
          moves.push({ from, to: { row: r, col: c } });
        }
        break;
      }
      r += dr;
      c += dc;
    }
  }
  return moves;
}

function castlingMoves(pos: Position, from: Coord): Move[] {
  const moves: Move[] = [];
  const piece = pos.board[from.row][from.col];
  if (!piece || piece.type !== "k") return moves;
  const color = piece.color;
  const row = color === "white" ? 7 : 0;

  // King must be on its original square.
  if (from.row !== row || from.col !== 4) return moves;

  const enemy = opponent(color);
  // Cannot castle out of check.
  if (isSquareAttacked(pos, { row, col: 4 }, enemy)) return moves;

  const kingSide = color === "white" ? pos.castling.wK : pos.castling.bK;
  const queenSide = color === "white" ? pos.castling.wQ : pos.castling.bQ;

  if (kingSide) {
    const rook = pos.board[row][7];
    if (
      pos.board[row][5] === null &&
      pos.board[row][6] === null &&
      rook &&
      rook.type === "r" &&
      rook.color === color &&
      !isSquareAttacked(pos, { row, col: 5 }, enemy) &&
      !isSquareAttacked(pos, { row, col: 6 }, enemy)
    ) {
      moves.push({
        from,
        to: { row, col: 6 },
        flags: { castle: "K" },
      });
    }
  }

  if (queenSide) {
    const rook = pos.board[row][0];
    if (
      pos.board[row][1] === null &&
      pos.board[row][2] === null &&
      pos.board[row][3] === null &&
      rook &&
      rook.type === "r" &&
      rook.color === color &&
      !isSquareAttacked(pos, { row, col: 3 }, enemy) &&
      !isSquareAttacked(pos, { row, col: 2 }, enemy)
    ) {
      moves.push({
        from,
        to: { row, col: 2 },
        flags: { castle: "Q" },
      });
    }
  }

  return moves;
}

function pseudoLegalMoves(pos: Position, from: Coord): Move[] {
  const piece = pos.board[from.row]?.[from.col];
  if (!piece) return [];
  switch (piece.type) {
    // All six piece types are handled below (exhaustive over PieceType).
    case "p":
      return pawnMoves(pos, from);
    case "n":
      return jumpMoves(pos, from, KNIGHT_OFFSETS);
    case "b":
      return slideMoves(pos, from, DIAGONALS);
    case "r":
      return slideMoves(pos, from, ORTHOGONALS);
    case "q":
      return slideMoves(pos, from, [...DIAGONALS, ...ORTHOGONALS]);
    case "k":
      return [
        ...jumpMoves(pos, from, KING_OFFSETS),
        ...castlingMoves(pos, from),
      ];
  }
}

// ---------------------------------------------------------------------------
// Legal move generation
// ---------------------------------------------------------------------------

/**
 * All fully legal moves from a square (for the piece sitting there), i.e.
 * pseudo-legal moves that do not leave the mover's own king in check. Returns an
 * empty array when the square is empty.
 */
export function getLegalMoves(pos: Position, from: Coord): Move[] {
  if (!inBounds(from.row, from.col)) return [];
  const piece = pos.board[from.row][from.col];
  if (!piece) return [];
  const color = piece.color;
  return pseudoLegalMoves(pos, from).filter((move) => {
    const next = makeMove(pos, move);
    return !isInCheck(next, color);
  });
}

/** Every legal move for `color` across the whole board. */
export function getAllLegalMoves(pos: Position, color: Color): Move[] {
  const moves: Move[] = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const p = pos.board[r][c];
      if (p && p.color === color) {
        moves.push(...getLegalMoves(pos, { row: r, col: c }));
      }
    }
  }
  return moves;
}

/**
 * Applies a move to the position, returning a NEW position. Throws when the move
 * is not legal (wrong color to move, illegal destination, or bad promotion).
 */
export function applyMove(pos: Position, move: Move): Position {
  if (!inBounds(move.from.row, move.from.col) || !inBounds(move.to.row, move.to.col)) {
    throw new Error("applyMove: coordinates out of range");
  }
  const piece = pos.board[move.from.row][move.from.col];
  if (!piece) {
    throw new Error("applyMove: no piece on the source square");
  }
  if (piece.color !== pos.activeColor) {
    throw new Error("applyMove: it is not that color's turn");
  }

  const legal = getLegalMoves(pos, move.from);
  const candidates = legal.filter((m) => sameSquare(m.to, move.to));
  if (candidates.length === 0) {
    throw new Error("applyMove: illegal move");
  }

  const isPromotion = candidates.some((m) => m.flags?.promotion);
  let match: Move | undefined;
  if (isPromotion) {
    const wanted = move.promotion ?? "q";
    match = candidates.find((m) => m.promotion === wanted);
  } else {
    match = candidates[0];
  }
  if (!match) {
    throw new Error("applyMove: illegal move");
  }

  return makeMove(pos, match);
}

/**
 * The status for the side to move (`pos.activeColor`):
 *   - "checkmate": in check with no legal move (the other side has won),
 *   - "stalemate": not in check with no legal move (draw),
 *   - "playing": at least one legal move exists.
 */
export function getGameStatus(pos: Position): GameStatus {
  const hasMove = getAllLegalMoves(pos, pos.activeColor).length > 0;
  if (hasMove) return "playing";
  return isInCheck(pos, pos.activeColor) ? "checkmate" : "stalemate";
}
