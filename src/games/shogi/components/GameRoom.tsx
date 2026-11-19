"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Board, { GLYPH, squareKey } from "./Board";
import SharePanel from "./SharePanel";
import CreateRoomButton from "./CreateRoomButton";
import RematchControls from "@/components/game/RematchControls";
import { useRoom } from "../hooks/useRoom";
import {
  apiJoinRoom,
  apiMove,
  apiRequestRematch,
  storeToken,
  type MovePayload,
} from "../lib/clientApi";
import {
  applyMove,
  findKing,
  getLegalDrops,
  getLegalMoves,
  DROPPABLE_TYPES,
  type Coord,
  type DroppableType,
  type Hands,
  type Move,
  type Player,
  type Position,
} from "../lib/engine";
import type { LastMove, PublicRoomState } from "../types";

const roleLabel = (p: Player) => (p === "sente" ? "先手" : "後手");
const typeCode = (t: DroppableType) => t.toLowerCase();

export default function GameRoom({ roomId }: { roomId: string }) {
  const { state, fatal, connected, applyState, refetch, setPaused } =
    useRoom(roomId);

  const [submitting, setSubmitting] = useState(false);
  const [joining, setJoining] = useState(false);
  const [rematchBusy, setRematchBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<Coord | null>(null);
  const [dropType, setDropType] = useState<DroppableType | null>(null);
  const [pendingPromotion, setPendingPromotion] = useState<{
    from: Coord;
    to: Coord;
  } | null>(null);
  const [optimisticPosition, setOptimisticPosition] = useState<Position | null>(
    null,
  );
  const [optimisticLast, setOptimisticLast] = useState<LastMove | null>(null);

  function clearSelection() {
    setSelected(null);
    setDropType(null);
    setPendingPromotion(null);
  }

  // When a rematch starts a new round, drop every piece of stale local UI
  // (optimistic board, selection, pending drop/promotion, notice).
  const roundId = state?.roundId;
  useEffect(() => {
    setOptimisticPosition(null);
    setOptimisticLast(null);
    setSelected(null);
    setDropType(null);
    setPendingPromotion(null);
    setNotice(null);
  }, [roundId]);

  async function submitMove(move: MovePayload) {
    if (!state) return;
    setSubmitting(true);
    setNotice(null);
    clearSelection();
    setPaused(true);

    try {
      setOptimisticPosition(applyMove(state.position, move as Move));
      setOptimisticLast(
        move.drop !== undefined
          ? { to: move.to, drop: move.drop }
          : { from: move.from, to: move.to, promote: move.promote === true },
      );
    } catch {
      /* the move was validated before calling; ignore */
    }

    const res = await apiMove(roomId, move, state.roundId);
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

  async function handleRematch() {
    if (!state || rematchBusy) return;
    setRematchBusy(true);
    setNotice(null);
    const res = await apiRequestRematch(roomId, state.roundId);
    if (res.ok) {
      applyState(res.data.publicState);
    } else {
      if (res.publicState) applyState(res.publicState);
      setNotice(res.message);
    }
    setRematchBusy(false);
  }

  function myTurnGuard(): Player | null {
    if (!state || submitting || pendingPromotion) return null;
    const myRole = state.yourRole;
    if (!myRole || state.status !== "playing" || state.currentTurn !== myRole) {
      return null;
    }
    return myRole;
  }

  function handleSquareClick(row: number, col: number) {
    const myRole = myTurnGuard();
    if (!myRole || !state) return;

    const clicked: Coord = { row, col };
    const piece = state.position.board[row][col];

    // Drop mode: place the held hand piece on a legal empty square.
    if (dropType) {
      const drops = getLegalDrops(state.position, dropType);
      if (drops.some((m) => m.to.row === row && m.to.col === col)) {
        void submitMove({ drop: dropType, to: clicked });
        return;
      }
      setDropType(null);
      if (piece && piece.owner === myRole) setSelected(clicked);
      return;
    }

    // No current selection → pick up one of your own pieces.
    if (!selected) {
      if (piece && piece.owner === myRole) setSelected(clicked);
      return;
    }

    // Clicking the selected square again deselects.
    if (selected.row === row && selected.col === col) {
      setSelected(null);
      return;
    }

    const matches = getLegalMoves(state.position, selected).filter(
      (m) => m.to.row === row && m.to.col === col,
    );
    if (matches.length > 0) {
      const canPromote = matches.some((m) => m.promote === true);
      const canStay = matches.some((m) => m.promote !== true);
      if (canPromote && canStay) {
        setPendingPromotion({ from: selected, to: clicked });
      } else {
        void submitMove({ from: selected, to: clicked, promote: canPromote });
      }
      return;
    }

    // Not a legal target → switch selection if another own piece, else clear.
    if (piece && piece.owner === myRole) setSelected(clicked);
    else setSelected(null);
  }

  function handleHandClick(owner: Player, type: DroppableType) {
    const myRole = myTurnGuard();
    if (!myRole || owner !== myRole || !state) return;
    if ((state.position.hands[myRole][type] ?? 0) <= 0) return;
    setSelected(null);
    setDropType((prev) => (prev === type ? null : type));
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
            玉
          </div>
          <h2 className="text-center text-xl font-semibold text-ink">
            対戦に参加する
          </h2>
          <p className="mt-3 text-center text-sm leading-relaxed text-muted">
            あなたは<span className="font-semibold text-ink">後手</span>として
            参加します。先手の相手が待っています。
          </p>
          <button
            type="button"
            onClick={handleJoin}
            disabled={joining}
            data-testid="join-gote"
            className="mt-6 w-full rounded-xl bg-accent px-6 py-4 text-base font-semibold text-black transition active:scale-[0.98] disabled:opacity-60"
          >
            {joining ? "参加中…" : "後手で参加する"}
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
  const isMyTurn = state.status === "playing" && state.currentTurn === myRole;
  const interactive = isMyTurn && !submitting && !pendingPromotion;
  // Phase 12 P0-1: render from the viewer's perspective — own pieces/hand at the
  // bottom. The board flip is display-only (logic coords unchanged); the hand trays
  // place the opponent on top and the viewer on the bottom. Spectators default to
  // sente's view.
  const viewer: Player = myRole ?? "sente";
  const topOwner: Player = viewer === "gote" ? "sente" : "gote";
  const bottomOwner: Player = viewer === "gote" ? "gote" : "sente";

  // Legal destinations for the current selection (board move or drop).
  const legalTargets = new Set<string>();
  if (interactive) {
    if (dropType) {
      for (const m of getLegalDrops(state.position, dropType)) {
        legalTargets.add(squareKey(m.to.row, m.to.col));
      }
    } else if (selected) {
      for (const m of getLegalMoves(state.position, selected)) {
        legalTargets.add(squareKey(m.to.row, m.to.col));
      }
    }
  }

  const checkSquare =
    state.check && state.status === "playing"
      ? findKing(displayPosition, state.currentTurn)
      : null;
  const showCheck = state.check && state.status === "playing";

  const promotePiece =
    pendingPromotion && myRole
      ? state.position.board[pendingPromotion.from.row][pendingPromotion.from.col]
      : null;

  return (
    <Shell>
      <header className="mb-4 flex w-full items-center justify-between">
        <Link
          href="/"
          className="text-sm font-semibold tracking-tight text-muted transition hover:text-ink"
        >
          将棋
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
          王手！
        </p>
      )}

      {/* Opponent's hand sits above the board (from the viewer's perspective). */}
      <HandTray
        owner={topOwner}
        hands={displayPosition.hands}
        interactive={interactive && myRole === topOwner}
        selected={myRole === topOwner ? dropType : null}
        isYou={myRole === topOwner}
        onPick={handleHandClick}
      />

      <div className="relative mt-3 w-full">
        <Board
          position={displayPosition}
          interactive={interactive}
          selected={selected}
          legalTargets={legalTargets}
          lastMove={lastMove}
          checkSquare={checkSquare}
          onSquareClick={handleSquareClick}
          viewer={viewer}
        />

        {pendingPromotion && promotePiece && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50">
            <div className="rounded-2xl border border-line bg-surface p-4 shadow-2xl">
              <p className="mb-3 text-center text-sm font-semibold text-ink">
                成りますか？
              </p>
              <div className="flex gap-3">
                <button
                  type="button"
                  data-testid="promote-yes"
                  onClick={() =>
                    void submitMove({
                      from: pendingPromotion.from,
                      to: pendingPromotion.to,
                      promote: true,
                    })
                  }
                  className="rounded-xl border border-accent bg-accent/10 px-5 py-3 text-base font-semibold text-ink transition active:scale-[0.96]"
                >
                  成る
                </button>
                <button
                  type="button"
                  data-testid="promote-no"
                  onClick={() =>
                    void submitMove({
                      from: pendingPromotion.from,
                      to: pendingPromotion.to,
                      promote: false,
                    })
                  }
                  className="rounded-xl border border-line bg-raised px-5 py-3 text-base font-semibold text-ink transition active:scale-[0.96]"
                >
                  不成
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* The viewer's own hand sits below the board. */}
      <HandTray
        owner={bottomOwner}
        hands={displayPosition.hands}
        interactive={interactive && myRole === bottomOwner}
        selected={myRole === bottomOwner ? dropType : null}
        isYou={myRole === bottomOwner}
        onPick={handleHandClick}
      />

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

      {finished && (
        <ResultPanel
          state={state}
          myRole={myRole}
          onRematch={handleRematch}
          rematchBusy={rematchBusy}
        />
      )}
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

function HandTray({
  owner,
  hands,
  interactive,
  selected,
  isYou,
  onPick,
}: {
  owner: Player;
  hands: Hands;
  interactive: boolean;
  selected: DroppableType | null;
  isYou: boolean;
  onPick: (owner: Player, type: DroppableType) => void;
}) {
  const entries = DROPPABLE_TYPES.filter((t) => (hands[owner][t] ?? 0) > 0);
  return (
    <div
      data-testid={`hand-${owner}`}
      className="mt-3 flex min-h-[2.75rem] w-full flex-wrap items-center gap-1.5 rounded-xl border border-line bg-surface px-3 py-2"
    >
      <span className="mr-1 text-xs font-medium text-muted">
        {roleLabel(owner)}の持ち駒
        {isYou && <span className="ml-1 text-accent">（あなた）</span>}
      </span>
      {entries.length === 0 ? (
        <span className="text-xs text-muted">なし</span>
      ) : (
        entries.map((t) => {
          const count = hands[owner][t] ?? 0;
          const isSel = selected === t;
          return (
            <button
              key={t}
              type="button"
              disabled={!interactive}
              onClick={interactive ? () => onPick(owner, t) : undefined}
              data-testid={`hand-${owner}-${typeCode(t)}`}
              className={[
                "flex items-center gap-0.5 rounded-md border px-2 py-1 text-lg font-semibold leading-none text-zinc-900 transition",
                isSel ? "border-accent bg-accent/40" : "border-amber-950/30",
                interactive ? "cursor-pointer hover:border-accent" : "cursor-default",
              ].join(" ")}
              style={{ backgroundColor: isSel ? undefined : "#eccf9b" }}
            >
              <span aria-hidden>{GLYPH[typeCode(t)]}</span>
              <span className="text-xs font-bold text-zinc-800">×{count}</span>
            </button>
          );
        })
      )}
    </div>
  );
}

function SeatCard({
  player,
  isTurn,
  isYou,
  present,
}: {
  player: Player;
  isTurn: boolean;
  isYou: boolean;
  present: boolean;
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
      <span aria-hidden className="text-2xl leading-none text-ink">
        玉
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
          {present ? (isTurn ? "手番です" : "待機中") : "未参加"}
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
        player="sente"
        isTurn={state.status === "playing" && state.currentTurn === "sente"}
        isYou={myRole === "sente"}
        present={state.seats.sente}
      />
      <SeatCard
        player="gote"
        isTurn={state.status === "playing" && state.currentTurn === "gote"}
        isYou={myRole === "gote"}
        present={state.seats.gote}
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
  onRematch,
  rematchBusy,
}: {
  state: PublicRoomState;
  myRole: Player | null;
  onRematch: () => void;
  rematchBusy: boolean;
}) {
  const { winner } = state;
  let headline: string;
  if (winner && myRole && winner === myRole) {
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

      <RematchControls
        rematch={state.rematch}
        onRematch={onRematch}
        busy={rematchBusy}
      />

      <div className="mt-4 border-t border-line pt-4">
        <CreateRoomButton label="別のルームを新しく作る" />
        <Link
          href="/"
          className="mt-3 block text-center text-sm text-muted underline underline-offset-4"
        >
          ゲーム一覧へ戻る
        </Link>
      </div>
    </section>
  );
}
