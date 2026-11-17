"use client";

import { useState } from "react";
import Link from "next/link";
import Board from "./Board";
import SharePanel from "./SharePanel";
import CreateRoomButton from "./CreateRoomButton";
import { useRoom } from "../hooks/useRoom";
import { apiJoinRoom, apiMove, storeToken } from "../lib/clientApi";
import type { Player } from "../lib/engine";
import type { PublicRoomState } from "../types";

const roleLabel = (p: Player) => (p === "p1" ? "プレイヤー1" : "プレイヤー2");

export default function GameRoom({ roomId }: { roomId: string }) {
  const { state, fatal, connected, applyState, refetch, setPaused } =
    useRoom(roomId);

  const [submitting, setSubmitting] = useState(false);
  const [joining, setJoining] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const myRole = state?.yourRole ?? null;
  const isMyTurn =
    !!state && state.status === "playing" && state.currentTurn === myRole;
  const interactive = isMyTurn && !submitting;

  async function handleCard(index: number) {
    if (!state || submitting || !myRole) return;
    if (state.status !== "playing" || state.currentTurn !== myRole) return;

    setSubmitting(true);
    setNotice(null);
    setPaused(true);

    // No optimistic flip: we never fake a hidden card's value on the client.
    // We simply send the flip and apply the authoritative server response.
    const res = await apiMove(roomId, index);
    if (res.ok) {
      applyState(res.data.publicState);
    } else if (res.publicState) {
      applyState(res.publicState);
      if (res.code !== "not_your_turn") setNotice(res.message);
    } else {
      setNotice(res.message);
      await refetch();
    }

    setSubmitting(false);
    setPaused(false);
  }

  async function handleJoin() {
    if (joining) return;
    setJoining(true);
    setNotice(null);
    const res = await apiJoinRoom(roomId);
    if (res.ok) {
      if (res.data.token) storeToken(roomId, res.data.token);
      applyState(res.data.publicState);
    } else {
      if (res.publicState) applyState(res.publicState);
      setNotice(res.message);
    }
    setJoining(false);
  }

  // ---- Terminal error ----------------------------------------------------
  if (fatal) {
    return (
      <Shell>
        <Card>
          <h2 className="text-xl font-semibold text-ink">ルームを開けません</h2>
          <p className="mt-3 text-sm leading-relaxed text-muted">{fatal}</p>
          <div className="mt-6 space-y-3">
            <CreateRoomButton label="新しい対戦を始める" />
            <Link
              href="/"
              className="block text-center text-sm text-muted underline underline-offset-4"
            >
              ゲーム一覧へ戻る
            </Link>
          </div>
        </Card>
      </Shell>
    );
  }

  // ---- Initial load ------------------------------------------------------
  if (!state) {
    return (
      <Shell>
        <Card>
          <p className="text-center text-sm text-muted" data-testid="loading">
            読み込み中…
          </p>
        </Card>
      </Shell>
    );
  }

  // ---- Spectator: a third visitor to a full/started room -----------------
  if (myRole === null && state.status !== "waiting") {
    return (
      <Shell>
        <Card>
          <h2 className="text-xl font-semibold text-ink" data-testid="room-full">
            このルームは満員です
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            このルームでは既に2人が対戦しています。観戦はできません。
            新しいルームを作って対戦しましょう。
          </p>
          <div className="mt-6">
            <CreateRoomButton label="新しい対戦を始める" />
          </div>
        </Card>
      </Shell>
    );
  }

  // ---- Friend arriving at an open room -----------------------------------
  if (myRole === null && state.status === "waiting") {
    return (
      <Shell>
        <Card>
          <div
            className="mb-4 text-center text-4xl font-bold text-pink-400"
            aria-hidden
          >
            ♥
          </div>
          <h2 className="text-center text-xl font-semibold text-ink">
            対戦に参加する
          </h2>
          <p className="mt-3 text-center text-sm leading-relaxed text-muted">
            あなたは<span className="font-semibold text-ink">プレイヤー2</span>
            として参加します。プレイヤー1（先手）の相手が待っています。
          </p>
          <button
            type="button"
            onClick={handleJoin}
            disabled={joining}
            data-testid="join-p2"
            className="mt-6 w-full rounded-xl bg-accent px-6 py-4 text-base font-semibold text-black transition active:scale-[0.98] disabled:opacity-60"
          >
            {joining ? "参加中…" : "プレイヤー2で参加する"}
          </button>
          {notice && (
            <p className="mt-3 text-center text-sm text-red-400" role="alert">
              {notice}
            </p>
          )}
        </Card>
      </Shell>
    );
  }

  // ---- Main game view (participant) --------------------------------------
  const finished = state.status === "finished";
  const waiting = state.status === "waiting";

  return (
    <Shell>
      <header className="mb-4 flex w-full items-center justify-between">
        <Link
          href="/"
          className="text-sm font-semibold tracking-tight text-muted transition hover:text-ink"
        >
          神経衰弱
        </Link>
        <ConnectionDot connected={connected} />
      </header>

      <SeatBar state={state} myRole={myRole} />

      <TurnBanner
        state={state}
        isMyTurn={isMyTurn}
        waiting={waiting}
        finished={finished}
      />

      <div className="relative mt-4 w-full">
        <Board
          cards={state.cards}
          interactive={interactive}
          onCardClick={handleCard}
        />
      </div>

      {notice && (
        <p
          className="mt-3 text-center text-sm text-amber-400"
          role="status"
          data-testid="notice"
        >
          {notice}
        </p>
      )}

      {waiting && (
        <section className="mt-6 w-full rounded-xl border border-line bg-surface p-4">
          <p className="mb-4 text-center text-sm text-muted" data-testid="waiting">
            友達の参加を待っています…
          </p>
          <SharePanel roomId={roomId} />
        </section>
      )}

      {finished && <ResultPanel state={state} myRole={myRole} />}
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// Presentational pieces
// ---------------------------------------------------------------------------

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center px-4 py-6 sm:py-10">
      <div className="flex w-full flex-1 flex-col">{children}</div>
    </main>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="m-auto w-full rounded-2xl border border-line bg-surface p-6 shadow-xl">
      {children}
    </div>
  );
}

