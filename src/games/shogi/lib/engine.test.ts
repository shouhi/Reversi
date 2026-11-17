import { describe, it, expect } from "vitest";
import {
  type Hands,
  type Move,
  type PieceType,
  type Player,
  type Position,
  BOARD_SIZE,
  applyMove,
  clonePosition,
  createEmptyBoard,
  createInitialPosition,
  findKing,
  getAllLegalMoves,
  getGameStatus,
  getLegalDrops,
  getLegalMoves,
  isInCheck,
  isSquareAttacked,
  opponent,
} from "./engine";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

type PieceSpec = [number, number, PieceType, Player, boolean?];

/** Builds a position from an explicit piece list. */
function pos(
  pieces: PieceSpec[],
  activeColor: Player,
  hands?: { sente?: Hands["sente"]; gote?: Hands["gote"] },
): Position {
  const board = createEmptyBoard();
  for (const [r, c, type, owner, promoted] of pieces) {
    board[r][c] = { type, owner, promoted: promoted ?? false };
  }
  return {
    board,
    hands: { sente: hands?.sente ?? {}, gote: hands?.gote ?? {} },
    activeColor,
  };
}

/** The set of "row,col" destination keys among moves. */
function destKeys(moves: Move[]): Set<string> {
  return new Set(moves.map((m) => `${m.to.row},${m.to.col}`));
}

/** Count of moves landing on a square (1 = single variant, 2 = promote + not). */
function countTo(moves: Move[], row: number, col: number): number {
  return moves.filter((m) => m.to.row === row && m.to.col === col).length;
}

function hasTo(
  moves: Move[],
  row: number,
  col: number,
  promote?: boolean,
): boolean {
  return moves.some(
    (m) =>
      m.to.row === row &&
      m.to.col === col &&
      (promote === undefined || (m.promote === true) === promote),
  );
}

const sq = (row: number, col: number) => ({ row, col });

// Kings tucked into opposite corners so they never interfere with a tested piece.
const SAFE_KINGS: PieceSpec[] = [
  [8, 8, "OU", "sente"],
  [0, 0, "OU", "gote"],
];

// ---------------------------------------------------------------------------
// Initial position
// ---------------------------------------------------------------------------

