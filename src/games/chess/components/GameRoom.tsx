"use client";

import { useState } from "react";
import Link from "next/link";
import Board from "./Board";
import SharePanel from "./SharePanel";
import CreateRoomButton from "./CreateRoomButton";
import { useRoom } from "../hooks/useRoom";
import { apiJoinRoom, apiMove, storeToken } from "../lib/clientApi";
import {
  applyMove,
  findKing,
  getLegalMoves,
  type Color,
  type Coord,
  type PieceType,
  type Position,
} from "../lib/engine";
import { squareKey } from "./Board";
import type { LastMove, PublicRoomState } from "../types";

const roleLabel = (c: Color) => (c === "white" ? "白" : "黒");
const PROMO_PIECES: PieceType[] = ["q", "r", "b", "n"];
const PROMO_GLYPH: Record<Color, Record<PieceType, string>> = {
  white: { q: "♕", r: "♖", b: "♗", n: "♘", k: "♔", p: "♙" },
  black: { q: "♛", r: "♜", b: "♝", n: "♞", k: "♚", p: "♟" },
};
const PROMO_NAME: Record<PieceType, string> = {
  q: "クイーン",
  r: "ルーク",
  b: "ビショップ",
  n: "ナイト",
  k: "キング",
  p: "ポーン",
};

