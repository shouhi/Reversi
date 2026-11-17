/**
 * Pure Shogi (将棋 / Japanese chess) game logic.
 *
 * Like the other game engines on this platform, this module is free of any UI /
 * network / storage concerns so it runs identically on client and server and can
 * be unit tested in isolation. The server is the source of truth and re-runs
 * these functions to validate every move.
 *
 * Board orientation (fixed by the platform conventions):
 *   - `board[row][col]`, row 0 = top = Gote's far side,
 *     row 8 = bottom = Sente's near side; col 0..8.
 *   - Sente (先手, the creator) moves first; its pieces advance UP the board
 *     (decreasing row). Gote (後手, the joiner) advances DOWN (increasing row).
 *
 * A piece carries its base type plus a `promoted` flag — captured pieces always
 * revert to the base, unpromoted type when they enter a hand.
 *
 * Implemented rules: full legal movement for all pieces and their promotions,
 * optional + forced promotion, drops from hand (打ち込み), 二歩 (nifu),
 * 打ち歩詰め (uchifuzume), check, and checkmate. Draws by 千日手 (sennichite)
 * and perpetual check are intentionally NOT implemented (see getGameStatus).
 */

export type Player = "sente" | "gote";

/** Base piece types (歩香桂銀金角飛玉). `KI` and `OU` never promote. */
export type PieceType = "FU" | "KY" | "KE" | "GI" | "KI" | "KA" | "HI" | "OU";

/** Piece types that can sit in a hand and be dropped (everything but the king). */
export type DroppableType = "FU" | "KY" | "KE" | "GI" | "KI" | "KA" | "HI";

export interface Piece {
  type: PieceType;
  owner: Player;
  promoted: boolean;
}

/** A single board square: a piece or empty. */
export type Square = Piece | null;

/** A 9x9 board. `board[row][col]`, row/col both 0-8. */
export type Board = Square[][];

export const BOARD_SIZE = 9;

/** The seven droppable types, in a stable display order. */
export const DROPPABLE_TYPES: ReadonlyArray<DroppableType> = [
  "HI",
  "KA",
  "KI",
  "GI",
  "KE",
  "KY",
  "FU",
];

/** Captured pieces, counted per type, for each player. */
export interface Hands {
  sente: Partial<Record<DroppableType, number>>;
  gote: Partial<Record<DroppableType, number>>;
}

/** A board coordinate. */
export interface Coord {
  row: number;
  col: number;
}

/**
 * A move. Either a board move (`from`/`to`/`promote`) or a drop (`drop`/`to`).
 * `lastMove` persisted on a room uses this same shape.
 */
export interface Move {
  /** Present for a board move: the source square. Absent for a drop. */
  from?: Coord;
  to: Coord;
  /** Board move only: whether the piece promotes as part of this move. */
  promote?: boolean;
  /** Present for a drop: the hand piece being dropped. */
  drop?: DroppableType;
}

/** The complete game position: board, both hands, and whose turn it is. */
export interface Position {
  board: Board;
  hands: Hands;
  activeColor: Player;
}

export type GameStatus = "playing" | "checkmate";

// ---------------------------------------------------------------------------
// Direction tables (board-absolute)
// ---------------------------------------------------------------------------

type Offset = readonly [number, number];

const DIAGONALS: ReadonlyArray<Offset> = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
];

const ORTHOGONALS: ReadonlyArray<Offset> = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

const ALL_EIGHT: ReadonlyArray<Offset> = [...ORTHOGONALS, ...DIAGONALS];

// ---------------------------------------------------------------------------
// Basic helpers
// ---------------------------------------------------------------------------

/** Returns the other player. */
export function opponent(player: Player): Player {
  return player === "sente" ? "gote" : "sente";
}

/** Whether (row, col) is on the board. */
export function inBounds(row: number, col: number): boolean {
  return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;
}

/** Coordinate equality. */
export function sameSquare(a: Coord, b: Coord): boolean {
  return a.row === b.row && a.col === b.col;
}

/** An empty 9x9 board. */
export function createEmptyBoard(): Board {
  return Array.from({ length: BOARD_SIZE }, () =>
    Array.from({ length: BOARD_SIZE }, () => null as Square),
  );
}

