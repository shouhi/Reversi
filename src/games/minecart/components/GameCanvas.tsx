"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { GameStatus, Stage } from "../types";
import { useMinecartGame } from "../hooks/useMinecartGame";
import { SoundEngine } from "../lib/sound";

function fmt(ms: number | undefined): string {
  if (ms === undefined) return "--.--";
  return (ms / 1000).toFixed(2);
}

const DIFF_LABEL: Record<string, string> = {
  easy: "EASY",
  normal: "NORMAL",
  hard: "HARD",
};

export default function GameCanvas({
  stage,
  stageIndex,
  totalStages,
  soundOn,
  onToggleSound,
  onClear,
  onExit,
  onNext,
  hasNext,
}: {
  stage: Stage;
  stageIndex: number;
  totalStages: number;
  soundOn: boolean;
  onToggleSound: (on: boolean) => void;
  onClear: (timeMs: number) => void;
  onExit: () => void;
  onNext: () => void;
  hasNext: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const timeRef = useRef<HTMLSpanElement | null>(null);
  const progressRef = useRef<HTMLDivElement | null>(null);

  const [status, setStatus] = useState<GameStatus>("ready");
  const [lastTimeMs, setLastTimeMs] = useState<number | undefined>(undefined);

  // One sound engine per mount; keep its muted flag in sync.
  const sound = useMemo(() => new SoundEngine(!soundOn), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    sound.setMuted(!soundOn);
  }, [soundOn, sound]);
  useEffect(() => () => sound.dispose(), [sound]);

  const controls = useMinecartGame({
    canvasRef,
    timeRef,
    progressRef,
    stage,
    sound,
    onStatus: (s, meta) => {
      setStatus(s);
      if (s === "cleared" && meta?.timeMs !== undefined) {
        setLastTimeMs(meta.timeMs);
        onClear(meta.timeMs);
      }
      if (s === "dead" && meta?.timeMs !== undefined) {
        setLastTimeMs(meta.timeMs);
      }
    },
  });

  return (
    <div className="mx-auto w-full max-w-5xl select-none">
      {/* HUD */}
      <div className="mb-2 flex items-center gap-3 px-1">
        <span className="text-xs font-semibold tracking-wide text-muted">
          {DIFF_LABEL[stage.difficulty]} · {stageIndex + 1}/{totalStages}
        </span>
        <span className="truncate text-sm font-medium text-ink">{stage.name}</span>
        <span className="ml-auto font-mono text-sm tabular-nums text-ink">
          <span ref={timeRef}>0.00</span>s
        </span>
        <button
          type="button"
          onClick={() => onToggleSound(!soundOn)}
          aria-label={soundOn ? "サウンドをオフ" : "サウンドをオン"}
          className="rounded-lg border border-line bg-surface px-2 py-1 text-xs text-muted transition hover:text-ink"
        >
          {soundOn ? "🔊" : "🔇"}
        </button>
        <button
          type="button"
          onClick={() => controls.togglePause()}
          aria-label="ポーズ"
          data-testid="pause-button"
          className="rounded-lg border border-line bg-surface px-3 py-1 text-xs font-semibold text-ink transition hover:bg-raised"
        >
          Ⅱ
        </button>
      </div>

      {/* progress bar */}
      <div className="mb-2 h-1.5 w-full overflow-hidden rounded-full bg-line/50">
        <div
          ref={progressRef}
          className="h-full rounded-full bg-accent transition-[width] duration-75"
          style={{ width: "0%" }}
        />
      </div>

      {/* play area */}
      <div className="relative w-full overflow-hidden rounded-2xl border border-line bg-black">
        <canvas
          ref={canvasRef}
          data-testid="game-canvas"
          className="block aspect-[16/9] max-h-[70vh] w-full touch-none"
        />

        {status === "ready" && (
          <Overlay>
            <h2 className="text-xl font-bold text-ink">{stage.name}</h2>
            <p className="mt-1 text-sm text-muted">
              タップ / スペース / クリックでジャンプ
            </p>
            <button
              type="button"
              data-testid="start-button"
              onClick={() => controls.start()}
              className="mt-5 rounded-xl bg-accent px-10 py-3 text-base font-semibold text-black transition active:scale-[0.98]"
            >
              スタート
            </button>
          </Overlay>
        )}

        {status === "paused" && (
          <Overlay>
            <h2 className="text-xl font-bold text-ink">ポーズ中</h2>
            <div className="mt-5 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => controls.togglePause()}
                className="rounded-xl bg-accent px-8 py-3 text-sm font-semibold text-black active:scale-[0.98]"
              >
                再開
              </button>
              <OverlaySecondary onRetry={() => controls.retry()} onExit={onExit} />
            </div>
          </Overlay>
        )}

        {status === "dead" && (
          <Overlay tone="fail">
            <h2 className="text-2xl font-bold text-red-400" data-testid="fail-title">
              ミス！
            </h2>
            <p className="mt-1 text-sm text-muted">もう一度挑戦しよう</p>
            <div className="mt-5 flex flex-col gap-2">
              <button
                type="button"
                data-testid="retry-button"
                onClick={() => controls.retry()}
                className="rounded-xl bg-accent px-10 py-3 text-base font-semibold text-black active:scale-[0.98]"
              >
                リトライ（R）
              </button>
              <button
                type="button"
                onClick={onExit}
                className="rounded-xl border border-line bg-surface px-6 py-2.5 text-sm font-medium text-ink"
              >
                ステージ選択へ
              </button>
            </div>
          </Overlay>
        )}

        {status === "cleared" && (
          <Overlay tone="clear">
            <h2 className="text-2xl font-bold text-accent" data-testid="clear-title">
              ステージクリア！
            </h2>
            <p className="mt-2 text-sm text-muted">
              タイム <span className="font-mono text-ink">{fmt(lastTimeMs)}</span> 秒
            </p>
            <div className="mt-5 flex flex-col gap-2">
              {hasNext && (
                <button
                  type="button"
                  data-testid="next-button"
                  onClick={onNext}
                  className="rounded-xl bg-accent px-10 py-3 text-base font-semibold text-black active:scale-[0.98]"
                >
                  次のステージへ
                </button>
              )}
              <button
                type="button"
                onClick={() => controls.retry()}
                className="rounded-xl border border-line bg-surface px-6 py-2.5 text-sm font-medium text-ink"
              >
                もう一度
              </button>
              <button
                type="button"
                onClick={onExit}
                className="rounded-xl border border-line bg-surface px-6 py-2.5 text-sm font-medium text-ink"
              >
                ステージ選択へ
              </button>
            </div>
          </Overlay>
        )}
      </div>

      <p className="mt-3 text-center text-xs text-muted">
        操作：タップ / Space / ↑ / クリック でジャンプ · R リトライ · Esc ポーズ
      </p>
    </div>
  );
}

function Overlay({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "fail" | "clear";
}) {
  const ring =
    tone === "fail"
      ? "bg-black/55"
      : tone === "clear"
        ? "bg-black/50"
        : "bg-black/45";
  return (
    <div
      className={`absolute inset-0 flex flex-col items-center justify-center text-center ${ring} backdrop-blur-[2px]`}
    >
      {children}
    </div>
  );
}

function OverlaySecondary({
  onRetry,
  onExit,
}: {
  onRetry: () => void;
  onExit: () => void;
}) {
  return (
    <>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-xl border border-line bg-surface px-6 py-2.5 text-sm font-medium text-ink"
      >
        リトライ
      </button>
      <button
        type="button"
        onClick={onExit}
        className="rounded-xl border border-line bg-surface px-6 py-2.5 text-sm font-medium text-ink"
      >
        ステージ選択へ
      </button>
    </>
  );
}
