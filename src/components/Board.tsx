"use client";

import type { Board as BoardType } from "@/lib/reversi";

export const cellKey = (row: number, col: number) => `${row},${col}`;

export default function Board({
  board,
  hints,
  lastMove,
  interactive,
  onCellClick,
}: {
  board: BoardType;
  /** Keys ("r,c") of legal moves to hint; empty when it is not your turn. */
  hints: Set<string>;
  lastMove: { row: number; col: number } | null;
  interactive: boolean;
  onCellClick: (row: number, col: number) => void;
}) {
  return (
    <div
      className="reversi-board grid aspect-square w-full grid-cols-8 grid-rows-8 p-2 sm:p-3"
      data-testid="board"
    >
      {board.map((rowCells, row) =>
        rowCells.map((cell, col) => {
          const key = cellKey(row, col);
          const isHint = interactive && cell === null && hints.has(key);
          const isLast =
            lastMove !== null && lastMove.row === row && lastMove.col === col;
          const clickable = isHint;

          return (
            <button
              key={key}
              type="button"
              disabled={!clickable}
              onClick={clickable ? () => onCellClick(row, col) : undefined}
              aria-label={
                cell
                  ? `行${row + 1} 列${col + 1}：${cell === "black" ? "黒" : "白"}`
                  : isHint
                    ? `行${row + 1} 列${col + 1} に置く`
                    : `行${row + 1} 列${col + 1}：空き`
              }
              data-testid={`cell-${row}-${col}`}
              data-stone={cell ?? "empty"}
              data-hint={isHint ? "true" : "false"}
              className={[
                "reversi-cell flex items-center justify-center",
                clickable ? "cursor-pointer" : "cursor-default",
              ].join(" ")}
            >
              {cell && (
                <span
                  key={cell}
                  className={`stone ${cell === "black" ? "stone-black" : "stone-white"}`}
                />
              )}
              {isHint && <span className="move-hint" aria-hidden />}
              {isLast && <span className="last-move-ring" aria-hidden />}
            </button>
          );
        }),
      )}
    </div>
  );
}
