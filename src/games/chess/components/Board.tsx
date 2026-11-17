"use client";

import type { Color, Coord, PieceType, Position } from "../lib/engine";
import type { LastMove } from "../types";

export const squareKey = (row: number, col: number) => `${row},${col}`;

/** Unicode glyphs for each piece. */
const GLYPH: Record<Color, Record<PieceType, string>> = {
  white: { k: "♔", q: "♕", r: "♖", b: "♗", n: "♘", p: "♙" },
  black: { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" },
};

const TYPE_NAME_JA: Record<PieceType, string> = {
  k: "キング",
  q: "クイーン",
  r: "ルーク",
  b: "ビショップ",
  n: "ナイト",
  p: "ポーン",
};

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];

/** Converts logical (row,col) to algebraic like "e4" for aria labels. */
function algebraic(row: number, col: number): string {
  return `${FILES[col]}${8 - row}`;
}

const range = [0, 1, 2, 3, 4, 5, 6, 7];

export default function Board({
  position,
  interactive,
  selected,
  legalTargets,
  lastMove,
  checkSquare,
  flipped,
  onSquareClick,
}: {
  position: Position;
  interactive: boolean;
  selected: Coord | null;
  /** Keys ("row,col") of legal destination squares for the selected piece. */
  legalTargets: Set<string>;
  lastMove: LastMove | null;
  /** The king's square when it is in check, else null. */
  checkSquare: Coord | null;
  /** When true, render from Black's perspective (own pieces at the bottom). */
  flipped: boolean;
  onSquareClick: (row: number, col: number) => void;
}) {
  const board = position.board;
  const rowOrder = flipped ? [...range].reverse() : range;
  const colOrder = flipped ? [...range].reverse() : range;

  const lastFromKey = lastMove ? squareKey(lastMove.from.row, lastMove.from.col) : null;
  const lastToKey = lastMove ? squareKey(lastMove.to.row, lastMove.to.col) : null;
  const checkKey = checkSquare ? squareKey(checkSquare.row, checkSquare.col) : null;
  const selectedKey = selected ? squareKey(selected.row, selected.col) : null;

  return (
    <div
      className="grid aspect-square w-full grid-cols-8 overflow-hidden rounded-xl border border-line bg-raised shadow-xl"
      data-testid="board"
      role="grid"
      aria-label="チェス盤"
    >
      {rowOrder.map((row) =>
        colOrder.map((col) => {
          const key = squareKey(row, col);
          const piece = board[row][col];
          const dataPiece = piece ? `${piece.color[0]}${piece.type}` : "empty";
          const isLight = (row + col) % 2 === 0;
          const isSelected = selectedKey === key;
          const isTarget = legalTargets.has(key);
          const isCaptureTarget = isTarget && piece !== null;
          const isLast = lastFromKey === key || lastToKey === key;
          const isCheck = checkKey === key;
          const clickable = interactive;

          return (
            <button
              key={key}
              type="button"
              role="gridcell"
              disabled={!clickable}
              onClick={clickable ? () => onSquareClick(row, col) : undefined}
              data-testid={`cell-${row}-${col}`}
              data-piece={dataPiece}
              aria-label={
                piece
                  ? `${algebraic(row, col)} ${piece.color === "white" ? "白" : "黒"}の${TYPE_NAME_JA[piece.type]}`
                  : `${algebraic(row, col)} 空き`
              }
              className={[
                "relative flex aspect-square items-center justify-center text-3xl leading-none transition select-none sm:text-4xl",
                isCheck ? "ring-2 ring-inset ring-red-500" : "",
                isSelected ? "ring-2 ring-inset ring-accent" : "",
                isLast && !isSelected && !isCheck ? "ring-2 ring-inset ring-amber-400/70" : "",
                clickable ? "cursor-pointer" : "cursor-default",
              ].join(" ")}
              style={{
                backgroundColor: isLight ? "#ede3cf" : "#9a7b57",
              }}
            >
              {piece && (
                <span
                  aria-hidden
                  className={
                    piece.color === "white"
                      ? "text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.6)]"
                      : "text-zinc-900 drop-shadow-[0_1px_1px_rgba(255,255,255,0.3)]"
                  }
                >
                  {GLYPH[piece.color][piece.type]}
                </span>
              )}

              {/* Legal-move markers: a dot for a quiet move, a ring for a capture. */}
              {isTarget && !isCaptureTarget && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute h-1/4 w-1/4 rounded-full bg-accent/60"
                  data-testid={`target-${row}-${col}`}
                />
              )}
              {isCaptureTarget && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-1 rounded-full ring-4 ring-accent/60"
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
