"use client";

import type { Board as BoardType, Player } from "../lib/engine";

export const cellKey = (row: number, col: number) => `${row},${col}`;

const MARK: Record<Player, string> = { o: "○", x: "×" };
const MARK_COLOR: Record<Player, string> = {
  o: "text-sky-400",
  x: "text-rose-400",
};

export default function Board({
  board,
  myRole,
  interactive,
  lastMove,
  winningLine,
  onCellClick,
}: {
  board: BoardType;
  /** The viewer's mark, used to preview where they'd play on hover. */
  myRole: Player | null;
  interactive: boolean;
  lastMove: { row: number; col: number } | null;
  winningLine: Array<[number, number]> | null;
  onCellClick: (row: number, col: number) => void;
}) {
  const winSet = new Set((winningLine ?? []).map(([r, c]) => cellKey(r, c)));

  return (
    <div
      className="grid aspect-square w-full grid-cols-3 gap-2 rounded-2xl bg-raised p-2 sm:gap-3 sm:p-3"
      data-testid="board"
    >
      {board.map((rowCells, row) =>
        rowCells.map((cell, col) => {
          const key = cellKey(row, col);
          const clickable = interactive && cell === null;
          const isWin = winSet.has(key);
          const isLast =
            lastMove !== null && lastMove.row === row && lastMove.col === col;

          return (
            <button
              key={key}
              type="button"
              disabled={!clickable}
              onClick={clickable ? () => onCellClick(row, col) : undefined}
              aria-label={
                cell
                  ? `行${row + 1} 列${col + 1}：${cell === "o" ? "○" : "×"}`
                  : clickable
                    ? `行${row + 1} 列${col + 1} に置く`
                    : `行${row + 1} 列${col + 1}：空き`
              }
              data-testid={`cell-${row}-${col}`}
              data-mark={cell ?? "empty"}
              className={[
                "group flex items-center justify-center rounded-xl border text-5xl font-bold leading-none transition sm:text-6xl",
                isWin
                  ? "border-accent/70 bg-accent/10"
                  : "border-line bg-surface",
                clickable
                  ? "cursor-pointer hover:border-accent/40 active:scale-[0.98]"
                  : "cursor-default",
                isLast && !isWin ? "ring-1 ring-accent/40" : "",
              ].join(" ")}
            >
              {cell ? (
                <span className={MARK_COLOR[cell]}>{MARK[cell]}</span>
              ) : (
                clickable &&
                myRole && (
                  <span
                    aria-hidden
                    className={`opacity-0 transition group-hover:opacity-30 ${MARK_COLOR[myRole]}`}
                  >
                    {MARK[myRole]}
                  </span>
                )
              )}
            </button>
          );
        }),
      )}
    </div>
  );
}
