import {
  applyMove,
  createInitialPosition,
  getGameStatus,
  getLegalMoves,
  isInCheck,
  opponent,
  sameSquare,
  type Color,
  type Coord,
  type PieceType,
} from "./engine";
import { generateRoomId, generateToken, hashToken } from "@/lib/tokens";
import {
  addVote,
  allVoted,
  getRematch,
  hasVoted,
  initialRematch,
  nextRound,
  toRematchView,
} from "@/lib/rematch";
import type { PublicRoomState, RoomState } from "../types";
import type { KvStore } from "@/lib/store";

/** The two seats, used by the rematch consent check. */
const SEATS: readonly Color[] = ["white", "black"];

/** The Chess room store: a versioned-record KV store of RoomState. */
export type RoomStore = KvStore<RoomState>;

/** Redis key prefix for Chess rooms (namespaced per the game conventions). */
export const CHESS_ROOM_PREFIX = "chess:room:";

/** Rooms live for 24 hours; every write refreshes the TTL. */
export const ROOM_TTL_SECONDS = 24 * 60 * 60;
const MAX_CAS_RETRIES = 6;
const MAX_CREATE_RETRIES = 5;

export type ServiceErrorCode =
  | "not_found"
  | "invalid_request"
  | "not_a_player"
  | "room_full"
  | "game_not_active"
  | "game_over"
  | "not_your_turn"
  | "illegal_move"
  | "rematch_unavailable"
  | "stale_round"
  | "version_conflict";

export interface ServiceError {
  code: ServiceErrorCode;
  message: string;
  /** When present, the latest server state so the client can re-sync. */
  publicState?: PublicRoomState;
}

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: ServiceError };

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = <T>(
  code: ServiceErrorCode,
  message: string,
  publicState?: PublicRoomState,
): Result<T> => ({ ok: false, error: { code, message, publicState } });

function now(): number {
  return Date.now();
}

function roleOf(state: RoomState, tokenHash: string | null): Color | null {
  if (!tokenHash) return null;
  if (tokenHash === state.whiteTokenHash) return "white";
  if (tokenHash === state.blackTokenHash) return "black";
  return null;
}

