"use client";

/**
 * Shared same-room rematch control (Phase 12 PR-B). Used by every turn-based
 * game's result panel so the rematch UX is identical everywhere. A rematch
 * starts only when BOTH players ask for one, so this reflects four states:
 * offer, waiting-for-opponent, accept (the opponent asked first), and starting
 * (both agreed). The `rematch` prop is each game's public `RematchView`
 * projection (`youRequested` / `opponentRequested`).
 */
export interface RematchControlsProps {
  rematch: { youRequested: boolean; opponentRequested: boolean };
  onRematch: () => void;
  busy: boolean;
}

export default function RematchControls({
  rematch,
  onRematch,
  busy,
}: RematchControlsProps) {
  const { youRequested, opponentRequested } = rematch;

  if (youRequested && opponentRequested) {
    return (
      <p
        className="mt-6 rounded-xl bg-accent/15 px-4 py-3 text-sm font-semibold text-accent ring-1 ring-accent/40"
        data-testid="rematch-starting"
      >
        次の試合を開始します…
      </p>
    );
  }

  if (youRequested) {
    return (
      <p
        className="mt-6 rounded-xl bg-surface px-4 py-3 text-sm text-muted"
        data-testid="rematch-waiting"
      >
        相手の返事を待っています…
      </p>
    );
  }

  return (
    <div className="mt-6">
      {opponentRequested && (
        <p
          className="mb-3 text-sm font-medium text-accent"
          data-testid="rematch-opponent"
        >
          相手が再戦を希望しています
        </p>
      )}
      <button
        type="button"
        onClick={onRematch}
        disabled={busy}
        data-testid="rematch"
        className="w-full rounded-xl bg-accent px-6 py-4 text-base font-semibold text-black transition active:scale-[0.98] disabled:opacity-60"
      >
        {busy ? "送信中…" : opponentRequested ? "再戦を承諾する" : "もう一度遊ぶ"}
      </button>
    </div>
  );
}
