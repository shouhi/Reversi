"use client";

import type { Coord, Piece, Position } from "../lib/engine";
import type { LastMove } from "../types";

export const squareKey = (row: number, col: number) => `${row},${col}`;

/** Lowercase type code used in `data-piece` (e.g. "fu", promoted "to"). */
export function pieceCode(piece: Piece): string {
  if (!piece.promoted) {
    return {
      FU: "fu",
      KY: "ky",
      KE: "ke",
      GI: "gi",
      KI: "ki",
      KA: "ka",
      HI: "hi",
      OU: "ou",
    }[piece.type];
  }
  // Promoted forms (KI / OU never promote).
  return (
    {
      FU: "to",
      KY: "ny",
      KE: "nk",
      GI: "ng",
      KA: "um",
      HI: "ry",
    }[piece.type as "FU" | "KY" | "KE" | "GI" | "KA" | "HI"] ?? "ou"
  );
}

/** Kanji glyph for a type code. */
export const GLYPH: Record<string, string> = {
  fu: "歩",
  ky: "香",
  ke: "桂",
  gi: "銀",
  ki: "金",
  ka: "角",
  hi: "飛",
  ou: "玉",
  to: "と",
  ny: "杏",
  nk: "圭",
  ng: "全",
  um: "馬",
  ry: "龍",
};

export function dataPiece(piece: Piece | null): string {
  if (!piece) return "empty";
  return `${piece.owner === "sente" ? "s" : "g"}${pieceCode(piece)}`;
}

const range = [0, 1, 2, 3, 4, 5, 6, 7, 8];

export default function Board({
  position,
  interactive,
  selected,
  legalTargets,
  lastMove,
  checkSquare,
  onSquareClick,
}: {
  position: Position;
  interactive: boolean;
  /** The currently selected board square (own piece), if any. */
  selected: Coord | null;
  /** Keys ("row,col") of legal destination squares for the current selection. */
  legalTargets: Set<string>;
  lastMove: LastMove | null;
  /** The king's square when the side to move is in check, else null. */
  checkSquare: Coord | null;
  onSquareClick: (row: number, col: number) => void;
}) {
  const board = position.board;

  const lastFromKey =
    lastMove && lastMove.from
      ? squareKey(lastMove.from.row, lastMove.from.col)
      : null;
  const lastToKey = lastMove ? squareKey(lastMove.to.row, lastMove.to.col) : null;
  const checkKey = checkSquare ? squareKey(checkSquare.row, checkSquare.col) : null;
  const selectedKey = selected ? squareKey(selected.row, selected.col) : null;

  return (
    <div
      className="grid aspect-square w-full grid-cols-9 overflow-hidden rounded-md border-2 border-amber-950/60 shadow-xl"
      style={{ backgroundColor: "#eccf9b" }}
      data-testid="board"
      role="grid"
      aria-label="将棋盤"
    >
      {range.map((row) =>
        range.map((col) => {
          const key = squareKey(row, col);
          const piece = board[row][col];
          const isSelected = selectedKey === key;
          const isTarget = legalTargets.has(key);
          const isCaptureTarget = isTarget && piece !== null;
          const isLast = lastFromKey === key || lastToKey === key;
          const isCheck = checkKey === key;

          return (
            <button
              key={key}
              type="button"
              role="gridcell"
              disabled={!interactive}
              onClick={interactive ? () => onSquareClick(row, col) : undefined}
              data-testid={`cell-${row}-${col}`}
              data-piece={dataPiece(piece)}
              aria-label={
                piece
                  ? `${row + 1}行${col + 1}列 ${
                      piece.owner === "sente" ? "先手" : "後手"
                    }の${GLYPH[pieceCode(piece)]}`
                  : `${row + 1}行${col + 1}列 空き`
              }
              className={[
                "relative flex aspect-square items-center justify-center border border-amber-950/25 text-[4vw] font-semibold leading-none transition select-none sm:text-2xl",
                isCheck ? "bg-red-500/30" : "",
                isSelected ? "bg-accent/40" : "",
                isLast && !isSelected && !isCheck ? "bg-amber-400/30" : "",
                interactive ? "cursor-pointer" : "cursor-default",
              ].join(" ")}
            >
              {piece && (
                <span
                  aria-hidden
                  className={[
                    "text-zinc-900",
                    piece.owner === "gote" ? "rotate-180" : "",
                    piece.promoted &&
                    (piece.type === "KA" ||
                      piece.type === "HI" ||
                      piece.type === "FU" ||
                      piece.type === "KY" ||
                      piece.type === "KE" ||
                      piece.type === "GI")
                      ? "text-red-700"
                      : "",
                  ].join(" ")}
                >
                  {GLYPH[pieceCode(piece)]}
                </span>
              )}

              {/* Legal-move markers: a dot for a quiet move, a ring for a capture. */}
              {isTarget && !isCaptureTarget && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute h-1/3 w-1/3 rounded-full bg-accent/70"
                  data-testid={`target-${row}-${col}`}
                />
              )}
              {isCaptureTarget && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0.5 rounded-sm ring-4 ring-accent/70"
                  data-testid={`target-${row}-${col}`}
                />
              )}
            </button>
          );
        }),
      )}
    </div>
  );
}