/** Builds the client-safe view, stripping all token hashes. */
export function toPublicRoomState(
  state: RoomState,
  callerTokenHash: string | null,
): PublicRoomState {
  const rematch = getRematch(state);
  return {
    roomId: state.roomId,
    position: state.position,
    currentTurn: state.currentTurn,
    status: state.status,
    winner: state.winner,
    lastMove: state.lastMove,
    check: state.check,
    version: state.version,
    roundId: rematch.roundId,
    rematch: toRematchView(rematch, roleOf(state, callerTokenHash)),
    seats: {
      white: Boolean(state.whiteTokenHash),
      black: state.blackTokenHash !== null,
    },
    yourRole: roleOf(state, callerTokenHash),
  };
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export interface CreateRoomResult {
  roomId: string;
  /** Raw White-player token — returned exactly once, to the creator. */
  token: string;
  publicState: PublicRoomState;
}

export async function createRoom(
  store: RoomStore,
): Promise<Result<CreateRoomResult>> {
  const token = generateToken();
  const tokenHash = hashToken(token);

  for (let attempt = 0; attempt < MAX_CREATE_RETRIES; attempt++) {
    const roomId = generateRoomId();
    const timestamp = now();
    const state: RoomState = {
      roomId,
      position: createInitialPosition(),
      currentTurn: "white",
      status: "waiting",
      winner: null,
      lastMove: null,
      check: false,
      whiteTokenHash: tokenHash,
      blackTokenHash: null,
      rematch: initialRematch(),
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    const created = await store.create(roomId, state, ROOM_TTL_SECONDS);
    if (created) {
      return ok({
        roomId,
        token,
        publicState: toPublicRoomState(state, tokenHash),
      });
    }
    // Astronomically unlikely id collision — just try a fresh id.
  }

  return fail("version_conflict", "Could not allocate a unique room id.");
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function getRoomView(
  store: RoomStore,
  roomId: string,
  token: string | null,
): Promise<Result<PublicRoomState>> {
  const state = await store.get(roomId);
  if (!state) {
    return fail(
      "not_found",
      "This room does not exist or has expired. Create a new one to play.",
    );
  }
  return ok(toPublicRoomState(state, token ? hashToken(token) : null));
}

// ---------------------------------------------------------------------------
// Join (as Black)
// ---------------------------------------------------------------------------

export interface JoinRoomResult {
  /** Present only when a NEW seat was claimed; absent on reconnect. */
  token?: string;
  publicState: PublicRoomState;
}

export async function joinRoom(
  store: RoomStore,
  roomId: string,
  token: string | null,
): Promise<Result<JoinRoomResult>> {
  const callerHash = token ? hashToken(token) : null;

  for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
    const state = await store.get(roomId);
    if (!state) {
      return fail(
        "not_found",
        "This room does not exist or has expired. Create a new one to play.",
      );
    }

    // Already seated with a valid token → this is a reconnect, not a new join.
    const existingRole = roleOf(state, callerHash);
    if (existingRole) {
      return ok({ publicState: toPublicRoomState(state, callerHash) });
    }

    // The Black seat is taken (or the game already moved on) → full.
    if (state.blackTokenHash !== null || state.status !== "waiting") {
      return fail(
        "room_full",
        "This room is already full (two players).",
        toPublicRoomState(state, callerHash),
      );
    }

    const newToken = generateToken();
    const newHash = hashToken(newToken);
    const nextState: RoomState = {
      ...state,
      blackTokenHash: newHash,
      status: "playing",
      currentTurn: "white",
      rematch: getRematch(state),
      version: state.version + 1,
      updatedAt: now(),
    };

    const cas = await store.compareAndSwap(
      roomId,
      state.version,
      nextState,
      ROOM_TTL_SECONDS,
    );
    if (cas === "ok") {
      return ok({
        token: newToken,
        publicState: toPublicRoomState(nextState, newHash),
      });
    }
    if (cas === "not_found") {
      return fail("not_found", "This room no longer exists.");
    }
    // conflict → another request changed the room; loop re-reads and re-evaluates.
  }

  return fail(
    "version_conflict",
    "The room is changing too quickly. Please try again.",
  );
}

// ---------------------------------------------------------------------------
// Play a move
// ---------------------------------------------------------------------------

function isCoord(c: unknown): c is Coord {
  if (typeof c !== "object" || c === null) return false;
  const { row, col } = c as { row?: unknown; col?: unknown };
  return (
    Number.isInteger(row) &&
    Number.isInteger(col) &&
    (row as number) >= 0 &&
    (row as number) <= 7 &&
    (col as number) >= 0 &&
    (col as number) <= 7
  );
}

export async function playMove(
  store: RoomStore,
  roomId: string,
  token: string | null,
  from: Coord,
  to: Coord,
  promotion?: PieceType,
  /**
   * The round the client believes it is playing. When provided, a move whose
   * round no longer matches the server's is rejected (an old game's operation —
   * e.g. a stale promotion — is never applied to a new one). Omitted by legacy
   * callers → no round check.
   */
  expectedRoundId?: number,
): Promise<Result<PublicRoomState>> {
  if (!isCoord(from) || !isCoord(to)) {
    return fail("invalid_request", "Move coordinates are out of range.");
  }
  if (!token) {
    return fail("not_a_player", "A player token is required to move.");
  }
  const tokenHash = hashToken(token);

  for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
    const state = await store.get(roomId);
    if (!state) {
      return fail("not_found", "This room does not exist or has expired.");
    }

    const role = roleOf(state, tokenHash);
    if (!role) {
      return fail("not_a_player", "You are not a player in this room.");
    }

    const view = () => toPublicRoomState(state, tokenHash);

    if (
      expectedRoundId !== undefined &&
      expectedRoundId !== getRematch(state).roundId
    ) {
      return fail(
        "stale_round",
        "This game has moved on to a new round. Re-syncing…",
        view(),
      );
    }

    if (state.status === "finished") {
      return fail("game_over", "This game has already finished.", view());
    }
    if (state.status !== "playing") {
      return fail(
        "game_not_active",
        "The game has not started yet — waiting for a second player.",
        view(),
      );
    }
    if (state.currentTurn !== role) {
      return fail("not_your_turn", "It is not your turn.", view());
    }

    // Validate against the legal moves for the piece on `from`.
    const legal = getLegalMoves(state.position, from);
    const candidates = legal.filter((m) => sameSquare(m.to, to));
    if (candidates.length === 0) {
      return fail("illegal_move", "That is not a legal move.", view());
    }
    const isPromotion = candidates.some((m) => m.flags?.promotion);
    if (isPromotion) {
      const wanted = promotion ?? "q";
      if (!candidates.some((m) => m.promotion === wanted)) {
        return fail("illegal_move", "Invalid promotion piece.", view());
      }
    }

    // All checks passed — the server computes the resulting position.
    const nextPosition = applyMove(state.position, { from, to, promotion });
    const outcome = getGameStatus(nextPosition);

    let status: RoomState["status"] = "playing";
    let winner: RoomState["winner"] = null;
    const currentTurn: Color = nextPosition.activeColor;

    if (outcome === "checkmate") {
      status = "finished";
      // The side to move is mated → the player who just moved wins.
      winner = opponent(nextPosition.activeColor);
    } else if (outcome === "stalemate") {
      status = "finished";
      winner = "draw";
    }

    const check = isInCheck(nextPosition, nextPosition.activeColor);

    const nextState: RoomState = {
      ...state,
      position: nextPosition,
      currentTurn,
      status,
      winner,
      check,
      lastMove: { from: { ...from }, to: { ...to } },
      rematch: getRematch(state),
      version: state.version + 1,
      updatedAt: now(),
    };

    const cas = await store.compareAndSwap(
      roomId,
      state.version,
      nextState,
      ROOM_TTL_SECONDS,
    );
    if (cas === "ok") {
      return ok(toPublicRoomState(nextState, tokenHash));
    }
    if (cas === "not_found") {
      return fail("not_found", "This room no longer exists.");
    }
    // conflict → re-read and re-validate against the latest state.
  }

  // Exhausted retries: hand back the freshest state we can so the client re-syncs.
  const latest = await store.get(roomId);
  return fail(
    "version_conflict",
    "The board changed while you were moving. Re-syncing…",
    latest ? toPublicRoomState(latest, tokenHash) : undefined,
  );
}

// ---------------------------------------------------------------------------
// Rematch (same room, same players) — two-sided consent, server-authoritative
// ---------------------------------------------------------------------------

/**
 * Records the caller's rematch vote for the finished game. A new round starts
 * ONLY once BOTH players have voted; a single vote never resets the board. The
 * whole position is rebuilt from `createInitialPosition()` — so castling rights,
 * en-passant, check/mate state and the half-move clock all reset cleanly — and
 * the seats are swapped so the previous Black plays White (first), preserving the
 * "White opens" rule. Concurrency-safe via CAS.
 */
export async function requestRematch(
  store: RoomStore,
  roomId: string,
  token: string | null,
  /** The round the client is voting on; a stale id is rejected. */
  expectedRoundId?: number,
): Promise<Result<PublicRoomState>> {
  if (!token) {
    return fail("not_a_player", "A player token is required to rematch.");
  }
  const tokenHash = hashToken(token);

  for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
    const state = await store.get(roomId);
    if (!state) {
      return fail("not_found", "This room does not exist or has expired.");
    }

    const role = roleOf(state, tokenHash);
    if (!role) {
      return fail("not_a_player", "You are not a player in this room.");
    }

    const view = () => toPublicRoomState(state, tokenHash);
    const rematch = getRematch(state);

    if (state.status !== "finished") {
      return fail(
        "rematch_unavailable",
        "A rematch can only be requested after the game has finished.",
        view(),
      );
    }
    if (expectedRoundId !== undefined && expectedRoundId !== rematch.roundId) {
      return fail(
        "stale_round",
        "This room has already moved on. Re-syncing…",
        view(),
      );
    }

    // Idempotent: a repeat vote that cannot yet start a round is a no-op.
    if (hasVoted(rematch, role) && !allVoted(rematch, SEATS)) {
      return ok(view());
    }

    const voted = addVote(rematch, role);
    const starting = allVoted(voted, SEATS);

    const nextState: RoomState = starting
      ? {
          ...state,
          position: createInitialPosition(),
          currentTurn: "white",
          status: "playing",
          winner: null,
          lastMove: null,
          check: false,
          // Swap seats: the previous Black becomes White (first). Both are present
          // because the game is finished (it cannot finish with one player).
          whiteTokenHash: state.blackTokenHash ?? state.whiteTokenHash,
          blackTokenHash: state.whiteTokenHash,
          rematch: nextRound(voted),
          version: state.version + 1,
          updatedAt: now(),
        }
      : {
          ...state,
          rematch: voted,
          version: state.version + 1,
          updatedAt: now(),
        };

    const cas = await store.compareAndSwap(
      roomId,
      state.version,
      nextState,
      ROOM_TTL_SECONDS,
    );
    if (cas === "ok") {
      return ok(toPublicRoomState(nextState, tokenHash));
    }
    if (cas === "not_found") {
      return fail("not_found", "This room no longer exists.");
    }
    // conflict → another request changed the room; loop re-reads and re-evaluates.
  }

  const latest = await store.get(roomId);
  return fail(
    "version_conflict",
    "The room is changing too quickly. Please try again.",
    latest ? toPublicRoomState(latest, tokenHash) : undefined,
  );
}
