"use client";

import { useState } from "react";
import {
  getDropRow,
  isColumnPlayable,
  type Board as BoardType,
  type Player,
} from "../lib/engine";

export const cellKey = (row: number, col: number) => `${row},${col}`;

const DISC_COLOR: Record<Player, string> = {
  red: "bg-[#ef4444]",
  yellow: "bg-[#fbbf24]",
};

const DISC_LABEL: Record<Player, string> = { red: "赤", yellow: "黄" };

export default function Board({
  board,
  myRole,
  interactive,
  lastMove,
  winningLine,
  onColumnClick,
}: {
  board: BoardType;
  /** The viewer's disc, used to preview where they'd drop on hover. */
  myRole: Player | null;
  interactive: boolean;
  lastMove: { row: number; col: number } | null;
  winningLine: Array<[number, number]> | null;
  onColumnClick: (col: number) => void;
}) {
  const [hoverCol, setHoverCol] = useState<number | null>(null);
  const winSet = new Set((winningLine ?? []).map(([r, c]) => cellKey(r, c)));

  return (
    <div
      className="grid w-full grid-cols-7 gap-1.5 rounded-2xl bg-[#1d4ed8] p-2 shadow-inner sm:gap-2 sm:p-3"
      data-testid="board"
    >
      {board.map((rowCells, row) =>
        rowCells.map((cell, col) => {
          const key = cellKey(row, col);
          // A whole column is clickable on your turn — click anywhere in it.
          const clickable = interactive && isColumnPlayable(board, col);
          const isWin = winSet.has(key);
          const isLast =
            lastMove !== null && lastMove.row === row && lastMove.col === col;
          const dropRow = getDropRow(board, col);
          const showPreview =
            clickable && myRole !== null && hoverCol === col && dropRow === row;

          return (
            <button
              key={key}
              type="button"
              disabled={!clickable}
              onClick={clickable ? () => onColumnClick(col) : undefined}
              onMouseEnter={() => setHoverCol(col)}
              onMouseLeave={() =>
                setHoverCol((c) => (c === col ? null : c))
              }
              aria-label={
                cell
                  ? `行${row + 1} 列${col + 1}：${DISC_LABEL[cell]}`
                  : clickable
                    ? `列${col + 1} に落とす`
                    : `行${row + 1} 列${col + 1}：空き`
              }
              data-testid={`cell-${row}-${col}`}
              data-disc={cell ?? "empty"}
              className={[
                "flex aspect-square items-center justify-center rounded-full transition",
                clickable
                  ? "cursor-pointer hover:brightness-110 active:scale-[0.97]"
                  : "cursor-default",
              ].join(" ")}
            >
              <span
                aria-hidden
                className={[
                  "block h-[84%] w-[84%] rounded-full shadow-inner transition",
                  cell
                    ? DISC_COLOR[cell]
                    : showPreview && myRole
                      ? `${DISC_COLOR[myRole]} opacity-40`
                      : "bg-bg",
                  isWin
                    ? "ring-2 ring-white ring-offset-2 ring-offset-[#1d4ed8]"
                    : "",
                  isLast && !isWin ? "ring-2 ring-white/70" : "",
                ].join(" ")}
              />
            </button>
          );
        }),
      )}
    </div>
  );
}