/** Deep-copies a board so callers never mutate shared state. */
export function cloneBoard(board: Board): Board {
  return board.map((row) => row.map((cell) => (cell ? { ...cell } : null)));
}

/** Deep-copies both hands. */
export function cloneHands(hands: Hands): Hands {
  return { sente: { ...hands.sente }, gote: { ...hands.gote } };
}

/** Deep-copies a whole position. */
export function clonePosition(pos: Position): Position {
  return {
    board: cloneBoard(pos.board),
    hands: cloneHands(pos.hands),
    activeColor: pos.activeColor,
  };
}

/** Whether `move` is a drop (vs a board move). */
export function isDropMove(move: Move): boolean {
  return move.drop !== undefined;
}

const BACK_RANK: ReadonlyArray<PieceType> = [
  "KY",
  "KE",
  "GI",
  "KI",
  "OU",
  "KI",
  "GI",
  "KE",
  "KY",
];

/** The standard Shogi starting position (Sente to move). */
export function createInitialPosition(): Position {
  const board = createEmptyBoard();

  // Gote (top): back rank row 0, rook/bishop row 1, pawns row 2.
  for (let col = 0; col < BOARD_SIZE; col++) {
    board[0][col] = { type: BACK_RANK[col], owner: "gote", promoted: false };
    board[2][col] = { type: "FU", owner: "gote", promoted: false };
  }
  board[1][1] = { type: "HI", owner: "gote", promoted: false };
  board[1][7] = { type: "KA", owner: "gote", promoted: false };

  // Sente (bottom): pawns row 6, bishop/rook row 7, back rank row 8.
  for (let col = 0; col < BOARD_SIZE; col++) {
    board[6][col] = { type: "FU", owner: "sente", promoted: false };
    board[8][col] = { type: BACK_RANK[col], owner: "sente", promoted: false };
  }
  board[7][1] = { type: "KA", owner: "sente", promoted: false };
  board[7][7] = { type: "HI", owner: "sente", promoted: false };

  return {
    board,
    hands: { sente: {}, gote: {} },
    activeColor: "sente",
  };
}

/** Finds the given player's king (OU), or null if (illegally) absent. */
export function findKing(pos: Position, player: Player): Coord | null {
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const p = pos.board[r][c];
      if (p && p.type === "OU" && p.owner === player) return { row: r, col: c };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Movement patterns
// ---------------------------------------------------------------------------

interface Pattern {
  /** Single-step (or jump) offsets; the destination square is checked directly. */
  steps: ReadonlyArray<Offset>;
  /** Sliding directions; extend until blocked. */
  slides: ReadonlyArray<Offset>;
}

/**
 * The movement pattern for a piece, in board-absolute offsets. Forward depends
 * on the owner: Sente forward = row-1, Gote forward = row+1.
 */
function movePattern(
  type: PieceType,
  owner: Player,
  promoted: boolean,
): Pattern {
  const dir = owner === "sente" ? -1 : 1;
  // Board offset for a forward-relative (forward, side) step.
  const rel = (forward: number, side: number): Offset => [dir * forward, side];

  // Gold (金) and all promoted FU/KY/KE/GI: six steps, no back diagonals.
  const gold = (): ReadonlyArray<Offset> => [
    rel(1, 0),
    rel(1, -1),
    rel(1, 1),
    rel(0, -1),
    rel(0, 1),
    rel(-1, 0),
  ];

  if (promoted) {
    switch (type) {
      case "FU":
      case "KY":
      case "KE":
      case "GI":
        return { steps: gold(), slides: [] };
      case "KA":
        // 馬 (UM): bishop slides + one orthogonal step.
        return { steps: ORTHOGONALS, slides: DIAGONALS };
      case "HI":
        // 龍 (RY): rook slides + one diagonal step.
        return { steps: DIAGONALS, slides: ORTHOGONALS };
      default:
        break; // KI / OU never promote
    }
  }

  switch (type) {
    case "FU":
      return { steps: [rel(1, 0)], slides: [] };
    case "KY":
      return { steps: [], slides: [rel(1, 0)] };
    case "KE":
      return { steps: [rel(2, -1), rel(2, 1)], slides: [] };
    case "GI":
      return {
        steps: [rel(1, 0), rel(1, -1), rel(1, 1), rel(-1, -1), rel(-1, 1)],
        slides: [],
      };
    case "KI":
      return { steps: gold(), slides: [] };
    case "KA":
      return { steps: [], slides: DIAGONALS };
    case "HI":
      return { steps: [], slides: ORTHOGONALS };
    case "OU":
      return { steps: ALL_EIGHT, slides: [] };
  }
}

// ---------------------------------------------------------------------------
// Attack & check detection
// ---------------------------------------------------------------------------

/** The squares a piece on `from` attacks (occupant-agnostic for steps). */
function attackSquares(board: Board, from: Coord, piece: Piece): Coord[] {
  const { steps, slides } = movePattern(piece.type, piece.owner, piece.promoted);
  const res: Coord[] = [];

  for (const [dr, dc] of steps) {
    const r = from.row + dr;
    const c = from.col + dc;
    if (inBounds(r, c)) res.push({ row: r, col: c });
  }

  for (const [dr, dc] of slides) {
    let r = from.row + dr;
    let c = from.col + dc;
    while (inBounds(r, c)) {
      res.push({ row: r, col: c });
      if (board[r][c]) break; // attacks the first piece in the way, then stops
      r += dr;
      c += dc;
    }
  }

  return res;
}

/** Whether `sq` is attacked by any piece owned by `byPlayer`. */
export function isSquareAttacked(
  pos: Position,
  sq: Coord,
  byPlayer: Player,
): boolean {
  const b = pos.board;
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const p = b[r][c];
      if (!p || p.owner !== byPlayer) continue;
      const attacks = attackSquares(b, { row: r, col: c }, p);
      for (const a of attacks) {
        if (a.row === sq.row && a.col === sq.col) return true;
      }
    }
  }
  return false;
}

