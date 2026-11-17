import { describe, it, expect } from "vitest";
import {
  type Board,
  type Color,
  type PieceType,
  type Position,
  BOARD_SIZE,
  applyMove,
  clonePosition,
  createEmptyBoard,
  createInitialPosition,
  findKing,
  getAllLegalMoves,
  getGameStatus,
  getLegalMoves,
  inBounds,
  isInCheck,
  isSquareAttacked,
  opponent,
  sameSquare,
} from "./engine";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function place(board: Board, row: number, col: number, type: PieceType, color: Color): void {
  board[row][col] = { type, color };
}

/** An otherwise-empty position with just the two kings in safe corners. */
function kingsOnly(activeColor: Color): Position {
  const board = createEmptyBoard();
  place(board, 7, 4, "k", "white");
  place(board, 0, 4, "k", "black");
  return {
    board,
    activeColor,
    castling: { wK: false, wQ: false, bK: false, bQ: false },
    enPassant: null,
  };
}

function movesTo(moves: ReturnType<typeof getLegalMoves>, row: number, col: number): boolean {
  return moves.some((m) => m.to.row === row && m.to.col === col);
}

// ---------------------------------------------------------------------------
// Board setup
// ---------------------------------------------------------------------------

describe("createInitialPosition", () => {
  it("places the standard starting position", () => {
    const pos = createInitialPosition();
    expect(pos.activeColor).toBe("white");
    expect(pos.enPassant).toBeNull();
    expect(pos.castling).toEqual({ wK: true, wQ: true, bK: true, bQ: true });

    // Back ranks.
    const order: PieceType[] = ["r", "n", "b", "q", "k", "b", "n", "r"];
    for (let c = 0; c < BOARD_SIZE; c++) {
      expect(pos.board[0][c]).toEqual({ type: order[c], color: "black" });
      expect(pos.board[7][c]).toEqual({ type: order[c], color: "white" });
      expect(pos.board[1][c]).toEqual({ type: "p", color: "black" });
      expect(pos.board[6][c]).toEqual({ type: "p", color: "white" });
    }
    // Empty middle.
    for (let r = 2; r <= 5; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        expect(pos.board[r][c]).toBeNull();
      }
    }
  });

  it("finds each king on its starting square", () => {
    const pos = createInitialPosition();
    expect(findKing(pos, "white")).toEqual({ row: 7, col: 4 });
    expect(findKing(pos, "black")).toEqual({ row: 0, col: 4 });
  });

  it("opponent / sameSquare / inBounds behave", () => {
    expect(opponent("white")).toBe("black");
    expect(opponent("black")).toBe("white");
    expect(sameSquare({ row: 1, col: 2 }, { row: 1, col: 2 })).toBe(true);
    expect(sameSquare({ row: 1, col: 2 }, { row: 2, col: 1 })).toBe(false);
    expect(inBounds(0, 0)).toBe(true);
    expect(inBounds(7, 7)).toBe(true);
    expect(inBounds(-1, 0)).toBe(false);
    expect(inBounds(0, 8)).toBe(false);
  });

  it("clonePosition does not alias the original", () => {
    const pos = createInitialPosition();
    const copy = clonePosition(pos);
    copy.board[6][4] = null;
    copy.activeColor = "black";
    expect(pos.board[6][4]).toEqual({ type: "p", color: "white" });
    expect(pos.activeColor).toBe("white");
  });
});

// ---------------------------------------------------------------------------
// Opening move counts
// ---------------------------------------------------------------------------