describe("createInitialPosition", () => {
  it("places the standard starting position with Sente to move", () => {
    const p = createInitialPosition();
    expect(p.activeColor).toBe("sente");
    expect(p.hands).toEqual({ sente: {}, gote: {} });
    expect(p.board).toHaveLength(BOARD_SIZE);

    const backRank: PieceType[] = [
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
    for (let c = 0; c < BOARD_SIZE; c++) {
      expect(p.board[8][c]).toEqual({
        type: backRank[c],
        owner: "sente",
        promoted: false,
      });
      expect(p.board[0][c]).toEqual({
        type: backRank[c],
        owner: "gote",
        promoted: false,
      });
      expect(p.board[6][c]).toEqual({
        type: "FU",
        owner: "sente",
        promoted: false,
      });
      expect(p.board[2][c]).toEqual({
        type: "FU",
        owner: "gote",
        promoted: false,
      });
    }

    // Sente bishop on the left, rook on the right; Gote mirrored.
    expect(p.board[7][1]).toEqual({ type: "KA", owner: "sente", promoted: false });
    expect(p.board[7][7]).toEqual({ type: "HI", owner: "sente", promoted: false });
    expect(p.board[1][1]).toEqual({ type: "HI", owner: "gote", promoted: false });
    expect(p.board[1][7]).toEqual({ type: "KA", owner: "gote", promoted: false });
  });

  it("has exactly 30 legal first moves for Sente", () => {
    const p = createInitialPosition();
    expect(getAllLegalMoves(p, "sente")).toHaveLength(30);
    expect(getGameStatus(p)).toBe("playing");
  });

  it("findKing locates both kings", () => {
    const p = createInitialPosition();
    expect(findKing(p, "sente")).toEqual(sq(8, 4));
    expect(findKing(p, "gote")).toEqual(sq(0, 4));
  });
});

// ---------------------------------------------------------------------------
// Unpromoted piece movement
// ---------------------------------------------------------------------------

describe("piece movement — unpromoted", () => {
  it("FU (pawn) moves one forward — Sente up, Gote down", () => {
    const sente = pos([...SAFE_KINGS, [6, 4, "FU", "sente"]], "sente");
    const sm = getLegalMoves(sente, sq(6, 4));
    expect(destKeys(sm)).toEqual(new Set(["5,4"]));
    expect(hasTo(sm, 5, 4, false)).toBe(true);

    const gote = pos([...SAFE_KINGS, [2, 4, "FU", "gote"]], "gote");
    const gm = getLegalMoves(gote, sq(2, 4));
    expect(destKeys(gm)).toEqual(new Set(["3,4"]));
  });

  it("KY (lance) slides forward, blocked by own, captures enemy", () => {
    // Blocked by a friendly piece two squares ahead.
    const blocked = pos(
      [...SAFE_KINGS, [8, 0, "KY", "sente"], [6, 0, "FU", "sente"]],
      "sente",
    );
    expect(destKeys(getLegalMoves(blocked, sq(8, 0)))).toEqual(new Set(["7,0"]));

    // Clear until an enemy piece, which it may capture.
    const capture = pos(
      [[8, 0, "KY", "sente"], [5, 0, "FU", "gote"], [8, 8, "OU", "sente"], [0, 8, "OU", "gote"]],
      "sente",
    );
    expect(destKeys(getLegalMoves(capture, sq(8, 0)))).toEqual(
      new Set(["7,0", "6,0", "5,0"]),
    );
  });

  it("KE (knight) jumps two forward and one aside, over pieces", () => {
    const p = pos(
      [
        ...SAFE_KINGS,
        [6, 4, "KE", "sente"],
        [5, 3, "FU", "sente"],
        [5, 4, "FU", "gote"],
        [5, 5, "FU", "sente"],
      ],
      "sente",
    );
    expect(destKeys(getLegalMoves(p, sq(6, 4)))).toEqual(new Set(["4,3", "4,5"]));
  });

  it("GI (silver) moves to five squares (not straight back / sideways)", () => {
    const p = pos([...SAFE_KINGS, [4, 4, "GI", "sente"]], "sente");
    const m = getLegalMoves(p, sq(4, 4));
    expect(destKeys(m)).toEqual(
      new Set(["3,4", "3,3", "3,5", "5,3", "5,5"]),
    );
    expect(hasTo(m, 5, 4)).toBe(false); // not straight back
    expect(hasTo(m, 4, 3)).toBe(false); // not sideways
    expect(hasTo(m, 4, 5)).toBe(false);
  });

  it("KI (gold) moves to six squares (not back diagonals)", () => {
    const p = pos([...SAFE_KINGS, [4, 4, "KI", "sente"]], "sente");
    const m = getLegalMoves(p, sq(4, 4));
    expect(destKeys(m)).toEqual(
      new Set(["3,4", "3,3", "3,5", "4,3", "4,5", "5,4"]),
    );
    expect(hasTo(m, 5, 3)).toBe(false);
    expect(hasTo(m, 5, 5)).toBe(false);
  });

  it("KA (bishop) slides diagonally; blocked by own, captures enemy", () => {
    const p = pos(
      [
        [4, 4, "KA", "sente"],
        [2, 2, "GI", "sente"], // own blocker up-left
        [2, 6, "FU", "gote"], // enemy up-right (capturable)
        [8, 0, "OU", "sente"],
        [0, 8, "OU", "gote"],
      ],
      "sente",
    );
    const m = getLegalMoves(p, sq(4, 4));
    const keys = destKeys(m);
    // up-left stops before own silver at (2,2): only (3,3).
    expect(keys.has("3,3")).toBe(true);
    expect(keys.has("2,2")).toBe(false);
    // up-right reaches and captures the enemy at (2,6).
    expect(keys.has("3,5")).toBe(true);
    expect(keys.has("2,6")).toBe(true);
    expect(keys.has("1,7")).toBe(false);
    // down-right runs to the far corner; down-left stops before the own king (8,0).
    expect(keys.has("5,5")).toBe(true);
    expect(keys.has("8,8")).toBe(true);
    expect(keys.has("5,3")).toBe(true);
    expect(keys.has("7,1")).toBe(true);
    expect(keys.has("8,0")).toBe(false);
    // never moves orthogonally.
    expect(keys.has("4,5")).toBe(false);
    expect(keys.has("3,4")).toBe(false);
  });

  it("HI (rook) slides orthogonally; blocked by own, captures enemy", () => {
    const p = pos(
      [
        [4, 4, "HI", "sente"],
        [4, 6, "GI", "sente"], // own blocker to the right
        [6, 4, "FU", "gote"], // enemy below (capturable)
        [8, 0, "OU", "sente"],
        [0, 8, "OU", "gote"],
      ],
      "sente",
    );
    const keys = destKeys(getLegalMoves(p, sq(4, 4)));
    // right stops before own silver at (4,6): only (4,5).
    expect(keys.has("4,5")).toBe(true);
    expect(keys.has("4,6")).toBe(false);
    // down reaches and captures enemy at (6,4).
    expect(keys.has("5,4")).toBe(true);
    expect(keys.has("6,4")).toBe(true);
    expect(keys.has("7,4")).toBe(false);
    // up and left run clear.
    expect(keys.has("0,4")).toBe(true);
    expect(keys.has("4,0")).toBe(true);
    // never diagonal.
    expect(keys.has("3,3")).toBe(false);
  });

  it("OU (king) moves to all eight neighbours", () => {
    // The king under test IS the sente king, so there is no interference.
    const p = pos([[4, 4, "OU", "sente"], [0, 0, "OU", "gote"]], "sente");
    const m = getLegalMoves(p, sq(4, 4));
    expect(destKeys(m)).toEqual(
      new Set(["3,3", "3,4", "3,5", "4,3", "4,5", "5,3", "5,4", "5,5"]),
    );
    expect(m.every((x) => x.promote !== true)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Promoted piece movement
// ---------------------------------------------------------------------------

describe("piece movement — promoted", () => {
  const goldKeys = new Set(["3,4", "3,3", "3,5", "4,3", "4,5", "5,4"]);

  it("TO / NY / NK / NG all move like gold", () => {
    for (const type of ["FU", "KY", "KE", "GI"] as PieceType[]) {
      const p = pos([...SAFE_KINGS, [4, 4, type, "sente", true]], "sente");
      const m = getLegalMoves(p, sq(4, 4));
      expect(destKeys(m)).toEqual(goldKeys);
      // Already promoted — no further promote variants.
      expect(m.every((x) => x.promote !== true)).toBe(true);
    }
  });

  it("UM (promoted bishop) = bishop + one orthogonal step", () => {
    const p = pos([...SAFE_KINGS, [4, 4, "KA", "sente", true]], "sente");
    const keys = destKeys(getLegalMoves(p, sq(4, 4)));
    // Diagonal slides remain.
    expect(keys.has("3,3")).toBe(true);
    expect(keys.has("2,2")).toBe(true);
    // One orthogonal step each way.
    expect(keys.has("3,4")).toBe(true);
    expect(keys.has("5,4")).toBe(true);
    expect(keys.has("4,3")).toBe(true);
    expect(keys.has("4,5")).toBe(true);
    // But NOT two orthogonal squares.
    expect(keys.has("2,4")).toBe(false);
    expect(keys.has("4,6")).toBe(false);
  });

  it("RY (promoted rook) = rook + one diagonal step", () => {
    const p = pos([...SAFE_KINGS, [4, 4, "HI", "sente", true]], "sente");
    const keys = destKeys(getLegalMoves(p, sq(4, 4)));
    // Orthogonal slides remain.
    expect(keys.has("3,4")).toBe(true);
    expect(keys.has("2,4")).toBe(true);
    // One diagonal step each way.
    expect(keys.has("3,3")).toBe(true);
    expect(keys.has("3,5")).toBe(true);
    expect(keys.has("5,3")).toBe(true);
    expect(keys.has("5,5")).toBe(true);
    // But NOT two diagonal squares.
    expect(keys.has("2,2")).toBe(false);
    expect(keys.has("6,6")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Promotion (optional + forced)
// ---------------------------------------------------------------------------

describe("promotion", () => {
  it("offers both variants when ENTERING the zone (silver)", () => {
    const p = pos([...SAFE_KINGS, [3, 4, "GI", "sente"]], "sente");
    const m = getLegalMoves(p, sq(3, 4));
    // Forward into the zone (row 2): optional promotion → two variants.
    expect(countTo(m, 2, 4)).toBe(2);
    expect(hasTo(m, 2, 4, true)).toBe(true);
    expect(hasTo(m, 2, 4, false)).toBe(true);
    // Backward out of the zone (row 4): not promotable → single variant.
    expect(countTo(m, 4, 3)).toBe(1);
    expect(hasTo(m, 4, 3, false)).toBe(true);
  });

  it("offers both variants when LEAVING the zone (from-square in zone)", () => {
    const p = pos([...SAFE_KINGS, [2, 4, "GI", "sente"]], "sente");
    const m = getLegalMoves(p, sq(2, 4));
    // Moving from row 2 (in zone) down to row 3 (out) is still promotable.
    expect(countTo(m, 3, 3)).toBe(2);
    expect(hasTo(m, 3, 3, true)).toBe(true);
    expect(hasTo(m, 3, 3, false)).toBe(true);
  });

  it("forces FU promotion on the last rank", () => {
    const p = pos([...SAFE_KINGS, [1, 4, "FU", "sente"]], "sente");
    const m = getLegalMoves(p, sq(1, 4));
    expect(countTo(m, 0, 4)).toBe(1);
    expect(hasTo(m, 0, 4, true)).toBe(true);
    expect(hasTo(m, 0, 4, false)).toBe(false);
  });

  it("forces KY promotion on the last rank but not one rank short", () => {
    const p = pos(
      [[2, 0, "KY", "sente"], [8, 8, "OU", "sente"], [0, 8, "OU", "gote"]],
      "sente",
    );
    const m = getLegalMoves(p, sq(2, 0));
    // (0,0) last rank → forced; (1,0) in zone but optional.
    expect(countTo(m, 0, 0)).toBe(1);
    expect(hasTo(m, 0, 0, true)).toBe(true);
    expect(countTo(m, 1, 0)).toBe(2);
  });

  it("forces KE promotion on the last two ranks, optional deeper", () => {
    // From row 3, a knight lands on row 1 (last two ranks) → forced.
    const forced = pos([...SAFE_KINGS, [3, 4, "KE", "sente"]], "sente");
    const fm = getLegalMoves(forced, sq(3, 4));
    expect(countTo(fm, 1, 3)).toBe(1);
    expect(hasTo(fm, 1, 3, true)).toBe(true);
    expect(countTo(fm, 1, 5)).toBe(1);

    // From row 4, a knight lands on row 2 (zone but not last two) → optional.
    const optional = pos([...SAFE_KINGS, [4, 4, "KE", "sente"]], "sente");
    const om = getLegalMoves(optional, sq(4, 4));
    expect(countTo(om, 2, 3)).toBe(2);
    expect(countTo(om, 2, 5)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Captures → hand
// ---------------------------------------------------------------------------

describe("captures feed the hand", () => {
  it("captured piece reverts to base type in the capturer's hand", () => {
    const p = pos(
      [
        [4, 4, "HI", "sente"],
        [4, 6, "FU", "gote"],
        [8, 0, "OU", "sente"],
        [0, 8, "OU", "gote"],
      ],
      "sente",
    );
    const next = applyMove(p, { from: sq(4, 4), to: sq(4, 6), promote: false });
    expect(next.board[4][6]).toEqual({ type: "HI", owner: "sente", promoted: false });
    expect(next.board[4][4]).toBeNull();
    expect(next.hands.sente).toEqual({ FU: 1 });
    expect(next.activeColor).toBe("gote");
  });

  it("capturing a PROMOTED piece yields the unpromoted base type", () => {
    const p = pos(
      [
        [4, 4, "HI", "sente"],
        [4, 6, "KA", "gote", true], // an enemy 馬 (promoted bishop)
        [8, 0, "OU", "sente"],
        [0, 8, "OU", "gote"],
      ],
      "sente",
    );
    const next = applyMove(p, { from: sq(4, 4), to: sq(4, 6), promote: false });
    expect(next.hands.sente).toEqual({ KA: 1 });
  });
});

// ---------------------------------------------------------------------------
// Drops
// ---------------------------------------------------------------------------

describe("drops", () => {
  it("drops onto an empty square as an unpromoted, owned piece; turn passes", () => {
    const p = pos([...SAFE_KINGS], "sente", { sente: { GI: 1 } });
    const drops = getLegalDrops(p, "GI");
    expect(drops.length).toBeGreaterThan(0);
    const next = applyMove(p, { drop: "GI", to: sq(4, 4) });
    expect(next.board[4][4]).toEqual({ type: "GI", owner: "sente", promoted: false });
    expect(next.hands.sente.GI ?? 0).toBe(0);
    expect(next.activeColor).toBe("gote");
  });

  it("cannot drop onto an occupied square", () => {
    const p = pos([...SAFE_KINGS, [4, 4, "FU", "gote"]], "sente", {
      sente: { GI: 1 },
    });
    expect(hasTo(getLegalDrops(p, "GI"), 4, 4)).toBe(false);
  });

  it("二歩: forbids a FU drop in a file with an own unpromoted FU", () => {
    const p = pos([...SAFE_KINGS, [6, 4, "FU", "sente"]], "sente", {
      sente: { FU: 1 },
    });
    const drops = getLegalDrops(p, "FU");
    // No drop anywhere in column 4.
    expect(drops.some((m) => m.to.col === 4)).toBe(false);
    // Other files are fine.
    expect(drops.some((m) => m.to.col === 3)).toBe(true);
  });

  it("二歩: a promoted TO in the file does NOT block the FU drop", () => {
    const p = pos([...SAFE_KINGS, [6, 4, "FU", "sente", true]], "sente", {
      sente: { FU: 1 },
    });
    const drops = getLegalDrops(p, "FU");
    expect(drops.some((m) => m.to.col === 4)).toBe(true);
  });

  it("二歩: an enemy FU in the file does NOT block the drop", () => {
    const p = pos([...SAFE_KINGS, [2, 4, "FU", "gote"]], "sente", {
      sente: { FU: 1 },
    });
    expect(getLegalDrops(p, "FU").some((m) => m.to.col === 4)).toBe(true);
  });

  it("forbids FU / KY on the last rank and KE on the last two ranks", () => {
    const fu = pos([...SAFE_KINGS], "sente", { sente: { FU: 1 } });
    expect(getLegalDrops(fu, "FU").some((m) => m.to.row === 0)).toBe(false);

    const ky = pos([...SAFE_KINGS], "sente", { sente: { KY: 1 } });
    expect(getLegalDrops(ky, "KY").some((m) => m.to.row === 0)).toBe(false);

    const ke = pos([...SAFE_KINGS], "sente", { sente: { KE: 1 } });
    const keDrops = getLegalDrops(ke, "KE");
    expect(keDrops.some((m) => m.to.row === 0)).toBe(false);
    expect(keDrops.some((m) => m.to.row === 1)).toBe(false);
    expect(keDrops.some((m) => m.to.row === 2)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 打ち歩詰め (uchifuzume)
// ---------------------------------------------------------------------------

describe("打ち歩詰め (uchifuzume)", () => {
  // Shared mating frame: gote king cornered, Sente covers the escapes and
  // defends the mating square (1,0).
  const frame: PieceSpec[] = [
    [0, 0, "OU", "gote"],
    [2, 1, "GI", "sente"], // defends (1,0); covers (1,1)
    [1, 2, "KI", "sente"], // covers (0,1)
    [8, 8, "OU", "sente"],
  ];

  it("forbids a FU DROP that delivers immediate checkmate", () => {
    const p = pos(frame, "sente", { sente: { FU: 1 } });
    const drops = getLegalDrops(p, "FU");
    expect(hasTo(drops, 1, 0)).toBe(false); // the mating drop is illegal
    // (sanity) other, non-mating FU drops are still available.
    expect(drops.length).toBeGreaterThan(0);
  });

  it("allows the SAME mating square reached by a FU MOVE", () => {
    const p = pos([...frame, [2, 0, "FU", "sente"]], "sente");
    const moves = getLegalMoves(p, sq(2, 0));
    expect(hasTo(moves, 1, 0, false)).toBe(true);
    // And it is a genuine mate once played.
    const next = applyMove(p, { from: sq(2, 0), to: sq(1, 0), promote: false });
    expect(getGameStatus(next)).toBe("checkmate");
  });

  it("allows a FU drop that only gives CHECK (not mate)", () => {
    // King in the corner with no supporting Sente pieces: it can run or capture.
    const p = pos([[0, 0, "OU", "gote"], [8, 8, "OU", "sente"]], "sente", {
      sente: { FU: 1 },
    });
    expect(hasTo(getLegalDrops(p, "FU"), 1, 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Check, pins, and mandatory response
// ---------------------------------------------------------------------------

describe("check & pins", () => {
  it("a pinned piece has no legal move that exposes its king", () => {
    const p = pos(
      [
        [4, 4, "OU", "sente"],
        [4, 5, "GI", "sente"], // pinned along row 4
        [4, 8, "HI", "gote"], // pinning rook
        [0, 0, "OU", "gote"],
      ],
      "sente",
    );
    expect(isInCheck(p, "sente")).toBe(false); // silver blocks the check
    expect(getLegalMoves(p, sq(4, 5))).toHaveLength(0); // but it cannot move
  });

  it("while in check, an unrelated piece cannot move", () => {
    const p = pos(
      [
        [4, 4, "OU", "sente"],
        [4, 8, "HI", "gote"], // checking along row 4 (nothing between)
        [8, 8, "GI", "sente"], // an unrelated piece
        [0, 0, "OU", "gote"],
      ],
      "sente",
    );
    expect(isInCheck(p, "sente")).toBe(true);
    expect(getLegalMoves(p, sq(8, 8))).toHaveLength(0);
    // The king itself can still step off the file.
    expect(getLegalMoves(p, sq(4, 4)).length).toBeGreaterThan(0);
  });

  it("applyMove rejects a move that leaves the own king in check", () => {
    const p = pos(
      [
        [4, 4, "OU", "sente"],
        [4, 5, "GI", "sente"],
        [4, 8, "HI", "gote"],
        [0, 0, "OU", "gote"],
      ],
      "sente",
    );
    expect(() =>
      applyMove(p, { from: sq(4, 5), to: sq(3, 5), promote: false }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Checkmate
// ---------------------------------------------------------------------------

describe("checkmate", () => {
  it("recognises a head-gold mate (頭金)", () => {
    const p = pos(
      [
        [0, 4, "OU", "gote"],
        [1, 4, "KI", "sente"], // gives check, covers the escapes
        [2, 4, "GI", "sente"], // defends the gold
        [8, 4, "OU", "sente"],
      ],
      "gote",
    );
    expect(isInCheck(p, "gote")).toBe(true);
    expect(getAllLegalMoves(p, "gote")).toHaveLength(0);
    expect(getGameStatus(p)).toBe("checkmate");
  });

  it("is NOT mate when the check can be blocked by a DROP", () => {
    const frame: PieceSpec[] = [
      [0, 0, "OU", "gote"],
      [2, 0, "HI", "sente"], // rook checks up column 0
      [1, 2, "KI", "sente"], // covers (0,1) and (1,1)
      [8, 8, "OU", "sente"],
    ];
    // With an empty hand the king is mated.
    const mated = pos(frame, "gote");
    expect(getGameStatus(mated)).toBe("checkmate");

    // With a pawn in hand, interposing at (1,0) saves the king.
    const saved = pos(frame, "gote", { gote: { FU: 1 } });
    expect(getGameStatus(saved)).toBe("playing");
    const drops = getLegalDrops(saved, "FU");
    expect(hasTo(drops, 1, 0)).toBe(true);
    // The block is the only legal move.
    expect(getAllLegalMoves(saved, "gote")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// applyMove / misc
// ---------------------------------------------------------------------------

describe("applyMove", () => {
  it("applies a promotion and records the promoted piece", () => {
    const p = pos([...SAFE_KINGS, [1, 4, "GI", "sente"]], "sente");
    const next = applyMove(p, { from: sq(1, 4), to: sq(0, 4), promote: true });
    expect(next.board[0][4]).toEqual({ type: "GI", owner: "sente", promoted: true });
  });

  it("throws on an illegal move", () => {
    const p = createInitialPosition();
    expect(() =>
      applyMove(p, { from: sq(8, 1), to: sq(6, 1), promote: false }),
    ).toThrow();
  });

  it("does not mutate the input position", () => {
    const p = createInitialPosition();
    const snapshot = JSON.stringify(p);
    applyMove(p, { from: sq(6, 4), to: sq(5, 4), promote: false });
    expect(JSON.stringify(p)).toBe(snapshot);
  });

  it("clonePosition deep-copies board and hands", () => {
    const p = pos([...SAFE_KINGS], "sente", { sente: { FU: 2 } });
    const c = clonePosition(p);
    c.board[4][4] = { type: "FU", owner: "sente", promoted: false };
    c.hands.sente.FU = 0;
    expect(p.board[4][4]).toBeNull();
    expect(p.hands.sente.FU).toBe(2);
  });
});

describe("isSquareAttacked / opponent", () => {
  it("opponent flips the player", () => {
    expect(opponent("sente")).toBe("gote");
    expect(opponent("gote")).toBe("sente");
  });

  it("reports attacks from sliders and steppers", () => {
    const p = pos(
      [[4, 4, "HI", "sente"], [8, 8, "OU", "sente"], [0, 0, "OU", "gote"]],
      "sente",
    );
    expect(isSquareAttacked(p, sq(4, 0), "sente")).toBe(true); // along the rank
    expect(isSquareAttacked(p, sq(0, 4), "sente")).toBe(true); // along the file
    expect(isSquareAttacked(p, sq(3, 3), "sente")).toBe(false); // diagonal: no
  });
});
