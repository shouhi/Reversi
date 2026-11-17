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
import type { PublicRoomState, RoomState } from "../types";
import type { KvStore } from "@/lib/store";

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
  return {
    roomId: state.roomId,
    position: state.position,
    currentTurn: state.currentTurn,
    status: state.status,
    winner: state.winner,
    lastMove: state.lastMove,
    check: state.check,
    version: state.version,
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
