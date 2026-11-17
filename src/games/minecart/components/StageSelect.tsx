"use client";

import type { Difficulty, MinecartProgress, Stage } from "../types";

const DIFF: { key: Difficulty; label: string; color: string }[] = [
  { key: "easy", label: "EASY", color: "#34d399" },
  { key: "normal", label: "NORMAL", color: "#60a5fa" },
  { key: "hard", label: "HARD", color: "#f87171" },
];

function fmt(ms: number | undefined): string {
  return ms === undefined ? "" : `${(ms / 1000).toFixed(2)}s`;
}

export default function StageSelect({
  stages,
  progress,
  onSelect,
  onToggleSound,
}: {
  stages: Stage[];
  progress: MinecartProgress;
  onSelect: (index: number) => void;
  onToggleSound: (on: boolean) => void;
}) {
  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <CartMark />
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-ink">
              トロッコダッシュ
            </h1>
            <p className="text-sm text-muted">
              自動で走るトロッコを、タップでジャンプ。鉱山を駆け抜けよう。
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => onToggleSound(!progress.sound)}
          aria-label={progress.sound ? "サウンドをオフ" : "サウンドをオン"}
          className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-muted transition hover:text-ink"
        >
          {progress.sound ? "🔊" : "🔇"}
        </button>
      </div>

      <section className="mb-6 rounded-xl border border-line bg-surface p-4 text-sm text-muted">
        <span className="font-semibold text-ink">遊び方：</span>
        タップ / スペース / クリックでジャンプ。線路の切れ目や障害物を飛び越えてゴールを目指そう。コウモリは跳ばずにくぐり抜ける。失敗してもすぐにリトライできます。
      </section>

      {DIFF.map((d) => {
        const items = stages
          .map((s, i) => ({ s, i }))
          .filter((x) => x.s.difficulty === d.key);
        return (
          <section key={d.key} className="mb-8">
            <h2
              className="mb-3 text-sm font-bold tracking-widest"
              style={{ color: d.color }}
            >
              {d.label}
            </h2>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {items.map(({ s, i }) => {
                const unlocked = i < progress.unlocked;
                const cleared = progress.cleared.includes(s.id);
                const best = progress.bestMs[s.id];
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      disabled={!unlocked}
                      data-testid={`stage-${s.id}`}
                      onClick={() => unlocked && onSelect(i)}
                      className={[
                        "flex w-full flex-col gap-2 rounded-xl border p-3 text-left transition",
                        unlocked
                          ? "border-line bg-surface hover:border-accent/50 hover:bg-raised active:scale-[0.99]"
                          : "cursor-not-allowed border-line/60 bg-surface/50 opacity-55",
                      ].join(" ")}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-muted">
                          STAGE {i + 1}
                        </span>
                        {!unlocked ? (
                          <span aria-label="未解放" className="text-sm">
                            🔒
                          </span>
                        ) : cleared ? (
                          <span
                            aria-label="クリア済み"
                            className="text-sm text-accent"
                          >
                            ✓
                          </span>
                        ) : null}
                      </div>
                      <StageThumb color={d.color} locked={!unlocked} />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-ink">
                          {unlocked ? s.name : "？？？"}
                        </div>
                        <div className="h-4 text-xs text-muted">
                          {cleared && best !== undefined ? `ベスト ${fmt(best)}` : " "}
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function CartMark() {
  return (
    <svg width="40" height="34" viewBox="0 0 40 34" aria-hidden>
      <rect x="6" y="10" width="28" height="12" rx="2" fill="#8a5a2c" />
      <rect x="6" y="10" width="28" height="3" fill="#d4a860" />
      <circle cx="13" cy="26" r="5" fill="#2d2824" stroke="#b9833f" strokeWidth="1.5" />
      <circle cx="27" cy="26" r="5" fill="#2d2824" stroke="#b9833f" strokeWidth="1.5" />
      <rect x="2" y="31" width="36" height="2" fill="#4b5751" />
    </svg>
  );
}

function StageThumb({ color, locked }: { color: string; locked: boolean }) {
  return (
    <div
      className="relative h-16 w-full overflow-hidden rounded-lg"
      style={{
        background:
          "radial-gradient(120% 120% at 30% 10%, #1b2d26, #06100d 80%)",
      }}
    >
      {/* rail */}
      <div className="absolute bottom-3 left-0 right-0 h-0.5" style={{ background: "#4b5751" }} />
      {/* gap */}
      <div className="absolute bottom-3 left-[55%] h-0.5 w-5 bg-transparent" style={{ background: "#06100d" }} />
      {/* cart */}
      <div
        className="absolute bottom-[14px] left-5 h-3.5 w-6 rounded-sm"
        style={{ background: locked ? "#3a3330" : "#8a5a2c" }}
      />
      {/* accent spark */}
      <div
        className="absolute right-3 top-3 h-2 w-2 rounded-full"
        style={{ background: locked ? "#3a3330" : color, opacity: 0.9 }}
      />
    </div>
  );
}
