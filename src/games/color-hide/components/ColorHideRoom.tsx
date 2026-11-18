"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import SiteHeader from "@/components/layout/SiteHeader";
import SiteFooter from "@/components/layout/SiteFooter";
import { useColorHideRoom } from "../hooks/useColorHideRoom";
import {
  apiCommitPaint,
  apiJoinRoom,
  getStoredNickname,
  getStoredToken,
  storeNickname,
  storePlayerId,
  storeToken,
} from "../lib/clientApi";
import { allMaps } from "../lib/maps";
import { sharedAudio, type SfxName } from "../lib/audio";
import { prefersReducedMotion } from "../lib/motion";
import AudioSettings from "./AudioSettings";
import Lobby from "./Lobby";
import ResultScreen from "./ResultScreen";
import type { PublicRoomState } from "../types";

/** Sound + banner shown when the round enters a phase (result handled separately). */
const PHASE_CUES: Partial<Record<string, { sfx: SfxName; text: string }>> = {
  preparing: { sfx: "gameStart", text: "まもなく開始" },
  painting: { sfx: "phase", text: "🎨 ペイントタイム" }, // legacy (rooms mid-paint)
  hiding: { sfx: "phase", text: "🙈 隠れて & ペイント" },
  seeking: { sfx: "phase", text: "👀 探索開始！" },
};

const PaintStudio = dynamic(() => import("./paint/PaintStudio"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[60vh] items-center justify-center text-muted">
      3Dスタジオを読み込み中…
    </div>
  ),
});

const RoundView = dynamic(() => import("./RoundView"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[60vh] items-center justify-center text-muted">
      3Dシーンを読み込み中…
    </div>
  ),
});

