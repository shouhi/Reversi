"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import GameScene from "./three/GameScene";
import { createWsTransport, resolveWsUrl } from "../net/wsTransport";
import type { RealtimeTransport } from "../net/transport";
import { apiGetPaints, getStoredToken } from "../lib/clientApi";
import type { PublicPlayer, PublicRoomState, Role } from "../types";

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
  const [connected, setConnected] = useState(false);
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
    t.onStatus(setConnected);
    transportRef.current = t;
    setTransport(t);
    return () => t.close();
  }, [roomId, me.id]);

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
          {!connected && (
            <span className="rounded bg-raised px-2 py-0.5 text-xs text-amber-300 ring-1 ring-line">
              RT未接続
            </span>
          )}
          <span className="rounded-lg bg-raised px-3 py-1 text-lg font-bold tabular-nums text-ink ring-1 ring-line">
            {seconds ?? "—"}s
          </span>
        </span>
      </div>

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

      {!connected && (
        <p className="text-center text-xs text-muted">
          リアルタイムサーバーに接続していません。ローカルでは
          <code className="mx-1 rounded bg-raised px-1">npm run dev:color-hide-rt</code>
          を起動してください（移動は予測表示されますが、他プレイヤーとの同期には必要です）。
        </p>
      )}
    </div>
  );
}
