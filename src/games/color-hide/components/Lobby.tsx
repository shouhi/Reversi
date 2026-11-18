"use client";

import { useState } from "react";
import {
  apiReturnToLobby,
  apiSelectMap,
  apiSetNickname,
  apiSetReady,
  apiStartGame,
} from "../lib/clientApi";
import { allMaps } from "../lib/maps";
import { MAX_PLAYERS, MIN_PLAYERS } from "../lib/constants";
import { getQualityPref, setQualityPref, type QualityPref } from "../lib/quality";
import { sharedAudio } from "../lib/audio";
import type { PublicPlayer, PublicRoomState } from "../types";

const QUALITY_OPTIONS: { value: QualityPref; label: string }[] = [
  { value: "auto", label: "自動" },
  { value: "high", label: "高" },
  { value: "low", label: "低" },
];

interface LobbyProps {
  roomId: string;
  state: PublicRoomState;
  me: PublicPlayer;
  onChanged: (state: PublicRoomState) => void;
}

export default function Lobby({ roomId, state, me, onChanged }: LobbyProps) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [nick, setNick] = useState(me.nickname);
  const [error, setError] = useState<string | null>(null);
  const [quality, setQuality] = useState<QualityPref>(() => getQualityPref());

  const isHost = me.isHost;
  const readyCount = state.players.filter((p) => p.ready).length;
  const canStart =
    state.players.length >= MIN_PLAYERS && state.players.every((p) => p.ready);

  async function run(fn: () => Promise<{ ok: boolean } & Record<string, unknown>>) {
    sharedAudio().play("ui");
    setBusy(true);
    setError(null);
    const res = (await fn()) as
      | { ok: true; data: { publicState: PublicRoomState } }
      | { ok: false; message: string };
    setBusy(false);
    if (res.ok) onChanged(res.data.publicState);
    else setError(res.message);
  }

  async function copyInvite() {
    const url = `${window.location.origin}/games/color-hide/room/${roomId}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("コピーに失敗しました。URLを手動で共有してください。");
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="space-y-6">
        {/* Invite */}
        <section className="rounded-xl border border-line bg-surface p-5">
          <h2 className="text-sm font-medium text-muted">招待</h2>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 truncate rounded-md bg-bg px-3 py-2 text-sm text-ink ring-1 ring-line">
              /games/color-hide/room/{roomId}
            </code>
            <button
              type="button"
              onClick={copyInvite}
              className="shrink-0 rounded-md bg-accent px-3 py-2 text-sm font-semibold text-bg"
            >
              {copied ? "コピー済み ✓" : "URLをコピー"}
            </button>
          </div>
          <p className="mt-2 text-xs text-muted">
            このURLを友達に送るだけで参加できます（最大{MAX_PLAYERS}人）。
          </p>
        </section>

        {/* Map picker */}
        <section className="rounded-xl border border-line bg-surface p-5">
          <h2 className="text-sm font-medium text-muted">
            マップ {isHost ? "（ホストが選択）" : ""}
          </h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {allMaps().map((m) => {
              const selected = state.mapId === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  disabled={!isHost || busy}
                  onClick={() => run(() => apiSelectMap(roomId, m.id))}
                  className={`rounded-lg border p-3 text-left transition ${
                    selected
                      ? "border-accent bg-raised"
                      : "border-line bg-bg hover:border-muted"
                  } ${!isHost ? "cursor-default opacity-90" : ""}`}
                >
                  <div className="text-sm font-semibold text-ink">{m.name}</div>
                  <div className="mt-1 text-xs leading-snug text-muted">{m.blurb}</div>
                </button>
              );
            })}
          </div>
        </section>
      </div>

      {/* Players + controls */}
      <div className="space-y-4">
        <section className="rounded-xl border border-line bg-surface p-5">
          <h2 className="text-sm font-medium text-muted">
            プレイヤー {state.players.length}/{MAX_PLAYERS}（準備 {readyCount}）
          </h2>
          <ul className="mt-3 space-y-2">
            {state.players.map((p) => (
              <li
                key={p.id}
                className="flex items-center gap-2 rounded-md bg-bg px-3 py-2 ring-1 ring-line"
              >
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${
                    p.connected ? "bg-accent" : "bg-muted"
                  }`}
                  title={p.connected ? "接続中" : "切断"}
                />
                <span className="flex-1 truncate text-sm text-ink">
                  {p.nickname}
                  {p.id === me.id && " (あなた)"}
                </span>
                {p.isHost && (
                  <span className="rounded bg-raised px-1.5 py-0.5 text-[10px] text-muted ring-1 ring-line">
                    HOST
                  </span>
                )}
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] ${
                    p.ready ? "bg-accent text-bg" : "bg-raised text-muted ring-1 ring-line"
                  }`}
                >
                  {p.ready ? "準備OK" : "準備中"}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-xl border border-line bg-surface p-5 space-y-3">
          <label className="block text-xs font-medium text-muted">
            ニックネーム
            <div className="mt-1 flex gap-2">
              <input
                value={nick}
                maxLength={20}
                onChange={(e) => setNick(e.target.value)}
                className="w-full rounded-md border border-line bg-bg px-3 py-2 text-ink outline-none focus:border-accent"
              />
              <button
                type="button"
                disabled={busy || nick.trim() === me.nickname}
                onClick={() => run(() => apiSetNickname(roomId, nick.trim()))}
                className="shrink-0 rounded-md bg-raised px-3 text-sm text-ink ring-1 ring-line disabled:opacity-40"
              >
                変更
              </button>
            </div>
          </label>

          <div className="text-xs font-medium text-muted">
            描画品質
            <div className="mt-1 flex gap-1">
              {QUALITY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    setQualityPref(opt.value);
                    setQuality(opt.value);
                  }}
                  className={`flex-1 rounded-md px-2 py-1.5 text-sm ring-1 ring-line ${
                    quality === opt.value ? "bg-accent text-bg" : "bg-bg text-ink"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[10px] text-muted">
              スマホで重い場合は「低」。次のラウンドから適用されます。
            </p>
          </div>

          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => apiSetReady(roomId, !me.ready))}
            className={`w-full rounded-lg px-4 py-2.5 font-semibold ${
              me.ready ? "bg-raised text-ink ring-1 ring-line" : "bg-accent text-bg"
            }`}
          >
            {me.ready ? "準備を取り消す" : "準備完了にする"}
          </button>

          {isHost ? (
            <button
              type="button"
              disabled={busy || !canStart}
              onClick={() => run(() => apiStartGame(roomId))}
              className="w-full rounded-lg bg-accent px-4 py-3 text-base font-semibold text-bg disabled:opacity-40"
            >
              ゲーム開始
            </button>
          ) : (
            <p className="text-center text-xs text-muted">
              ホストの開始を待っています…
            </p>
          )}
          {isHost && !canStart && (
            <p className="text-center text-xs text-muted">
              {state.players.length < MIN_PLAYERS
                ? `あと${MIN_PLAYERS - state.players.length}人必要です`
                : "全員が準備完了すると開始できます"}
            </p>
          )}
          {state.result && isHost && (
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => apiReturnToLobby(roomId))}
              className="w-full rounded-md bg-raised px-4 py-2 text-sm text-muted ring-1 ring-line"
            >
              ロビーをリセット
            </button>
          )}
        </section>

        {error && (
          <p className="rounded-md bg-raised px-3 py-2 text-sm text-red-300 ring-1 ring-line">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