describe("initial legal moves", () => {
  it("White has exactly 20 legal moves (16 pawn + 4 knight)", () => {
    const pos = createInitialPosition();
    const all = getAllLegalMoves(pos, "white");
    expect(all).toHaveLength(20);

    // 16 pawn moves: each of 8 pawns can go one or two squares.
    const pawnMoves = all.filter((m) => m.from.row === 6);
    expect(pawnMoves).toHaveLength(16);

    // 4 knight moves from b1 (7,1) and g1 (7,6).
    const knightMoves = all.filter((m) => m.from.row === 7 && (m.from.col === 1 || m.from.col === 6));
    expect(knightMoves).toHaveLength(4);
  });

  it("the opening is 'playing', not check/mate/stalemate", () => {
    const pos = createInitialPosition();
    expect(getGameStatus(pos)).toBe("playing");
    expect(isInCheck(pos, "white")).toBe(false);
    expect(isInCheck(pos, "black")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Pawns
// ---------------------------------------------------------------------------

describe("pawn movement", () => {
  it("double-step is allowed only from the start rank", () => {
    const pos = createInitialPosition();
    const fromStart = getLegalMoves(pos, { row: 6, col: 4 }); // e2
    expect(movesTo(fromStart, 5, 4)).toBe(true); // e3
    expect(movesTo(fromStart, 4, 4)).toBe(true); // e4

    // A white pawn already advanced to row 5 cannot double-step.
    const board = createEmptyBoard();
    place(board, 7, 4, "k", "white");
    place(board, 0, 4, "k", "black");
    place(board, 5, 4, "p", "white");
    const advanced: Position = {
      board,
      activeColor: "white",
      castling: { wK: false, wQ: false, bK: false, bQ: false },
      enPassant: null,
    };
    const m = getLegalMoves(advanced, { row: 5, col: 4 });
    expect(movesTo(m, 4, 4)).toBe(true); // one step
    expect(movesTo(m, 3, 4)).toBe(false); // no two steps off the start rank
  });

  it("is blocked when the square ahead is occupied", () => {
    // Blocking the square directly ahead removes all forward moves.
    const board = createEmptyBoard();
    place(board, 7, 4, "k", "white");
    place(board, 0, 4, "k", "black");
    place(board, 6, 0, "p", "white"); // a2
    place(board, 5, 0, "p", "black"); // a3 blocker directly ahead
    const pos: Position = {
      board,
      activeColor: "white",
      castling: { wK: false, wQ: false, bK: false, bQ: false },
      enPassant: null,
    };
    const m = getLegalMoves(pos, { row: 6, col: 0 });
    expect(movesTo(m, 5, 0)).toBe(false);
    expect(movesTo(m, 4, 0)).toBe(false);

    // A blocker two squares ahead allows the single step but not the double.
    const board2 = createEmptyBoard();
    place(board2, 7, 4, "k", "white");
    place(board2, 0, 4, "k", "black");
    place(board2, 6, 0, "p", "white"); // a2
    place(board2, 4, 0, "p", "black"); // a4 blocks the double step only
    const pos2: Position = {
      board: board2,
      activeColor: "white",
      castling: { wK: false, wQ: false, bK: false, bQ: false },
      enPassant: null,
    };
    const m2 = getLegalMoves(pos2, { row: 6, col: 0 });
    expect(movesTo(m2, 5, 0)).toBe(true);
    expect(movesTo(m2, 4, 0)).toBe(false);
  });

  it("captures diagonally but not straight ahead", () => {
    const board = createEmptyBoard();
    place(board, 7, 4, "k", "white");
    place(board, 0, 4, "k", "black");
    place(board, 4, 4, "p", "white"); // e4
    place(board, 3, 3, "p", "black"); // d5 (capturable)
    place(board, 3, 4, "p", "black"); // e5 (blocks forward, not capturable)
    const pos: Position = {
      board,
      activeColor: "white",
      castling: { wK: false, wQ: false, bK: false, bQ: false },
      enPassant: null,
    };
    const m = getLegalMoves(pos, { row: 4, col: 4 });
    expect(movesTo(m, 3, 3)).toBe(true); // diagonal capture
    expect(movesTo(m, 3, 4)).toBe(false); // blocked ahead
    expect(movesTo(m, 3, 5)).toBe(false); // nothing to capture
  });
});

// ---------------------------------------------------------------------------
// En passant
// ---------------------------------------------------------------------------

describe("en passant", () => {
  function enPassantSetup(): Position {
    // White pawn on e5 (3,4); black pawn ready to play d7-d5 (1,3 -> 3,3).
    const board = createEmptyBoard();
    place(board, 7, 4, "k", "white");
    place(board, 0, 4, "k", "black");
    place(board, 3, 4, "p", "white"); // e5
    place(board, 1, 3, "p", "black"); // d7
    return {
      board,
      activeColor: "black",
      castling: { wK: false, wQ: false, bK: false, bQ: false },
      enPassant: null,
    };
  }

  it("captures the passing pawn and removes it", () => {
    const start = enPassantSetup();
    // Black double-steps d7-d5, creating the en passant target on d6 (2,3).
    const afterPush = applyMove(start, { from: { row: 1, col: 3 }, to: { row: 3, col: 3 } });
    expect(afterPush.enPassant).toEqual({ row: 2, col: 3 });
    expect(afterPush.activeColor).toBe("white");

    const whiteMoves = getLegalMoves(afterPush, { row: 3, col: 4 }); // white e5 pawn
    const ep = whiteMoves.find((m) => m.to.row === 2 && m.to.col === 3);
    expect(ep).toBeTruthy();
    expect(ep?.flags?.enPassant).toBe(true);

    const afterEp = applyMove(afterPush, { from: { row: 3, col: 4 }, to: { row: 2, col: 3 } });
    expect(afterEp.board[2][3]).toEqual({ type: "p", color: "white" }); // moved pawn
    expect(afterEp.board[3][3]).toBeNull(); // captured black pawn removed
    expect(afterEp.board[3][4]).toBeNull(); // old square vacated
  });

  it("is only available on the immediately following move", () => {
    const start = enPassantSetup();
    const afterPush = applyMove(start, { from: { row: 1, col: 3 }, to: { row: 3, col: 3 } });
    expect(afterPush.enPassant).toEqual({ row: 2, col: 3 });

    // White plays an unrelated king move instead of capturing.
    const afterKing = applyMove(afterPush, { from: { row: 7, col: 4 }, to: { row: 7, col: 5 } });
    expect(afterKing.enPassant).toBeNull();
    expect(afterKing.activeColor).toBe("black");

    // Black moves; white no longer has the en passant option.
    const afterBlack = applyMove(afterKing, { from: { row: 0, col: 4 }, to: { row: 0, col: 5 } });
    const whiteMoves = getLegalMoves(afterBlack, { row: 3, col: 4 });
    expect(whiteMoves.some((m) => m.to.row === 2 && m.to.col === 3)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Promotion
// ---------------------------------------------------------------------------

describe("promotion", () => {
  function promoSetup(): Position {
    const board = createEmptyBoard();
    place(board, 7, 4, "k", "white");
    place(board, 0, 7, "k", "black"); // out of the way
    place(board, 1, 0, "p", "white"); // a7, one step from promoting
    return {
      board,
      activeColor: "white",
      castling: { wK: false, wQ: false, bK: false, bQ: false },
      enPassant: null,
    };
  }

  it("offers all four promotion pieces on the last rank", () => {
    const pos = promoSetup();
    const moves = getLegalMoves(pos, { row: 1, col: 0 }).filter((m) => m.to.row === 0 && m.to.col === 0);
    const promos = moves.map((m) => m.promotion).sort();
    expect(promos).toEqual(["b", "n", "q", "r"]);
    expect(moves.every((m) => m.flags?.promotion)).toBe(true);
  });

  it("defaults to a queen when no promotion piece is given", () => {
    const pos = promoSetup();
    const after = applyMove(pos, { from: { row: 1, col: 0 }, to: { row: 0, col: 0 } });
    expect(after.board[0][0]).toEqual({ type: "q", color: "white" });
  });

  it("allows under-promotion to a knight", () => {
    const pos = promoSetup();
    const after = applyMove(pos, {
      from: { row: 1, col: 0 },
      to: { row: 0, col: 0 },
      promotion: "n",
    });
    expect(after.board[0][0]).toEqual({ type: "n", color: "white" });
  });
});

// ---------------------------------------------------------------------------
// Castling
// ---------------------------------------------------------------------------

describe("castling", () => {
  function castleSetup(rights = { wK: true, wQ: true, bK: false, bQ: false }): Position {
    const board = createEmptyBoard();
    place(board, 7, 4, "k", "white"); // e1
    place(board, 7, 0, "r", "white"); // a1
    place(board, 7, 7, "r", "white"); // h1
    place(board, 0, 4, "k", "black"); // e8, far away
    return {
      board,
      activeColor: "white",
      castling: rights,
      enPassant: null,
    };
  }

  it("allows kingside castling and places king+rook correctly", () => {
    const pos = castleSetup();
    const moves = getLegalMoves(pos, { row: 7, col: 4 });
    const castle = moves.find((m) => m.to.col === 6 && m.flags?.castle === "K");
    expect(castle).toBeTruthy();

    const after = applyMove(pos, { from: { row: 7, col: 4 }, to: { row: 7, col: 6 } });
    expect(after.board[7][6]).toEqual({ type: "k", color: "white" }); // g1
    expect(after.board[7][5]).toEqual({ type: "r", color: "white" }); // f1
    expect(after.board[7][4]).toBeNull();
    expect(after.board[7][7]).toBeNull();
    expect(after.castling.wK).toBe(false);
    expect(after.castling.wQ).toBe(false);
  });

  it("allows queenside castling and places king+rook correctly", () => {
    const pos = castleSetup();
    const moves = getLegalMoves(pos, { row: 7, col: 4 });
    const castle = moves.find((m) => m.to.col === 2 && m.flags?.castle === "Q");
    expect(castle).toBeTruthy();

    const after = applyMove(pos, { from: { row: 7, col: 4 }, to: { row: 7, col: 2 } });
    expect(after.board[7][2]).toEqual({ type: "k", color: "white" }); // c1
    expect(after.board[7][3]).toEqual({ type: "r", color: "white" }); // d1
    expect(after.board[7][4]).toBeNull();
    expect(after.board[7][0]).toBeNull();
  });

  it("is forbidden when the castling right has been lost", () => {
    const pos = castleSetup({ wK: false, wQ: false, bK: false, bQ: false });
    const moves = getLegalMoves(pos, { row: 7, col: 4 });
    expect(moves.some((m) => Math.abs(m.to.col - 4) === 2)).toBe(false);
  });

  it("is forbidden when a square between king and rook is occupied", () => {
    const pos = castleSetup();
    place(pos.board, 7, 6, "n", "white"); // g1 knight blocks kingside
    place(pos.board, 7, 1, "n", "white"); // b1 knight blocks queenside
    const moves = getLegalMoves(pos, { row: 7, col: 4 });
    expect(moves.some((m) => m.flags?.castle)).toBe(false);
  });

  it("is forbidden while the king is in check (cannot castle out of check)", () => {
    const pos = castleSetup();
    place(pos.board, 0, 4, "k", "black"); // keep black king
    place(pos.board, 3, 4, "r", "black"); // black rook checks the e-file king
    expect(isInCheck(pos, "white")).toBe(true);
    const moves = getLegalMoves(pos, { row: 7, col: 4 });
    expect(moves.some((m) => m.flags?.castle)).toBe(false);
  });

  it("is forbidden when the king passes through an attacked square", () => {
    const pos = castleSetup();
    place(pos.board, 0, 5, "r", "black"); // f-file rook attacks f1 (the pass-through square)
    const moves = getLegalMoves(pos, { row: 7, col: 4 });
    expect(moves.some((m) => m.flags?.castle === "K")).toBe(false);
    // Queenside is unaffected (d1/c1 not attacked).
    expect(moves.some((m) => m.flags?.castle === "Q")).toBe(true);
  });

  it("is forbidden when the king would land on an attacked square", () => {
    const pos = castleSetup();
    place(pos.board, 0, 6, "r", "black"); // g-file rook attacks g1 (the landing square)
    const moves = getLegalMoves(pos, { row: 7, col: 4 });
    expect(moves.some((m) => m.flags?.castle === "K")).toBe(false);
  });

  it("permits castling even when the b1 square is attacked (only b1, queenside)", () => {
    // The b-file square (b1) is not crossed by the king, so queenside castling
    // remains legal even if b1 is attacked.
    const pos = castleSetup();
    place(pos.board, 0, 1, "r", "black"); // b-file rook attacks b1 only
    const moves = getLegalMoves(pos, { row: 7, col: 4 });
    expect(moves.some((m) => m.flags?.castle === "Q")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Pins — a move that exposes your own king is rejected
// ---------------------------------------------------------------------------

describe("pins and self-check", () => {
  it("a fully pinned knight has no legal moves", () => {
    const board = createEmptyBoard();
    place(board, 7, 4, "k", "white"); // e1
    place(board, 4, 4, "n", "white"); // e4 knight, pinned on the e-file
    place(board, 0, 4, "r", "black"); // e8 rook pins it
    place(board, 0, 0, "k", "black");
    const pos: Position = {
      board,
      activeColor: "white",
      castling: { wK: false, wQ: false, bK: false, bQ: false },
      enPassant: null,
    };
    expect(getLegalMoves(pos, { row: 4, col: 4 })).toHaveLength(0);
  });

  it("a pinned rook may move along the pin line but not off it", () => {
    const board = createEmptyBoard();
    place(board, 7, 4, "k", "white"); // e1
    place(board, 4, 4, "r", "white"); // e4 rook, pinned on the e-file
    place(board, 0, 4, "r", "black"); // e8 rook
    place(board, 0, 0, "k", "black");
    const pos: Position = {
      board,
      activeColor: "white",
      castling: { wK: false, wQ: false, bK: false, bQ: false },
      enPassant: null,
    };
    const m = getLegalMoves(pos, { row: 4, col: 4 });
    // Along the file: can advance and can capture the pinning rook.
    expect(movesTo(m, 3, 4)).toBe(true); // e5
    expect(movesTo(m, 0, 4)).toBe(true); // captures the e8 rook
    // Off the file would expose the king.
    expect(movesTo(m, 4, 3)).toBe(false);
    expect(movesTo(m, 4, 5)).toBe(false);
  });

  it("must respond to a check (only king escapes / blocks / captures count)", () => {
    const board = createEmptyBoard();
    place(board, 7, 4, "k", "white"); // e1
    place(board, 6, 0, "p", "white"); // a2 pawn, irrelevant to the check
    place(board, 7, 0, "r", "black"); // a1 rook gives check along rank 1
    place(board, 0, 0, "k", "black");
    const pos: Position = {
      board,
      activeColor: "white",
      castling: { wK: false, wQ: false, bK: false, bQ: false },
      enPassant: null,
    };
    expect(isInCheck(pos, "white")).toBe(true);
    // The a2 pawn cannot help, so it has no legal move.
    expect(getLegalMoves(pos, { row: 6, col: 0 })).toHaveLength(0);
    // The game is not over — the king can step off rank 1.
    expect(getGameStatus(pos)).toBe("playing");
    const kingMoves = getLegalMoves(pos, { row: 7, col: 4 });
    expect(movesTo(kingMoves, 6, 4)).toBe(true); // e2 escapes
  });

  it("isSquareAttacked reports attackers of each type", () => {
    const pos = kingsOnly("white");
    place(pos.board, 4, 4, "q", "black");
    // Queen on e4 attacks along rank/file/diagonal.
    expect(isSquareAttacked(pos, { row: 4, col: 0 }, "black")).toBe(true); // rank
    expect(isSquareAttacked(pos, { row: 7, col: 4 }, "black")).toBe(true); // file (the white king!)
    expect(isSquareAttacked(pos, { row: 6, col: 6 }, "black")).toBe(true); // diagonal
    expect(isSquareAttacked(pos, { row: 5, col: 6 }, "black")).toBe(false); // knight-ish, not a line
  });
});

// ---------------------------------------------------------------------------
// Checkmate (Fool's mate) & stalemate
// ---------------------------------------------------------------------------

describe("checkmate — Fool's mate", () => {
  it("1. f3 e5 2. g4 Qh4# is checkmate, Black wins", () => {
    let pos = createInitialPosition();
    // 1. f3  (white pawn f2 -> f3): (6,5) -> (5,5)
    pos = applyMove(pos, { from: { row: 6, col: 5 }, to: { row: 5, col: 5 } });
    // 1... e5 (black pawn e7 -> e5): (1,4) -> (3,4)
    pos = applyMove(pos, { from: { row: 1, col: 4 }, to: { row: 3, col: 4 } });
    // 2. g4  (white pawn g2 -> g4): (6,6) -> (4,6)
    pos = applyMove(pos, { from: { row: 6, col: 6 }, to: { row: 4, col: 6 } });
    // 2... Qh4# (black queen d8 -> h4): (0,3) -> (4,7)
    pos = applyMove(pos, { from: { row: 0, col: 3 }, to: { row: 4, col: 7 } });

    expect(pos.activeColor).toBe("white");
    expect(isInCheck(pos, "white")).toBe(true);
    expect(getGameStatus(pos)).toBe("checkmate");
    // The mover (Black) wins: winner = opponent of the mated side to move.
    expect(opponent(pos.activeColor)).toBe("black");
  });
});

describe("stalemate", () => {
  it("recognises a classic king-in-the-corner stalemate (draw)", () => {
    // Black to move: Ka8, no legal move, and NOT in check.
    const board = createEmptyBoard();
    place(board, 0, 0, "k", "black"); // a8
    place(board, 2, 1, "q", "white"); // b6
    place(board, 2, 2, "k", "white"); // c6
    const pos: Position = {
      board,
      activeColor: "black",
      castling: { wK: false, wQ: false, bK: false, bQ: false },
      enPassant: null,
    };
    expect(isInCheck(pos, "black")).toBe(false);
    expect(getAllLegalMoves(pos, "black")).toHaveLength(0);
    expect(getGameStatus(pos)).toBe("stalemate");
  });
});

// ---------------------------------------------------------------------------
// applyMove validation
// ---------------------------------------------------------------------------

describe("applyMove validation", () => {
  it("throws on an empty source square", () => {
    const pos = createInitialPosition();
    expect(() => applyMove(pos, { from: { row: 4, col: 4 }, to: { row: 3, col: 4 } })).toThrow();
  });

  it("throws when moving the wrong color", () => {
    const pos = createInitialPosition(); // white to move
    expect(() => applyMove(pos, { from: { row: 1, col: 4 }, to: { row: 3, col: 4 } })).toThrow();
  });

  it("throws on an illegal destination", () => {
    const pos = createInitialPosition();
    // Knight b1 cannot jump to b3.
    expect(() => applyMove(pos, { from: { row: 7, col: 1 }, to: { row: 5, col: 1 } })).toThrow();
  });

  it("does not mutate the input position", () => {
    const pos = createInitialPosition();
    applyMove(pos, { from: { row: 6, col: 4 }, to: { row: 4, col: 4 } });
    expect(pos.board[6][4]).toEqual({ type: "p", color: "white" });
    expect(pos.board[4][4]).toBeNull();
    expect(pos.activeColor).toBe("white");
  });

  it("flips the active color after a legal move", () => {
    const pos = createInitialPosition();
    const after = applyMove(pos, { from: { row: 6, col: 4 }, to: { row: 4, col: 4 } });
    expect(after.activeColor).toBe("black");
    expect(after.enPassant).toEqual({ row: 5, col: 4 }); // e3 target
  });
});
