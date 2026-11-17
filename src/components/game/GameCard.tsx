import Link from "next/link";
import type { GameMeta } from "@/games/types";

function playersLabel(min: number, max: number): string {
  return min === max ? `${min}人` : `${min}〜${max}人`;
}

/** The colored thumbnail tile. Uses a real image when provided, else a motif. */
function Thumbnail({ game }: { game: GameMeta }) {
  const accent = game.accent ?? "var(--color-accent)";
  if (game.thumbnail) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={game.thumbnail}
        alt=""
        className="aspect-[16/10] w-full rounded-t-2xl object-cover"
      />
    );
  }
  return (
    <div
      aria-hidden
      className="flex aspect-[16/10] w-full items-center justify-center rounded-t-2xl"
      style={{
        background: `radial-gradient(120% 120% at 30% 20%, ${accent}2e, transparent 70%), var(--color-raised)`,
      }}
    >
      <span
        className="text-3xl font-bold tracking-tight"
        style={{ color: accent }}
      >
        {game.title.slice(0, 1)}
      </span>
    </div>
  );
}

function CardBody({ game }: { game: GameMeta }) {
  const available = game.status === "available";
  return (
    <>
      <Thumbnail game={game} />
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-base font-semibold text-ink">{game.title}</h3>
          <span
            className={[
              "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold",
              available
                ? "bg-accent/15 text-accent"
                : "bg-line/60 text-muted",
            ].join(" ")}
          >
            {available ? "プレイ可能" : "準備中"}
          </span>
        </div>
        <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-muted">
          {game.description}
        </p>
        <div className="mt-3 flex items-center gap-2 text-xs text-muted">
          <span>{game.category}</span>
          <span aria-hidden>·</span>
          <span>{playersLabel(game.minPlayers, game.maxPlayers)}</span>
        </div>
      </div>
    </>
  );
}

/**
 * A single catalog card. Playable games are a full-card link; coming-soon games
 * render as a non-interactive, visually muted card (never a dead link).
 */
export default function GameCard({ game }: { game: GameMeta }) {
  const base =
    "flex h-full w-full flex-col overflow-hidden rounded-2xl border border-line bg-surface";

  if (game.status === "available" && game.href) {
    return (
      <Link
        href={game.href}
        aria-label={`${game.title} を遊ぶ`}
        className={`${base} transition hover:border-accent/50 hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent active:scale-[0.99]`}
      >
        <CardBody game={game} />
      </Link>
    );
  }

  return (
    <div
      aria-disabled="true"
      className={`${base} cursor-not-allowed opacity-70`}
    >
      <CardBody game={game} />
    </div>
  );
}