/** Whether `player`'s king is currently in check. */
export function isInCheck(pos: Position, player: Player): boolean {
  const king = findKing(pos, player);
  if (!king) return false;
  return isSquareAttacked(pos, king, opponent(player));
}

// ---------------------------------------------------------------------------
// Promotion / drop zone helpers
// ---------------------------------------------------------------------------

function inPromotionZone(owner: Player, row: number): boolean {
  return owner === "sente" ? row <= 2 : row >= 6;
}

function lastRank(owner: Player): number {
  return owner === "sente" ? 0 : 8;
}

function inLastTwoRanks(owner: Player, row: number): boolean {
  return owner === "sente" ? row <= 1 : row >= 7;
}

/** Whether a piece is eligible to promote at all (not KI/OU, not already promoted). */
function canPromotePiece(piece: Piece): boolean {
  if (piece.promoted) return false;
  return piece.type !== "KI" && piece.type !== "OU";
}

/** Whether promotion is forced (the only legal variant) when landing on destRow. */
function isForcedPromotion(
  type: PieceType,
  owner: Player,
  destRow: number,
): boolean {
  if (type === "FU" || type === "KY") return destRow === lastRank(owner);
  if (type === "KE") return inLastTwoRanks(owner, destRow);
  return false;
}

/** Whether a dropped piece would have at least one potential future move. */
function dropHasFuture(type: DroppableType, owner: Player, row: number): boolean {
  if (type === "FU" || type === "KY") return row !== lastRank(owner);
  if (type === "KE") return !inLastTwoRanks(owner, row);
  return true;
}

