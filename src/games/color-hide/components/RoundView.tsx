"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import GameScene from "./three/GameScene";
import PaintStudio from "./paint/PaintStudio";
import { clearTextureCache } from "./three/textures";
import { createWsTransport, resolveWsUrl } from "../net/wsTransport";
import type { ConnectionStatus, RealtimeTransport } from "../net/transport";
import { apiCommitPaint, apiGetPaints, getStoredToken } from "../lib/clientApi";
import { mapPalette } from "../lib/maps";
import { sharedAudio } from "../lib/audio";
import type { PublicPlayer, PublicRoomState, Role } from "../types";

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connecting: "接続中…",
  connected: "接続済み",
  reconnecting: "再接続中…",
  disconnected: "切断されました",
  failed: "接続できません",
};

/**
 * The live round: owns the realtime transport, fetches confirmed paints once, and
 * renders the 3D scene with a HUD. Movement/look/anim flow over the transport;
 * phase, timer, roster, and catches come from the polled room state (above) so the
 * HUD stays correct even if the realtime host is briefly unavailable.
 */
export default function RoundView({
  roomId,
  state,
  me,
  remainingMs,
}: {
  roomId: string;
  state: PublicRoomState;
  me: PublicPlayer;
  remainingMs: number | null;
}) {
  const [paints, setPaints] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const transportRef = useRef<RealtimeTransport | null>(null);
  const [transport, setTransport] = useState<RealtimeTransport | null>(null);

  // Phase 10 — in-world paint overlay state (hiders, during the hiding phase).
  const [paintOpen, setPaintOpen] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [committed, setCommitted] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);

  // One transport for the whole round.
  useEffect(() => {
    const t = createWsTransport({
      url: resolveWsUrl(roomId),
      roomId,
      playerId: me.id,
      token: getStoredToken(roomId),
    });
    t.onStatus(setStatus);
    transportRef.current = t;
    setTransport(t);
    return () => t.close();
  }, [roomId, me.id]);

  const connected = status === "connected";

  // Free cached opponent paint textures when leaving the round (memory hygiene).
  useEffect(() => () => clearTextureCache(), []);

  // Fetch confirmed paints once at round start.
  useEffect(() => {
    let active = true;
    apiGetPaints(roomId).then((res) => {
      if (active && res.ok) setPaints(res.data.paints);
    });
    return () => {
      active = false;
    };
  }, [roomId]);

  const roster = useMemo(
    () => state.players.map((p) => ({ id: p.id, nickname: p.nickname, role: p.role })),
    [state.players],
  );
  const caughtIds = useMemo(
    () => state.players.filter((p) => p.caught).map((p) => p.id),
    [state.players],
  );

  const myRole: Role = me.role ?? "hider";
  const amICaught = me.caught;
  const canMove =
    myRole === "hider"
      ? (state.phase === "hiding" || state.phase === "seeking") && !amICaught
      : state.phase === "seeking";
  const canCatch = myRole === "seeker" && state.phase === "seeking";

  const seconds = remainingMs != null ? Math.ceil(remainingMs / 1000) : null;
  const hiders = state.players.filter((p) => p.role === "hider");
  const alive = hiders.filter((p) => !p.caught).length;

  // Phase 10 — in-world painting. A hider may paint while hiding (not once caught,
  // never during seeking). The overlay auto-saves in the final seconds so unfinished
  // work is never lost; the server still decides whether a late save lands.
  const isHiding = state.phase === "hiding";
  const canPaint = myRole === "hider" && isHiding && !amICaught;
  const autoCommit = isHiding && seconds != null && seconds <= 5;

  async function commitMyPaint(dataUrl: string) {
    setCommitting(true);
    setCommitError(null);
    const res = await apiCommitPaint(roomId, dataUrl);
    setCommitting(false);
    if (res.ok) {
      setCommitted(true);
      // Apply instantly to my own in-world character (and share key for others).
      setPaints((prev) => ({ ...prev, [me.id]: dataUrl }));
      sharedAudio().play("paintCommit");
    } else {
      setCommitError(res.message);
    }
  }

  // When the hunt begins, force the paint overlay shut (movement resumes) and
  // re-fetch everyone's confirmed paints so the final designs are on screen for the
  // seeker + teammates. Driven by the server-authoritative phase, never guessed.
  const prevPhase = useRef(state.phase);
  useEffect(() => {
    if (prevPhase.current !== "seeking" && state.phase === "seeking") {
      setPaintOpen(false);
      apiGetPaints(roomId).then((res) => {
        if (res.ok) setPaints(res.data.paints);
      });
    }
    prevPhase.current = state.phase;
  }, [state.phase, roomId]);

  // Final-10s warning: beep once per second, but ONLY on a 1-step decrease while
  // connected — so a reconnect (which can jump the clock) never replays a burst.
  const warn = seconds != null && seconds <= 10 && seconds > 0;
  const lastWarnSec = useRef<number | null>(null);
  useEffect(() => {
    if (seconds == null) return;
    const prev = lastWarnSec.current;
    lastWarnSec.current = seconds;
    if (connected && warn && prev != null && seconds === prev - 1) {
      sharedAudio().play("timeWarning");
    }
  }, [seconds, warn, connected]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface p-3">
        <span className="rounded bg-raised px-3 py-1 text-sm font-semibold text-ink ring-1 ring-line">
          {state.phase === "hiding" ? "🙈 隠れて & ペイント" : "👀 探索中"}
        </span>
        <span className="text-sm text-muted">
          あなた：{myRole === "seeker" ? "鬼" : amICaught ? "見つかった…" : "隠れる側"}
        </span>
        <span className="text-sm text-muted">生存 {alive}/{hiders.length}</span>
        <span className="flex items-center gap-2">
          <span
            className={`flex items-center gap-1.5 rounded px-2 py-0.5 text-xs ring-1 ring-line ${
              connected
                ? "text-emerald-300"
                : status === "failed" || status === "disconnected"
                  ? "text-red-300"
                  : "text-amber-300"
            }`}
            title={STATUS_LABEL[status]}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                connected ? "bg-emerald-400" : status === "failed" || status === "disconnected" ? "bg-red-400" : "bg-amber-400 animate-pulse"
              }`}
            />
            {connected ? "接続済み" : STATUS_LABEL[status]}
          </span>
          <span
            className={`rounded-lg px-3 py-1 text-lg font-bold tabular-nums ring-1 ${
              warn
                ? "ch-pulse bg-red-500/20 text-red-300 ring-red-500/40"
                : "bg-raised text-ink ring-line"
            }`}
          >
            {seconds ?? "—"}s
          </span>
        </span>
      </div>

      {/* Spectator mode: a hider who has been caught watches until the round ends.
          For fairness the server does NOT send them uncaught teammates' positions,
          so we say so plainly rather than leaving the player confused. */}
      {amICaught && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-center text-sm text-amber-200">
          👻 観戦モード — 見つかりました。鬼と捕まった仲間だけ見えます（公平性のため、逃げている仲間の位置は表示されません）。このラウンド終了まで観戦できます。
        </div>
      )}

      <div className="relative">
        {transport ? (
          <GameScene
            mapId={state.mapId}
            myId={me.id}
            myRole={myRole}
            canMove={canMove}
            canCatch={canCatch}
            spectating={amICaught}
            inputLocked={paintOpen}
            transport={transport}
            roster={roster}
            paints={paints}
            caughtIds={caughtIds}
          />
        ) : (
          <div className="flex h-[60vh] items-center justify-center text-muted">
            3Dシーンを準備中…
          </div>
        )}

        {/* Phase 10 — open the in-world paint overlay (hiders, hiding phase). */}
        {canPaint && !paintOpen && (
          <button
            type="button"
            onClick={() => {
              setPaintOpen(true);
              sharedAudio().play("ui");
            }}
            className="absolute bottom-3 right-3 z-20 rounded-full bg-accent px-5 py-3 text-base font-semibold text-bg shadow-lg"
          >
            🎨 ペイント
          </button>
        )}

        {/* Hint for hiders before they paint. */}
        {canPaint && !paintOpen && (
          <div className="pointer-events-none absolute left-1/2 top-3 z-20 -translate-x-1/2 rounded-full bg-black/60 px-4 py-1.5 text-center text-xs text-white/90">
            隠れ場所を決めたら「🎨 ペイント」で周囲の色に溶け込もう
          </div>
        )}

        {/* The paint overlay sits ON TOP of the live world (which stays rendered,
            dimmed, behind) — never a separate screen. Movement is locked while open. */}
        {paintOpen && (
          <div className="absolute inset-0 z-30 overflow-y-auto rounded-xl bg-black/60 p-3 backdrop-blur-sm">
            <div className="mx-auto max-w-3xl rounded-xl border border-line bg-surface/95 p-3 shadow-2xl">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-semibold text-ink">
                  🎨 その場でペイント — 周囲の色に溶け込もう
                </span>
                <span className="rounded bg-raised px-2 py-0.5 text-sm font-bold tabular-nums text-ink ring-1 ring-line">
                  {seconds ?? "—"}s
                </span>
              </div>
              <PaintStudio
                initialDataUrl={paints[me.id] ?? null}
                surroundingColors={mapPalette(state.mapId)}
                onCommit={commitMyPaint}
                committing={committing}
                committed={committed}
                commitError={commitError}
                autoCommit={autoCommit}
                onClose={() => setPaintOpen(false)}
                commitLabel={committed ? "描き直して保存" : "この色で保存"}
              />
            </div>
          </div>
        )}

        {/* While not connected, dim the scene + show status so the round never
            looks like it is progressing normally. */}
        {transport && !connected && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-xl bg-black/55 text-center backdrop-blur-sm">
            <div className="text-lg font-semibold text-ink">{STATUS_LABEL[status]}</div>
            <div className="max-w-xs px-4 text-xs text-muted">
              {status === "failed"
                ? "リアルタイムサーバーに接続できませんでした。ロビー・結果は引き続き利用できます。"
                : "他プレイヤーとの同期を復旧しています…"}
            </div>
            {status === "failed" && (
              <button
                type="button"
                onClick={() => transportRef.current?.reconnect()}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-bg"
              >
                再接続する
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