export default function ColorHideRoom({ roomId }: { roomId: string }) {
  const { state, me, fatal, connected, applyState, serverNow } = useColorHideRoom(roomId);
  const [mounted, setMounted] = useState(false);
  const [nickname, setNickname] = useState("");
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
  const [committed, setCommitted] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const autoJoined = useRef(false);
  const reducedMotion = useMemo(prefersReducedMotion, []);
  const [banner, setBanner] = useState<{ text: string; key: number } | null>(null);
  const prevPhase = useRef<string | null>(null);
  const bannerKey = useRef(0);
  const bannerTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Re-render a few times a second so the countdown stays live.
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 300);
    return () => clearInterval(id);
  }, []);

  // Unlock audio on the first user gesture (browsers block autoplay).
  useEffect(() => {
    const unlock = () => sharedAudio().resume();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  // Play a cue + show a brief banner when the round enters a new phase. Driven by
  // the server-authoritative phase (polled), never guessed client-side.
  useEffect(() => {
    const phase = state?.phase;
    if (!phase) return;
    const prev = prevPhase.current;
    prevPhase.current = phase;
    if (prev === null || prev === phase) return; // first observation / no change
    const cue = PHASE_CUES[phase];
    if (!cue) return; // e.g. lobby / result
    sharedAudio().play(cue.sfx);
    if (!reducedMotion) {
      bannerKey.current += 1;
      setBanner({ text: cue.text, key: bannerKey.current });
      if (bannerTimer.current) clearTimeout(bannerTimer.current);
      bannerTimer.current = setTimeout(() => setBanner(null), 1800);
    }
  }, [state?.phase, reducedMotion]);

  useEffect(() => () => bannerTimer.current && clearTimeout(bannerTimer.current), []);

  useEffect(() => {
    setMounted(true);
    setNickname(getStoredNickname());
  }, []);

  // Auto-reconnect once if we already hold a token for this room.
  useEffect(() => {
    if (!mounted || autoJoined.current) return;
    if (getStoredToken(roomId)) {
      autoJoined.current = true;
      void doJoin(getStoredNickname() || "プレイヤー");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, roomId]);

  // Reset the "paint committed" flag when the round phase changes.
  useEffect(() => {
    if (state?.phase !== "painting") {
      setCommitted(false);
      setCommitError(null);
    }
  }, [state?.phase]);

  async function doJoin(name: string) {
    setJoining(true);
    setJoinError(null);
    const res = await apiJoinRoom(roomId, name);
    setJoining(false);
    if (res.ok) {
      if (res.data.token) storeToken(roomId, res.data.token);
      storePlayerId(roomId, res.data.playerId);
      storeNickname(name);
      applyState(res.data.publicState);
    } else {
      setJoinError(res.message);
    }
  }

  async function commitPaint(dataUrl: string) {
    setCommitting(true);
    setCommitError(null);
    const res = await apiCommitPaint(roomId, dataUrl);
    setCommitting(false);
    if (res.ok) {
      setCommitted(true);
      sharedAudio().play("paintCommit");
    } else {
      setCommitError(res.message);
    }
  }

  const remainingMs =
    state && state.phaseDurationMs != null
      ? Math.max(0, state.phaseStartedAt + state.phaseDurationMs - serverNow())
      : null;
  const seconds = remainingMs != null ? Math.ceil(remainingMs / 1000) : null;

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6">
        <div className="mb-4 flex items-center justify-between">
          <Link href="/games/color-hide" className="text-sm text-muted hover:text-ink">
            ← COLOR HIDE
          </Link>
          <div className="flex items-center gap-3">
            {!connected && (
              <span className="rounded bg-raised px-2 py-1 text-xs text-amber-300 ring-1 ring-line">
                再接続中…
              </span>
            )}
            <AudioSettings />
          </div>
        </div>

        {/* Brief phase-transition banner (skipped under reduced-motion). */}
        {banner && (
          <div
            key={banner.key}
            className="ch-banner pointer-events-none fixed left-1/2 top-24 z-50 -translate-x-1/2 rounded-full bg-black/75 px-6 py-2 text-lg font-bold text-white ring-1 ring-white/15"
          >
            {banner.text}
          </div>
        )}

        {fatal ? (
          <div className="mx-auto max-w-md rounded-xl border border-line bg-surface p-6 text-center">
            <p className="text-ink">{fatal}</p>
            <Link
              href="/games/color-hide"
              className="mt-4 inline-block rounded-lg bg-accent px-4 py-2 font-semibold text-bg"
            >
              新しい部屋を作る
            </Link>
          </div>
        ) : !mounted || !state ? (
          <div className="flex h-[50vh] items-center justify-center text-muted">読み込み中…</div>
        ) : !me ? (
          <JoinGate
            phase={state.phase}
            full={state.players.length >= 6}
            nickname={nickname}
            setNickname={setNickname}
            joining={joining}
            onJoin={() => doJoin(nickname.trim() || "プレイヤー")}
            error={joinError}
          />
        ) : state.phase === "lobby" ? (
          <Lobby roomId={roomId} state={state} me={me} onChanged={applyState} />
        ) : state.phase === "preparing" ? (
          <RoleReveal role={me.role} seconds={seconds} mapName={mapName(state)} />
        ) : state.phase === "painting" ? (
          me.role === "hider" ? (
            // One PaintStudio stays mounted across commit so the canvas (and the
            // user's drawing) is never wiped by a remount under "描き直して再送信".
            <section>
              <PhaseHeading
                title={committed ? "ペイント完成！" : "ペイントタイム"}
                seconds={seconds}
              />
              {committed && (
                <p className="mb-3 rounded-lg bg-surface px-4 py-2 text-sm text-muted ring-1 ring-line">
                  他のプレイヤーを待っています。もう少し描き足して再送信もできます。
                </p>
              )}
              <PaintStudio
                onCommit={commitPaint}
                committing={committing}
                committed={committed}
                commitError={commitError}
                remainingMs={remainingMs}
                commitLabel={committed ? "描き直して再送信" : "この絵で準備完了"}
              />
            </section>
          ) : (
            <WaitingCard
              title="あなたは鬼です"
              body="隠れる側がキャラクターをペイント中です。目を閉じて待ちましょう…"
              seconds={seconds}
            />
          )
        ) : state.phase === "hiding" ? (
          // Phase 10: Hiding & Painting. Hiders are in the world (and can paint
          // in-place); the seeker waits BLIND — rendered as a wait card with no
          // RoundView, so no realtime transport is opened and the client never even
          // receives hider positions (the server also withholds them until seeking).
          me.role === "seeker" ? (
            <WaitingCard
              title="あなたは鬼です"
              body="隠れる側がマップ内に隠れて、周囲の色にペイント中です。探索開始まで待ちましょう…"
              seconds={seconds}
            />
          ) : (
            <RoundView roomId={roomId} state={state} me={me} remainingMs={remainingMs} />
          )
        ) : state.phase === "seeking" ? (
          <RoundView roomId={roomId} state={state} me={me} remainingMs={remainingMs} />
        ) : state.phase === "result" ? (
          <ResultScreen roomId={roomId} state={state} me={me} onChanged={applyState} />
        ) : null}
      </main>
      <SiteFooter />
    </div>
  );
}

function mapName(state: PublicRoomState): string {
  return allMaps().find((m) => m.id === state.mapId)?.name ?? state.mapId;
}

function PhaseHeading({ title, seconds }: { title: string; seconds: number | null }) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <h2 className="text-xl font-bold text-ink">{title}</h2>
      {seconds != null && (
        <span className="rounded-lg bg-raised px-3 py-1 text-lg font-bold tabular-nums text-ink ring-1 ring-line">
          {seconds}s
        </span>
      )}
    </div>
  );
}

