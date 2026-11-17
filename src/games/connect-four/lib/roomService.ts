import {
  applyMove as applyMoveToBoard,
  createInitialBoard,
  getGameResult,
  getDropRow,
  getNextTurn,
  isColumnPlayable,
  type Player,
} from "./engine";
import { generateRoomId, generateToken, hashToken } from "@/lib/tokens";
import type { PublicRoomState, RoomState } from "../types";
import type { KvStore } from "@/lib/store";

/** The Connect Four room store: a versioned-record KV store of RoomState. */
export type RoomStore = KvStore<RoomState>;

/** Redis key prefix for Connect Four rooms (namespaced per the game conventions). */
export const CONNECT_FOUR_ROOM_PREFIX = "connect-four:room:";

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

function roleOf(state: RoomState, tokenHash: string | null): Player | null {
  if (!tokenHash) return null;
  if (tokenHash === state.redTokenHash) return "red";
  if (tokenHash === state.yellowTokenHash) return "yellow";
  return null;
}

/** Builds the client-safe view, stripping all token hashes. */
export function toPublicRoomState(
  state: RoomState,
  callerTokenHash: string | null,
): PublicRoomState {
  return {
    roomId: state.roomId,
    board: state.board,
    currentTurn: state.currentTurn,
    status: state.status,
    winner: state.winner,
    lastMove: state.lastMove,
    winningLine: state.winningLine,
    version: state.version,
    seats: {
      red: Boolean(state.redTokenHash),
      yellow: state.yellowTokenHash !== null,
    },
    yourRole: roleOf(state, callerTokenHash),
  };
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export interface CreateRoomResult {
  roomId: string;
  /** Raw red-player token — returned exactly once, to the creator. */
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
      board: createInitialBoard(),
      currentTurn: "red",
      status: "waiting",
      winner: null,
      redTokenHash: tokenHash,
      yellowTokenHash: null,
      lastMove: null,
      winningLine: null,
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
// Join (as yellow)
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

    // The yellow seat is taken (or the game already moved on) → full.
    if (state.yellowTokenHash !== null || state.status !== "waiting") {
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
      yellowTokenHash: newHash,
      status: "playing",
      currentTurn: "red",
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

export async function playMove(
  store: RoomStore,
  roomId: string,
  token: string | null,
  col: number,
): Promise<Result<PublicRoomState>> {
  if (!Number.isInteger(col) || col < 0 || col > 6) {
    return fail("invalid_request", "Column is out of range.");
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
    if (!isColumnPlayable(state.board, col)) {
      return fail("illegal_move", "That column is full.", view());
    }

    // All checks passed — the server computes the resulting board & turn.
    const dropRow = getDropRow(state.board, col);
    const nextBoard = applyMoveToBoard(state.board, col, role);
    const nextTurn = getNextTurn(nextBoard, role);

    let status: RoomState["status"] = "playing";
    let winner: RoomState["winner"] = null;
    let winningLine: RoomState["winningLine"] = null;
    let currentTurn: Player = state.currentTurn;

    if (nextTurn === null) {
      status = "finished";
      const result = getGameResult(nextBoard);
      winner = result.winner;
      winningLine = result.line;
    } else {
      currentTurn = nextTurn;
    }

    const nextState: RoomState = {
      ...state,
      board: nextBoard,
      currentTurn,
      status,
      winner,
      winningLine,
      lastMove: { row: dropRow, col },
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
