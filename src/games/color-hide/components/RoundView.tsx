"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import GameScene from "./three/GameScene";
import { clearTextureCache } from "./three/textures";
import { createWsTransport, resolveWsUrl } from "../net/wsTransport";
import type { ConnectionStatus, RealtimeTransport } from "../net/transport";
import { apiGetPaints, getStoredToken } from "../lib/clientApi";
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

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface p-3">
        <span className="rounded bg-raised px-3 py-1 text-sm font-semibold text-ink ring-1 ring-line">
          {state.phase === "hiding" ? "🙈 隠れる時間" : "👀 探索中"}
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
          <span className="rounded-lg bg-raised px-3 py-1 text-lg font-bold tabular-nums text-ink ring-1 ring-line">
            {seconds ?? "—"}s
          </span>
        </span>
      </div>

      <div className="relative">
        {transport ? (
          <GameScene
            mapId={state.mapId}
            myId={me.id}
            myRole={myRole}
            canMove={canMove}
            canCatch={canCatch}
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
