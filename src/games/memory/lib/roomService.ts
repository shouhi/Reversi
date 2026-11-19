import {
  buildDeck,
  cardsMatch,
  isAllMatched,
  opponent,
  winnerByScore,
  CARD_COUNT,
  type Player,
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
const SEATS: readonly Player[] = ["p1", "p2"];

/** The 神経衰弱 room store: a versioned-record KV store of RoomState. */
export type RoomStore = KvStore<RoomState>;

/** Redis key prefix for 神経衰弱 rooms (namespaced per the game conventions). */
export const MEMORY_ROOM_PREFIX = "memory:room:";

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

function roleOf(state: RoomState, tokenHash: string | null): Player | null {
  if (!tokenHash) return null;
  if (tokenHash === state.p1TokenHash) return "p1";
  if (tokenHash === state.p2TokenHash) return "p2";
  return null;
}

/**
 * Builds the client-safe view. Strips token hashes AND hides every face-down
 * card's symbol: a card's `value` is non-null ONLY when it is matched or
 * currently revealed. Otherwise the client sees null and cannot read the layout.
 */
export function toPublicRoomState(
  state: RoomState,
  callerTokenHash: string | null,
): PublicRoomState {
  const revealedSet = new Set(state.revealed);
  const rematch = getRematch(state);
  return {
    roomId: state.roomId,
    cards: state.cards.map((card, index) => ({
      value:
        card.matchedBy !== null || revealedSet.has(index) ? card.value : null,
      matchedBy: card.matchedBy,
    })),
    revealed: state.revealed,
    scores: state.scores,
    currentTurn: state.currentTurn,
    status: state.status,
    winner: state.winner,
    version: state.version,
    roundId: rematch.roundId,
    rematch: toRematchView(rematch, roleOf(state, callerTokenHash)),
    seats: {
      p1: Boolean(state.p1TokenHash),
      p2: state.p2TokenHash !== null,
    },
    yourRole: roleOf(state, callerTokenHash),
  };
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export interface CreateRoomResult {
  roomId: string;
  /** Raw p1 token — returned exactly once, to the creator. */
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
      cards: buildDeck(),
      revealed: [],
      scores: { p1: 0, p2: 0 },
      currentTurn: "p1",
      status: "waiting",
      winner: null,
      p1TokenHash: tokenHash,
      p2TokenHash: null,
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
// Join (as p2)
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

    // The p2 seat is taken (or the game already moved on) → full.
    if (state.p2TokenHash !== null || state.status !== "waiting") {
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
      p2TokenHash: newHash,
      status: "playing",
      currentTurn: "p1",
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
// Play a move (flip a card)
// ---------------------------------------------------------------------------

export async function playMove(
  store: RoomStore,
  roomId: string,
  token: string | null,
  index: number,
  /**
   * The round the client believes it is playing. When provided, a flip whose
   * round no longer matches the server's is rejected (an old game's operation is
   * never applied to a new one). Omitted by legacy callers → no round check.
   */
  expectedRoundId?: number,
): Promise<Result<PublicRoomState>> {
  if (!Number.isInteger(index) || index < 0 || index >= CARD_COUNT) {
    return fail("invalid_request", "Card index is out of range.");
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
    if (state.cards[index].matchedBy !== null) {
      return fail("illegal_move", "That card is already matched.", view());
    }
    if (state.revealed.includes(index)) {
      return fail("illegal_move", "That card is already face up.", view());
    }

    // All checks passed — the server computes the result. Work on copies.
    const cards = state.cards.map((card) => ({ ...card }));
    let revealed = [...state.revealed];
    const scores = { ...state.scores };
    let currentTurn: Player = state.currentTurn;
    let status: RoomState["status"] = state.status;
    let winner: RoomState["winner"] = state.winner;

    // Leftover-mismatch clearing: a length-2 reveal is last turn's unmatched
    // pair. Clear it first, then this flip becomes the new first flip.
    if (revealed.length === 2) {
      revealed = [];
    }

    if (revealed.length === 0) {
      // First flip of the turn. Turn stays with the current player.
      revealed = [index];
    } else {
      // Second flip. Evaluate the two revealed cards.
      const first = revealed[0];
      revealed = [first, index];
      if (cardsMatch(cards, first, index)) {
        // Match: both cards go to this player; score up; play again.
        cards[first].matchedBy = role;
        cards[index].matchedBy = role;
        scores[role] += 1;
        revealed = [];
        if (isAllMatched(cards)) {
          status = "finished";
          winner = winnerByScore(scores);
        }
        // else: turn stays with current player.
      } else {
        // Mismatch: leave both face-up; turn passes to the opponent.
        currentTurn = opponent(role);
      }
    }

    const nextState: RoomState = {
      ...state,
      cards,
      revealed,
      scores,
      currentTurn,
      status,
      winner,
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
 * ONLY once BOTH players have voted; a single vote never resets the board. On
 * start the deck is RE-SHUFFLED server-side via `buildDeck()` (the client never
 * decides the layout and never sees face-down symbols), all cards return
 * face-down, scores reset to 0, revealed clears, and the seats swap so the
 * previous p2 goes first. Concurrency-safe via CAS.
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
          cards: buildDeck(), // server-side re-shuffle; all cards face-down
          revealed: [],
          scores: { p1: 0, p2: 0 },
          currentTurn: "p1",
          status: "playing",
          winner: null,
          // Swap seats: the previous p2 becomes p1 (first). Both are present
          // because the game is finished (it cannot finish with one player).
          p1TokenHash: state.p2TokenHash ?? state.p1TokenHash,
          p2TokenHash: state.p1TokenHash,
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