/** Whether `col` already holds an unpromoted FU owned by `owner` (二歩 check). */
function fileHasUnpromotedFu(
  board: Board,
  col: number,
  owner: Player,
): boolean {
  for (let r = 0; r < BOARD_SIZE; r++) {
    const p = board[r][col];
    if (p && p.owner === owner && p.type === "FU" && !p.promoted) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Applying a move (internal, no legality validation)
// ---------------------------------------------------------------------------

/**
 * Returns a NEW position with `move` applied by `mover`, performing no legality
 * validation beyond requiring a piece on the source square (for board moves).
 * Handles captures (→ mover's hand, reverted to base type), promotion, and drops
 * (→ removed from mover's hand). The active color flips to the opponent.
 */
function makeMoveUnchecked(pos: Position, move: Move, mover: Player): Position {
  const board = cloneBoard(pos.board);
  const hands = cloneHands(pos.hands);

  if (move.drop !== undefined) {
    const type = move.drop;
    const have = hands[mover][type] ?? 0;
    if (have <= 1) delete hands[mover][type];
    else hands[mover][type] = have - 1;
    board[move.to.row][move.to.col] = { type, owner: mover, promoted: false };
    return { board, hands, activeColor: opponent(mover) };
  }

  if (!move.from) {
    throw new Error("makeMoveUnchecked: board move missing `from`");
  }
  const piece = board[move.from.row][move.from.col];
  if (!piece) {
    throw new Error("makeMoveUnchecked: no piece on the source square");
  }

  // Capture: the captured piece reverts to its base, unpromoted type and joins
  // the mover's hand (the king cannot be captured in legal play — guarded).
  const captured = board[move.to.row][move.to.col];
  if (captured && captured.type !== "OU") {
    const base = captured.type as DroppableType;
    hands[mover][base] = (hands[mover][base] ?? 0) + 1;
  }

  board[move.from.row][move.from.col] = null;
  board[move.to.row][move.to.col] = {
    type: piece.type,
    owner: piece.owner,
    promoted: piece.promoted || move.promote === true,
  };

  return { board, hands, activeColor: opponent(mover) };
}

// ---------------------------------------------------------------------------
// Board-move generation
// ---------------------------------------------------------------------------

/** Pseudo-legal destination squares for the piece on `from` (own pieces block). */
function pseudoDestinations(pos: Position, from: Coord, piece: Piece): Coord[] {
  const { steps, slides } = movePattern(piece.type, piece.owner, piece.promoted);
  const b = pos.board;
  const res: Coord[] = [];

  for (const [dr, dc] of steps) {
    const r = from.row + dr;
    const c = from.col + dc;
    if (!inBounds(r, c)) continue;
    const t = b[r][c];
    if (!t || t.owner !== piece.owner) res.push({ row: r, col: c });
  }

  for (const [dr, dc] of slides) {
    let r = from.row + dr;
    let c = from.col + dc;
    while (inBounds(r, c)) {
      const t = b[r][c];
      if (!t) {
        res.push({ row: r, col: c });
      } else {
        if (t.owner !== piece.owner) res.push({ row: r, col: c });
        break;
      }
      r += dr;
      c += dc;
    }
  }

  return res;
}

/**
 * All fully legal board moves from `from` (for the piece sitting there), with
 * promotion variants. A move is legal only if it does not leave the mover's own
 * king in check. Returns an empty array when the square is empty.
 */
export function getLegalMoves(pos: Position, from: Coord): Move[] {
  if (!inBounds(from.row, from.col)) return [];
  const piece = pos.board[from.row][from.col];
  if (!piece) return [];
  const owner = piece.owner;

  const candidates: Move[] = [];
  for (const dest of pseudoDestinations(pos, from, piece)) {
    const promotable =
      canPromotePiece(piece) &&
      (inPromotionZone(owner, from.row) || inPromotionZone(owner, dest.row));

    if (promotable) {
      if (isForcedPromotion(piece.type, owner, dest.row)) {
        candidates.push({ from, to: dest, promote: true });
      } else {
        candidates.push({ from, to: dest, promote: false });
        candidates.push({ from, to: dest, promote: true });
      }
    } else {
      candidates.push({ from, to: dest, promote: false });
    }
  }

  return candidates.filter((m) => {
    const next = makeMoveUnchecked(pos, m, owner);
    return !isInCheck(next, owner);
  });
}

// ---------------------------------------------------------------------------
// Drop generation
// ---------------------------------------------------------------------------

/**
 * All legal drops of `dropType` for `player`. `checkUchifuzume` controls whether
 * the 打ち歩詰め (pawn-drop-mate) rule is enforced; it is disabled for the
 * nested escape-search to keep recursion bounded (see the module note on draws).
 */
function dropLegalMoves(
  pos: Position,
  player: Player,
  dropType: DroppableType,
  checkUchifuzume: boolean,
): Move[] {
  const count = pos.hands[player][dropType] ?? 0;
  if (count <= 0) return [];

  const b = pos.board;
  const moves: Move[] = [];

  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (b[r][c] !== null) continue; // drop only onto an empty square
      if (!dropHasFuture(dropType, player, r)) continue;
      if (dropType === "FU" && fileHasUnpromotedFu(b, c, player)) continue;

      const move: Move = { drop: dropType, to: { row: r, col: c } };
      const next = makeMoveUnchecked(pos, move, player);

      // A drop that leaves the mover's own king in check is illegal.
      if (isInCheck(next, player)) continue;

      // 打ち歩詰め: a FU drop delivering immediate checkmate is illegal.
      if (dropType === "FU" && checkUchifuzume) {
        const opp = opponent(player);
        if (isInCheck(next, opp) && !hasAnyLegalMove(next, opp, false)) {
          continue;
        }
      }

      moves.push(move);
    }
  }

  return moves;
}

