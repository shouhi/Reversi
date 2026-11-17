"use client";

import { GRID_SIZE, type Player } from "../lib/engine";
import type { PublicCard } from "../types";

/** Symbol colour for a matched card, tinted by its owner. */
const OWNER_TEXT: Record<Player, string> = {
  p1: "text-sky-400",
  p2: "text-pink-400",
};
/** Border + fill for a matched card, tinted by its owner. */
const OWNER_TILE: Record<Player, string> = {
  p1: "border-sky-400/60 bg-sky-400/10",
  p2: "border-pink-400/60 bg-pink-400/10",
};

const ownerLabel = (p: Player) => (p === "p1" ? "プレイヤー1" : "プレイヤー2");

export default function Board({
  cards,
  interactive,
  onCardClick,
}: {
  cards: PublicCard[];
  interactive: boolean;
  onCardClick: (index: number) => void;
}) {
  return (
    <div
      className="grid aspect-square w-full grid-cols-4 gap-2 rounded-2xl bg-raised p-2 sm:gap-3 sm:p-3"
      data-testid="board"
    >
      {cards.map((card, index) => {
        const row = Math.floor(index / GRID_SIZE);
        const col = index % GRID_SIZE;

        const isMatched = card.matchedBy !== null;
        const isUp = !isMatched && card.value !== null;
        const isDown = card.value === null;
        const clickable = interactive && isDown;

        const dataCard = isMatched
          ? `matched-${card.matchedBy}`
          : isUp
            ? `up-${card.value}`
            : "down";

        const ariaLabel = isMatched
          ? `行${row + 1} 列${col + 1}：${card.value}（${ownerLabel(
              card.matchedBy as Player,
            )}が獲得）`
          : isUp
            ? `行${row + 1} 列${col + 1}：${card.value}`
            : clickable
              ? `行${row + 1} 列${col + 1}：裏向きのカードをめくる`
              : `行${row + 1} 列${col + 1}：裏向きのカード`;

        return (
          <button
            key={index}
            type="button"
            disabled={!clickable}
            onClick={clickable ? () => onCardClick(index) : undefined}
            aria-label={ariaLabel}
            data-testid={`cell-${row}-${col}`}
            data-card={dataCard}
            className={[
              "flex items-center justify-center rounded-xl border text-4xl font-bold leading-none transition sm:text-5xl",
              isMatched
                ? `${OWNER_TILE[card.matchedBy as Player]} opacity-90`
                : isUp
                  ? "border-accent/70 bg-surface"
                  : "border-line bg-surface",
              clickable
                ? "cursor-pointer hover:border-accent/50 active:scale-[0.97]"
                : "cursor-default",
            ].join(" ")}
          >
            {isMatched ? (
              <span className={OWNER_TEXT[card.matchedBy as Player]}>
                {card.value}
              </span>
            ) : isUp ? (
              <span className="text-ink">{card.value}</span>
            ) : (
              <span
                aria-hidden
                className="text-2xl font-black text-accent/40 sm:text-3xl"
              >
                ?
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
