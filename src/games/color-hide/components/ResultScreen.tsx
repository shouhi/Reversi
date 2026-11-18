"use client";

import { useEffect, useRef, useState } from "react";
import { apiReturnToLobby } from "../lib/clientApi";
import { sharedAudio } from "../lib/audio";
import type { PublicPlayer, PublicRoomState } from "../types";

interface ResultScreenProps {
  roomId: string;
  state: PublicRoomState;
  me: PublicPlayer;
  onChanged: (state: PublicRoomState) => void;
}

export default function ResultScreen({ roomId, state, me, onChanged }: ResultScreenProps) {
  const [busy, setBusy] = useState(false);
  const result = state.result;
  const nameOf = (id: string) => state.players.find((p) => p.id === id)?.nickname ?? "?";

  // My side won if the winner matches my role (hiders or seeker).
  const iWon = result ? result.winner === me.role : false;

  // Play the win/lose cue ONCE when the result screen appears. `state.result` is a
  // new object on every poll (~1.5s), so guard with a ref — otherwise the jingle
  // would re-fire each poll. Server-confirmed outcome (only exists in `result`).
  const cuePlayed = useRef(false);
  useEffect(() => {
    if (!result || cuePlayed.current) return;
    cuePlayed.current = true;
    sharedAudio().play(iWon ? "win" : "lose");
  }, [result, iWon]);

  if (!result) return null;
  const hidersWon = result.winner === "hider";

  async function playAgain() {
    sharedAudio().play("ui");
    setBusy(true);
    const res = await apiReturnToLobby(roomId);
    setBusy(false);
    if (res.ok) onChanged(res.data.publicState);
  }

  return (
    <div className="mx-auto max-w-xl text-center">
      <div
        className="rounded-2xl border p-8"
        style={{
          borderColor: hidersWon ? "#22c55e55" : "#f59e0b55",
          background: hidersWon ? "#22c55e12" : "#f59e0b12",
        }}
      >
        <div className="text-sm font-medium text-muted">ラウンド {state.round} 終了</div>
        <div className={`mt-1 text-5xl ${iWon ? "ch-win-pop" : "ch-lose-shake"}`} aria-hidden="true">
          {iWon ? "🎉" : "💦"}
        </div>
        {/* Personal outcome in words — never conveyed by colour alone. */}
        <div className={`mt-1 text-sm font-semibold ${iWon ? "text-emerald-300" : "text-amber-300"}`}>
          {iWon ? "WIN — あなたの勝ち" : "LOSE — あなたの負け"}
        </div>
        <h2 className="mt-2 text-3xl font-bold text-ink">
          {hidersWon ? "🙈 隠れる側の勝利！" : "👀 鬼の勝利！"}
        </h2>
        <p className="mt-2 text-sm text-muted">
          鬼：{nameOf(result.seekerId)}
        </p>

        <div className="mt-6 grid grid-cols-2 gap-3 text-left">
          <div className="rounded-lg bg-surface p-4 ring-1 ring-line">
            <div className="text-xs text-muted">逃げ切り（生存）</div>
            <div className="mt-1 text-2xl font-bold text-ink">{result.survivors.length}</div>
            <div className="mt-1 text-xs text-muted">
              {result.survivors.map(nameOf).join("、") || "—"}
            </div>
          </div>
          <div className="rounded-lg bg-surface p-4 ring-1 ring-line">
            <div className="text-xs text-muted">発見（捕獲）</div>
            <div className="mt-1 text-2xl font-bold text-ink">{result.caught.length}</div>
            <div className="mt-1 text-xs text-muted">
              {result.caught.map(nameOf).join("、") || "—"}
            </div>
          </div>
        </div>
      </div>

      {me.isHost ? (
        <button
          type="button"
          disabled={busy}
          onClick={playAgain}
          className="mt-6 rounded-lg bg-accent px-6 py-3 font-semibold text-bg disabled:opacity-50"
        >
          もう一度遊ぶ
        </button>
      ) : (
        <p className="mt-6 text-sm text-muted">ホストが次のラウンドを準備しています…</p>
      )}
    </div>
  );
}