function JoinGate(props: {
  phase: string;
  full: boolean;
  nickname: string;
  setNickname: (v: string) => void;
  joining: boolean;
  onJoin: () => void;
  error: string | null;
}) {
  if (props.phase !== "lobby") {
    return (
      <div className="mx-auto max-w-md rounded-xl border border-line bg-surface p-6 text-center text-muted">
        ただいまラウンド進行中です。ロビーに戻るまでお待ちください。
      </div>
    );
  }
  if (props.full) {
    return (
      <div className="mx-auto max-w-md rounded-xl border border-line bg-surface p-6 text-center text-muted">
        この部屋は満員です（最大6人）。
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-md rounded-xl border border-line bg-surface p-6">
      <h2 className="text-lg font-semibold text-ink">部屋に参加</h2>
      <label className="mt-4 block text-xs font-medium text-muted">
        ニックネーム
        <input
          value={props.nickname}
          maxLength={20}
          onChange={(e) => props.setNickname(e.target.value)}
          placeholder="あなたの名前"
          className="mt-1 w-full rounded-md border border-line bg-bg px-3 py-2 text-ink outline-none focus:border-accent"
        />
      </label>
      <button
        type="button"
        disabled={props.joining}
        onClick={props.onJoin}
        className="mt-4 w-full rounded-lg bg-accent px-4 py-2.5 font-semibold text-bg disabled:opacity-50"
      >
        {props.joining ? "参加中…" : "参加する"}
      </button>
      {props.error && <p className="mt-3 text-sm text-red-300">{props.error}</p>}
    </div>
  );
}

function RoleReveal({
  role,
  seconds,
  mapName,
}: {
  role: "seeker" | "hider" | null;
  seconds: number | null;
  mapName: string;
}) {
  const seeker = role === "seeker";
  return (
    <div className="mx-auto max-w-md rounded-2xl border border-line bg-surface p-8 text-center">
      <div className="text-sm text-muted">まもなく開始 {seconds != null ? `(${seconds}s)` : ""}</div>
      <h2 className="mt-3 text-3xl font-bold text-ink">
        {seeker ? "👀 あなたは 鬼" : "🙈 あなたは 隠れる側"}
      </h2>
      <p className="mt-3 text-sm text-muted">
        {seeker
          ? "探索開始まで待機。制限時間内に全員を見つけよう。"
          : "マップに隠れて、その場で周囲の色にペイントして溶け込もう。"}
      </p>
      <div className="mt-4 text-xs text-muted">マップ：{mapName}</div>
    </div>
  );
}

function WaitingCard({
  title,
  body,
  seconds,
  children,
}: {
  title: string;
  body: string;
  seconds: number | null;
  children?: React.ReactNode;
}) {
  return (
    <section>
      <div className="mx-auto mb-4 max-w-md rounded-xl border border-line bg-surface p-5 text-center">
        <div className="text-sm text-muted">残り {seconds ?? "—"}s</div>
        <h2 className="mt-1 text-xl font-bold text-ink">{title}</h2>
        <p className="mt-1 text-sm text-muted">{body}</p>
      </div>
      {children}
    </section>
  );
}