export default function GameRoom({ roomId }: { roomId: string }) {
  const { state, fatal, connected, applyState, refetch, setPaused } =
    useRoom(roomId);

  const [submitting, setSubmitting] = useState(false);
  const [joining, setJoining] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<Coord | null>(null);
  const [pendingPromotion, setPendingPromotion] = useState<{
    from: Coord;
    to: Coord;
  } | null>(null);
  const [optimisticPosition, setOptimisticPosition] = useState<Position | null>(
    null,
  );
  const [optimisticLast, setOptimisticLast] = useState<LastMove | null>(null);

  async function submitMove(from: Coord, to: Coord, promotion?: PieceType) {
    if (!state) return;
    setSubmitting(true);
    setNotice(null);
    setSelected(null);
    setPendingPromotion(null);
    setPaused(true);

    try {
      setOptimisticPosition(applyMove(state.position, { from, to, promotion }));
      setOptimisticLast({ from, to });
    } catch {
      /* the move was validated before calling; ignore */
    }

    const res = await apiMove(roomId, from, to, promotion);
    if (res.ok) {
      applyState(res.data.publicState);
    } else if (res.publicState) {
      applyState(res.publicState);
      if (res.code !== "not_your_turn") setNotice(res.message);
    } else {
      setNotice(res.message);
      await refetch();
    }

    setOptimisticPosition(null);
    setOptimisticLast(null);
    setSubmitting(false);
    setPaused(false);
  }

  function handleSquareClick(row: number, col: number) {
    if (!state || submitting || pendingPromotion) return;
    const myRole = state.yourRole;
    if (!myRole || state.status !== "playing" || state.currentTurn !== myRole) {
      return;
    }

    const clicked: Coord = { row, col };
    const piece = state.position.board[row][col];

    // No current selection → pick up one of your own pieces.
    if (!selected) {
      if (piece && piece.color === myRole) setSelected(clicked);
      return;
    }

    // Clicking the selected square again deselects.
    if (selected.row === row && selected.col === col) {
      setSelected(null);
      return;
    }

    const legal = getLegalMoves(state.position, selected);
    const matches = legal.filter((m) => m.to.row === row && m.to.col === col);

    if (matches.length > 0) {
      if (matches.some((m) => m.flags?.promotion)) {
        setPendingPromotion({ from: selected, to: clicked });
      } else {
        void submitMove(selected, clicked);
      }
      return;
    }

    // Not a legal target → switch selection if another own piece, else clear.
    if (piece && piece.color === myRole) setSelected(clicked);
    else setSelected(null);
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

  const myRole = state.yourRole;

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
          <div className="mb-4 text-center text-5xl leading-none text-ink" aria-hidden>
            ♚
          </div>
          <h2 className="text-center text-xl font-semibold text-ink">
            対戦に参加する
          </h2>
          <p className="mt-3 text-center text-sm leading-relaxed text-muted">
            あなたは<span className="font-semibold text-ink">黒</span>として
            参加します。白（先手）の相手が待っています。
          </p>
          <button
            type="button"
            onClick={handleJoin}
            disabled={joining}
            data-testid="join-black"
            className="mt-6 w-full rounded-xl bg-accent px-6 py-4 text-base font-semibold text-black transition active:scale-[0.98] disabled:opacity-60"
          >
            {joining ? "参加中…" : "黒で参加する"}
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
  const displayPosition = optimisticPosition ?? state.position;
  const lastMove = optimisticLast ?? state.lastMove;
  const finished = state.status === "finished";
  const waiting = state.status === "waiting";
  const isMyTurn =
    state.status === "playing" && state.currentTurn === myRole;
  const interactive = isMyTurn && !submitting && !pendingPromotion;
  const flipped = myRole === "black";

  // Legal destinations for the selected piece (full position is public).
  const legalTargets = new Set<string>();
  if (selected && interactive) {
    for (const m of getLegalMoves(state.position, selected)) {
      legalTargets.add(squareKey(m.to.row, m.to.col));
    }
  }

  // Highlight the king when the side to move is in check.
  const checkSquare =
    state.check && state.status === "playing"
      ? findKing(displayPosition, state.currentTurn)
      : null;
  const showCheck = state.check && state.status === "playing";

  return (
    <Shell>
      <header className="mb-4 flex w-full items-center justify-between">
        <Link
          href="/"
          className="text-sm font-semibold tracking-tight text-muted transition hover:text-ink"
        >
          チェス
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

      {showCheck && (
        <p
          className="mt-3 w-full rounded-xl bg-red-500/15 px-4 py-2 text-center text-sm font-bold text-red-400 ring-1 ring-red-500/40"
          data-testid="check-indicator"
          role="status"
        >
          チェック！
        </p>
      )}

      <div className="relative mt-4 w-full">
        <Board
          position={displayPosition}
          interactive={interactive}
          selected={selected}
          legalTargets={legalTargets}
          lastMove={lastMove}
          checkSquare={checkSquare}
          flipped={flipped}
          onSquareClick={handleSquareClick}
        />

        {pendingPromotion && myRole && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50">
            <div className="rounded-2xl border border-line bg-surface p-4 shadow-2xl">
              <p className="mb-3 text-center text-sm font-semibold text-ink">
                昇格する駒を選択
              </p>
              <div className="flex gap-2">
                {PROMO_PIECES.map((p) => (
                  <button
                    key={p}
                    type="button"
                    data-testid={`promote-${p}`}
                    aria-label={`${PROMO_NAME[p]}に昇格`}
                    onClick={() =>
                      void submitMove(
                        pendingPromotion.from,
                        pendingPromotion.to,
                        p,
                      )
                    }
                    className="flex h-14 w-14 items-center justify-center rounded-xl border border-line bg-raised text-4xl leading-none text-ink transition hover:border-accent active:scale-[0.96]"
                  >
                    {PROMO_GLYPH[myRole][p]}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setPendingPromotion(null)}
                className="mt-3 w-full rounded-lg px-3 py-2 text-xs text-muted underline underline-offset-4"
              >
                キャンセル
              </button>
            </div>
          </div>
        )}
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
  color,
  isTurn,
  isYou,
  present,
}: {
  color: Color;
  isTurn: boolean;
  isYou: boolean;
  present: boolean;
}) {
  return (
    <div
      data-testid={`seat-${color}`}
      className={[
        "flex flex-1 items-center gap-3 rounded-xl border p-3 transition",
        isTurn ? "border-accent/70 bg-raised" : "border-line bg-surface",
        !present ? "opacity-50" : "",
      ].join(" ")}
    >
      <span
        aria-hidden
        className={`text-3xl leading-none ${
          color === "white" ? "text-white" : "text-zinc-900"
        }`}
        style={color === "black" ? { textShadow: "0 0 2px rgba(255,255,255,0.5)" } : undefined}
      >
        {color === "white" ? "♔" : "♚"}
      </span>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium text-ink">
            {color === "white" ? "白（先手）" : "黒（後手）"}
          </span>
          {isYou && (
            <span className="rounded bg-accent/20 px-1.5 py-0.5 text-[10px] font-semibold text-accent">
              あなた
            </span>
          )}
        </div>
        <div className="text-xs text-muted">
          {present ? (isTurn ? "思考中…" : "待機中") : "未参加"}
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
  myRole: Color | null;
}) {
  return (
    <div className="flex w-full gap-3">
      <SeatCard
        color="white"
        isTurn={state.status === "playing" && state.currentTurn === "white"}
        isYou={myRole === "white"}
        present={state.seats.white}
      />
      <SeatCard
        color="black"
        isTurn={state.status === "playing" && state.currentTurn === "black"}
        isYou={myRole === "black"}
        present={state.seats.black}
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
    text = "対局終了";
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
  myRole: Color | null;
}) {
  const { winner } = state;
  let headline: string;
  if (winner === "draw") {
    headline = "引き分け（ステイルメイト）";
  } else if (winner && myRole && winner === myRole) {
    headline = "あなたの勝ち！";
  } else if (winner && myRole) {
    headline = "あなたの負け…";
  } else if (winner) {
    headline = `${roleLabel(winner)}の勝ち`;
  } else {
    headline = "対局終了";
  }

  return (
    <section
      className="mt-6 w-full rounded-2xl border border-line bg-surface p-6 text-center shadow-xl"
      data-testid="result"
    >
      <h2 className="text-2xl font-bold text-ink" data-testid="result-headline">
        {headline}
      </h2>
      <div className="mt-6">
        <CreateRoomButton label="新しい対戦を始める" />
      </div>
    </section>
  );
}