function ConnectionDot({ connected }: { connected: boolean }) {
  return (
    <span
      className="flex items-center gap-1.5 text-xs text-muted"
      data-testid="connection"
      data-connected={connected ? "true" : "false"}
    >
      <span
        className={`inline-block h-2 w-2 rounded-full ${
          connected ? "bg-accent" : "bg-amber-400 animate-pulse"
        }`}
      />
      {connected ? "オンライン" : "再接続中…"}
    </span>
  );
}

function SeatCard({
  player,
  isTurn,
  isYou,
  present,
  score,
}: {
  player: Player;
  isTurn: boolean;
  isYou: boolean;
  present: boolean;
  score: number;
}) {
  return (
    <div
      data-testid={`seat-${player}`}
      className={[
        "flex flex-1 items-center gap-3 rounded-xl border p-3 transition",
        isTurn ? "border-accent/70 bg-raised" : "border-line bg-surface",
        !present ? "opacity-50" : "",
      ].join(" ")}
    >
      <span
        aria-hidden
        className={`text-3xl font-bold leading-none ${
          player === "p1" ? "text-sky-400" : "text-pink-400"
        }`}
      >
        {score}
      </span>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium text-ink">
            {roleLabel(player)}
          </span>
          {isYou && (
            <span className="rounded bg-accent/20 px-1.5 py-0.5 text-[10px] font-semibold text-accent">
              あなた
            </span>
          )}
        </div>
        <div className="text-xs text-muted">
          {present
            ? `${score}ペア${isTurn ? "・めくり中…" : ""}`
            : "未参加"}
        </div>
      </div>
    </div>
  );
}

function SeatBar({
  state,
  myRole,
}: {
  state: PublicRoomState;
  myRole: Player | null;
}) {
  return (
    <div className="flex w-full gap-3">
      <SeatCard
        player="p1"
        isTurn={state.status === "playing" && state.currentTurn === "p1"}
        isYou={myRole === "p1"}
        present={state.seats.p1}
        score={state.scores.p1}
      />
      <SeatCard
        player="p2"
        isTurn={state.status === "playing" && state.currentTurn === "p2"}
        isYou={myRole === "p2"}
        present={state.seats.p2}
        score={state.scores.p2}
      />
    </div>
  );
}

function TurnBanner({
  state,
  isMyTurn,
  waiting,
  finished,
}: {
  state: PublicRoomState;
  isMyTurn: boolean;
  waiting: boolean;
  finished: boolean;
}) {
  let text: string;
  let tone: "accent" | "muted" = "muted";

  if (waiting) {
    text = "友達の参加を待っています";
  } else if (finished) {
    text = "ゲーム終了";
  } else if (isMyTurn) {
    text = "あなたの番です";
    tone = "accent";
  } else {
    text = `相手（${roleLabel(state.currentTurn)}）の番です`;
  }

  return (
    <div
      data-testid="turn-banner"
      data-my-turn={isMyTurn ? "true" : "false"}
      className={[
        "mt-3 w-full rounded-xl px-4 py-3 text-center text-sm font-semibold transition",
        tone === "accent"
          ? "bg-accent/15 text-accent ring-1 ring-accent/40"
          : "bg-surface text-muted",
      ].join(" ")}
    >
      {text}
    </div>
  );
}

function ResultPanel({
  state,
  myRole,
}: {
  state: PublicRoomState;
  myRole: Player | null;
}) {
  const { winner } = state;
  let headline: string;
  if (winner === "draw") {
    headline = "引き分け";
  } else if (winner && myRole && winner === myRole) {
    headline = "あなたの勝ち！";
  } else if (winner && myRole) {
    headline = "あなたの負け…";
  } else {
    headline = `${roleLabel(winner as Player)}の勝ち`;
  }

  return (
    <section
      className="mt-6 w-full rounded-2xl border border-line bg-surface p-6 text-center shadow-xl"
      data-testid="result"
    >
      <h2 className="text-2xl font-bold text-ink" data-testid="result-headline">
        {headline}
      </h2>
      <p className="mt-2 text-sm text-muted">
        プレイヤー1 {state.scores.p1}ペア ・ プレイヤー2 {state.scores.p2}ペア
      </p>
      <div className="mt-6">
        <CreateRoomButton label="新しい対戦を始める" />
      </div>
    </section>
  );
}