/** All legal drops of `dropType` for the side to move. */
export function getLegalDrops(pos: Position, dropType: DroppableType): Move[] {
  return dropLegalMoves(pos, pos.activeColor, dropType, true);
}

// ---------------------------------------------------------------------------
// All legal moves / status
// ---------------------------------------------------------------------------

/** Every legal move (board moves + drops) for `player`. */
export function getAllLegalMoves(pos: Position, player: Player): Move[] {
  return enumerateLegalMoves(pos, player, true);
}

function enumerateLegalMoves(
  pos: Position,
  player: Player,
  checkUchifuzume: boolean,
): Move[] {
  const moves: Move[] = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const p = pos.board[r][c];
      if (p && p.owner === player) {
        moves.push(...getLegalMoves(pos, { row: r, col: c }));
      }
    }
  }
  for (const type of DROPPABLE_TYPES) {
    moves.push(...dropLegalMoves(pos, player, type, checkUchifuzume));
  }
  return moves;
}

/** Whether `player` has at least one legal move (early-exit). */
function hasAnyLegalMove(
  pos: Position,
  player: Player,
  checkUchifuzume: boolean,
): boolean {
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const p = pos.board[r][c];
      if (p && p.owner === player && getLegalMoves(pos, { row: r, col: c }).length > 0) {
        return true;
      }
    }
  }
  for (const type of DROPPABLE_TYPES) {
    if (dropLegalMoves(pos, player, type, checkUchifuzume).length > 0) return true;
  }
  return false;
}

/**
 * The status for the side to move (`pos.activeColor`):
 *   - "checkmate": no legal move exists (the other side has won). Shogi has no
 *     stalemate — a no-legal-move position is always a loss for the side to move;
 *     in practice that side is in check, i.e. genuine checkmate.
 *   - "playing": at least one legal move exists.
 *
 * Draws by 千日手 (sennichite) / perpetual check are NOT implemented.
 */
export function getGameStatus(pos: Position): GameStatus {
  return hasAnyLegalMove(pos, pos.activeColor, true) ? "playing" : "checkmate";
}

// ---------------------------------------------------------------------------
// Applying a validated move
// ---------------------------------------------------------------------------

function coordEq(a: Coord | undefined, b: Coord | undefined): boolean {
  return !!a && !!b && a.row === b.row && a.col === b.col;
}

/** Whether two moves denote the same action (from/to/promote, or drop/to). */
export function movesEqual(a: Move, b: Move): boolean {
  const aDrop = a.drop !== undefined;
  const bDrop = b.drop !== undefined;
  if (aDrop || bDrop) {
    return aDrop && bDrop && a.drop === b.drop && coordEq(a.to, b.to);
  }
  return (
    coordEq(a.from, b.from) &&
    coordEq(a.to, b.to) &&
    (a.promote === true) === (b.promote === true)
  );
}

/**
 * Applies a move to the position, returning a NEW position. Throws when the move
 * is not legal for the side to move (wrong turn, illegal destination, forbidden
 * drop, promotion mismatch, etc.).
 */
export function applyMove(pos: Position, move: Move): Position {
  const legal = getAllLegalMoves(pos, pos.activeColor);
  const match = legal.find((m) => movesEqual(m, move));
  if (!match) {
    throw new Error("applyMove: illegal move");
  }
  return makeMoveUnchecked(pos, match, pos.activeColor);
}
