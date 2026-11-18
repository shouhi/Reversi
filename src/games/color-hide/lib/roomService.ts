import {
  generateRoomId,
  generateToken,
  hashToken,
} from "@/lib/tokens";
import type { KvStore } from "@/lib/store";
import {
  DEFAULT_MAP_ID,
  DISCONNECT_TIMEOUT_MS,
  MAP_IDS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  ROOM_TTL_SECONDS,
  type MapId,
} from "./constants";
import { advancePhase, phaseDurationMs } from "./phases";
import { allHidersCaught, buildRoundResult } from "./winner";
import type {
  PlayerRecord,
  PublicPlayer,
  PublicRoomState,
  RoomState,
  Role,
} from "../types";

/** The COLOR HIDE room store: a versioned-record KV store of RoomState. */
export type RoomStore = KvStore<RoomState>;

/** Redis key prefix for COLOR HIDE rooms (own namespace — never reversi's). */
export const COLOR_HIDE_ROOM_PREFIX = "color-hide:room:";

const MAX_CAS_RETRIES = 6;
const MAX_CREATE_RETRIES = 5;

export type ServiceErrorCode =
  | "not_found"
  | "invalid_request"
  | "not_a_player"
  | "not_host"
  | "room_full"
  | "game_in_progress"
  | "not_enough_players"
  | "not_all_ready"
  | "bad_phase"
  | "version_conflict";

export interface ServiceError {
  code: ServiceErrorCode;
  message: string;
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Clamps a user-supplied nickname to something safe + bounded. */
export function sanitizeNickname(raw: unknown): string {
  if (typeof raw !== "string") return "プレイヤー";
  const trimmed = raw.trim().slice(0, 20);
  return trimmed.length > 0 ? trimmed : "プレイヤー";
}

function playerByHash(
  state: RoomState,
  tokenHash: string | null,
): PlayerRecord | undefined {
  if (!tokenHash) return undefined;
  return state.players.find((p) => p.tokenHash === tokenHash);
}

function isConnected(p: PlayerRecord, now: number): boolean {
  return now - p.lastSeen <= DISCONNECT_TIMEOUT_MS;
}

function toPublicPlayer(p: PlayerRecord, now: number): PublicPlayer {
  return {
    id: p.id,
    nickname: p.nickname,
    isHost: p.isHost,
    ready: p.ready,
    role: p.role,
    caught: p.caught,
    connected: isConnected(p, now),
  };
}

/**
 * Builds the client-safe view. The caller's own role is always included; other
 * players' roles are visible too (knowing who the seeker is is part of the game),
 * but token hashes never leave the server. Live positions are NOT here — those
 * come over the realtime channel, gated by server-side visibility.
 */
export function toPublicRoomState(
  state: RoomState,
  callerHash: string | null,
  now: number,
): PublicRoomState {
  const me = playerByHash(state, callerHash);
  return {
    roomId: state.roomId,
    phase: state.phase,
    phaseStartedAt: state.phaseStartedAt,
    phaseDurationMs: phaseDurationMs(state.phase),
    mapId: state.mapId,
    players: state.players.map((p) => toPublicPlayer(p, now)),
    seekerId: state.seekerId,
    round: state.round,
    result: state.result,
    version: state.version,
    yourId: me?.id ?? null,
    yourRole: me?.role ?? null,
    serverNow: now,
  };
}

// ---------------------------------------------------------------------------
// Pure phase progression (used by reads, mutations, and the realtime server)
// ---------------------------------------------------------------------------

/** Resets the roster back to a fresh lobby (keeps players, drops round state). */
function resetForLobby(state: RoomState, now: number): RoomState {
  return {
    ...state,
    phase: "lobby",
    phaseStartedAt: now,
    seekerId: null,
    // Remember who was the seeker so the next round can rotate away from them.
    prevSeekerId: state.seekerId ?? state.prevSeekerId ?? null,
    players: state.players.map((p) => ({
      ...p,
      role: null,
      caught: false,
      ready: false,
    })),
  };
}

/**
 * Advances a room's phase to match the server clock, applying the side effects
 * of each boundary it crosses (freeze the result when the round ends; reset the
 * roster when returning to the lobby). Pure — returns a new state (or the same
 * reference when nothing changed). Both the HTTP service and the realtime server
 * call this so every tier agrees on the current phase.
 */
export function applyPhaseProgress(state: RoomState, now: number): RoomState {
  if (state.phase === "lobby") return state;

  const next = advancePhase(
    { phase: state.phase, phaseStartedAt: state.phaseStartedAt },
    now,
  );
  if (next.phase === state.phase) return state;

  // The round's active play has ended if we've reached (or passed) `result`.
  const roundEnded = next.phase === "result" || next.phase === "lobby";
  let result = state.result;
  if (roundEnded && state.seekerId && state.phase !== "result") {
    result = buildRoundResult(state.players, state.seekerId, next.phaseStartedAt);
  }

  if (next.phase === "lobby") {
    return { ...resetForLobby(state, next.phaseStartedAt), result };
  }

  return {
    ...state,
    phase: next.phase,
    phaseStartedAt: next.phaseStartedAt,
    result,
  };
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export interface CreateRoomResult {
  roomId: string;
  token: string;
  playerId: string;
  publicState: PublicRoomState;
}

export async function createRoom(
  store: RoomStore,
  nickname: unknown,
  now: number = Date.now(),
): Promise<Result<CreateRoomResult>> {
  const token = generateToken();
  const tokenHash = hashToken(token);
  const playerId = generateRoomId(10);

  for (let attempt = 0; attempt < MAX_CREATE_RETRIES; attempt++) {
    const roomId = generateRoomId();
    const host: PlayerRecord = {
      id: playerId,
      tokenHash,
      nickname: sanitizeNickname(nickname),
      isHost: true,
      ready: false,
      role: null,
      caught: false,
      lastSeen: now,
      joinedAt: now,
    };
    const state: RoomState = {
      roomId,
      phase: "lobby",
      phaseStartedAt: now,
      mapId: DEFAULT_MAP_ID,
      players: [host],
      seekerId: null,
      round: 0,
      result: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };

    const created = await store.create(roomId, state, ROOM_TTL_SECONDS);
    if (created) {
      return ok({
        roomId,
        token,
        playerId,
        publicState: toPublicRoomState(state, tokenHash, now),
      });
    }
    // Astronomically unlikely id collision — try a fresh id.
  }
  return fail("version_conflict", "Could not allocate a unique room id.");
}

/**
 * Resolves the caller's own player id from their token (server-side), or null.
 * Used by paint commits so ownership is derived from the secret token, never from
 * a client-supplied id.
 */
export async function resolvePlayerId(
  store: RoomStore,
  roomId: string,
  token: string | null,
): Promise<string | null> {
  if (!token) return null;
  const state = await store.get(roomId);
  if (!state) return null;
  const hash = hashToken(token);
  return state.players.find((p) => p.tokenHash === hash)?.id ?? null;
}

// ---------------------------------------------------------------------------
// Read (lazy phase tick + heartbeat)
// ---------------------------------------------------------------------------

/**
 * Reads the room, rolling its phase forward to the server clock and refreshing
 * the caller's heartbeat. Persists via CAS when anything changed; a conflict
 * just means someone else advanced it first, so we re-read.
 */
export async function getRoomView(
  store: RoomStore,
  roomId: string,
  token: string | null,
  now: number = Date.now(),
): Promise<Result<PublicRoomState>> {
  const callerHash = token ? hashToken(token) : null;

  for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
    const state = await store.get(roomId);
    if (!state) {
      return fail(
        "not_found",
        "This room does not exist or has expired. Create a new one to play.",
      );
    }

    const progressed = applyPhaseProgress(state, now);
    const me = playerByHash(progressed, callerHash);

    // Nothing to persist: phase unchanged and caller is not a member (no beat).
    if (progressed === state && !me) {
      return ok(toPublicRoomState(state, callerHash, now));
    }

    const nextPlayers = me
      ? progressed.players.map((p) =>
          p.tokenHash === callerHash ? { ...p, lastSeen: now } : p,
        )
      : progressed.players;

    const nextState: RoomState = {
      ...progressed,
      players: nextPlayers,
      version: state.version + 1,
      updatedAt: now,
    };

    const cas = await store.compareAndSwap(
      roomId,
      state.version,
      nextState,
      ROOM_TTL_SECONDS,
    );
    if (cas === "ok") return ok(toPublicRoomState(nextState, callerHash, now));
    if (cas === "not_found") return fail("not_found", "This room no longer exists.");
    // conflict → re-read and retry.
  }

  const latest = await store.get(roomId);
  return ok(
    toPublicRoomState(latest ?? (await mustGet(store, roomId)), callerHash, now),
  );
}

async function mustGet(store: RoomStore, roomId: string): Promise<RoomState> {
  const s = await store.get(roomId);
  if (!s) throw new Error(`room ${roomId} vanished`);
  return s;
}

// ---------------------------------------------------------------------------
// Join
// ---------------------------------------------------------------------------

export interface JoinRoomResult {
  token?: string;
  playerId: string;
  publicState: PublicRoomState;
}

export async function joinRoom(
  store: RoomStore,
  roomId: string,
  token: string | null,
  nickname: unknown,
  now: number = Date.now(),
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

    // Reconnect: an existing member just refreshes their heartbeat.
    const existing = playerByHash(state, callerHash);
    if (existing) {
      const nextState: RoomState = {
        ...applyPhaseProgress(state, now),
        version: state.version + 1,
        updatedAt: now,
      };
      nextState.players = nextState.players.map((p) =>
        p.tokenHash === callerHash ? { ...p, lastSeen: now } : p,
      );
      const cas = await store.compareAndSwap(roomId, state.version, nextState, ROOM_TTL_SECONDS);
      if (cas === "ok") {
        return ok({
          playerId: existing.id,
          publicState: toPublicRoomState(nextState, callerHash, now),
        });
      }
      if (cas === "not_found") return fail("not_found", "This room no longer exists.");
      continue;
    }

    // New player: only allowed in the lobby, and only up to the cap.
    if (state.phase !== "lobby") {
      return fail(
        "game_in_progress",
        "A round is already underway. Wait for it to finish, then join from the lobby.",
        toPublicRoomState(state, callerHash, now),
      );
    }
    if (state.players.length >= MAX_PLAYERS) {
      return fail(
        "room_full",
        `This room is full (max ${MAX_PLAYERS} players).`,
        toPublicRoomState(state, callerHash, now),
      );
    }

    const newToken = generateToken();
    const newHash = hashToken(newToken);
    const newPlayer: PlayerRecord = {
      id: generateRoomId(10),
      tokenHash: newHash,
      nickname: sanitizeNickname(nickname),
      isHost: false,
      ready: false,
      role: null,
      caught: false,
      lastSeen: now,
      joinedAt: now,
    };
    const nextState: RoomState = {
      ...state,
      players: [...state.players, newPlayer],
      version: state.version + 1,
      updatedAt: now,
    };
    const cas = await store.compareAndSwap(roomId, state.version, nextState, ROOM_TTL_SECONDS);
    if (cas === "ok") {
      return ok({
        token: newToken,
        playerId: newPlayer.id,
        publicState: toPublicRoomState(nextState, newHash, now),
      });
    }
    if (cas === "not_found") return fail("not_found", "This room no longer exists.");
    // conflict → re-read; the room may have filled up in the meantime.
  }

  return fail("version_conflict", "The room is changing too quickly. Please try again.");
}

// ---------------------------------------------------------------------------
// Lobby mutations (ready / nickname / map)
// ---------------------------------------------------------------------------

/** A generic CAS-looped mutation that edits the room in place, with guards. */
async function mutate(
  store: RoomStore,
  roomId: string,
  token: string | null,
  now: number,
  edit: (
    state: RoomState,
    me: PlayerRecord | undefined,
    callerHash: string | null,
  ) => Result<RoomState>,
): Promise<Result<PublicRoomState>> {
  const callerHash = token ? hashToken(token) : null;

  for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
    const state = await store.get(roomId);
    if (!state) return fail("not_found", "This room does not exist or has expired.");

    const progressed = applyPhaseProgress(state, now);
    const me = playerByHash(progressed, callerHash);
    const edited = edit(progressed, me, callerHash);
    if (!edited.ok) return edited;

    const nextState: RoomState = {
      ...edited.value,
      version: state.version + 1,
      updatedAt: now,
    };
    const cas = await store.compareAndSwap(roomId, state.version, nextState, ROOM_TTL_SECONDS);
    if (cas === "ok") return ok(toPublicRoomState(nextState, callerHash, now));
    if (cas === "not_found") return fail("not_found", "This room no longer exists.");
    // conflict → retry.
  }
  return fail("version_conflict", "The room is changing too quickly. Please try again.");
}

export function setReady(
  store: RoomStore,
  roomId: string,
  token: string | null,
  ready: boolean,
  now: number = Date.now(),
): Promise<Result<PublicRoomState>> {
  return mutate(store, roomId, token, now, (state, me) => {
    if (!me) return fail("not_a_player", "You are not in this room.");
    if (state.phase !== "lobby") return fail("bad_phase", "Readiness can only change in the lobby.");
    return ok({
      ...state,
      players: state.players.map((p) =>
        p.id === me.id ? { ...p, ready: Boolean(ready), lastSeen: now } : p,
      ),
    });
  });
}

export function setNickname(
  store: RoomStore,
  roomId: string,
  token: string | null,
  nickname: unknown,
  now: number = Date.now(),
): Promise<Result<PublicRoomState>> {
  return mutate(store, roomId, token, now, (state, me) => {
    if (!me) return fail("not_a_player", "You are not in this room.");
    const clean = sanitizeNickname(nickname);
    return ok({
      ...state,
      players: state.players.map((p) =>
        p.id === me.id ? { ...p, nickname: clean, lastSeen: now } : p,
      ),
    });
  });
}

export function selectMap(
  store: RoomStore,
  roomId: string,
  token: string | null,
  mapId: unknown,
  now: number = Date.now(),
): Promise<Result<PublicRoomState>> {
  return mutate(store, roomId, token, now, (state, me) => {
    if (!me) return fail("not_a_player", "You are not in this room.");
    if (!me.isHost) return fail("not_host", "Only the host can choose the map.");
    if (state.phase !== "lobby") return fail("bad_phase", "The map can only change in the lobby.");
    if (!MAP_IDS.includes(mapId as MapId)) return fail("invalid_request", "Unknown map.");
    return ok({ ...state, mapId: mapId as MapId });
  });
}

// ---------------------------------------------------------------------------
// Start a round
// ---------------------------------------------------------------------------

/**
 * Host starts a round: requires enough players and everyone ready. One player is
 * chosen seeker at random (injectable RNG for tests); the rest become hiders.
 */
export function startGame(
  store: RoomStore,
  roomId: string,
  token: string | null,
  now: number = Date.now(),
  rng: () => number = Math.random,
): Promise<Result<PublicRoomState>> {
  return mutate(store, roomId, token, now, (state, me) => {
    if (!me) return fail("not_a_player", "You are not in this room.");
    if (!me.isHost) return fail("not_host", "Only the host can start the game.");
    if (state.phase !== "lobby") return fail("bad_phase", "A round is already underway.");
    if (state.players.length < MIN_PLAYERS)
      return fail("not_enough_players", `Need at least ${MIN_PLAYERS} players.`);
    if (!state.players.every((p) => p.ready))
      return fail("not_all_ready", "Everyone must be ready first.");

    // Fair role rotation: avoid immediately re-picking the previous seeker when
    // there is another candidate (at 2 players this guarantees the role alternates).
    const prev = state.prevSeekerId ?? state.seekerId ?? null;
    let candidates = state.players;
    if (state.players.length >= 2 && prev) {
      const rest = state.players.filter((p) => p.id !== prev);
      if (rest.length > 0) candidates = rest;
    }
    const seeker = candidates[Math.floor(rng() * candidates.length)];
    const players = state.players.map((p): PlayerRecord => ({
      ...p,
      role: (p.id === seeker.id ? "seeker" : "hider") as Role,
      caught: false,
    }));
    return ok({
      ...state,
      phase: "preparing",
      phaseStartedAt: now,
      round: state.round + 1,
      seekerId: seeker.id,
      result: null,
      players,
    });
  });
}

/**
 * Marks a hider caught. Called ONLY by the trusted realtime host (which has
 * already validated distance + line of sight); the HTTP route gates this behind
 * a shared secret so clients cannot self-declare catches. Idempotent: catching an
 * already-caught or unknown hider is a no-op. When the last hider is caught, the
 * round ends immediately with a seeker win.
 */
export async function markCaught(
  store: RoomStore,
  roomId: string,
  hiderId: string,
  now: number = Date.now(),
): Promise<Result<PublicRoomState>> {
  for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
    const state = await store.get(roomId);
    if (!state) return fail("not_found", "This room does not exist or has expired.");

    const progressed = applyPhaseProgress(state, now);
    const view = () => toPublicRoomState(progressed, null, now);

    // Only meaningful while seeking; otherwise treat as a no-op (idempotent).
    if (progressed.phase !== "seeking") return ok(view());
    const target = progressed.players.find(
      (p) => p.id === hiderId && p.role === "hider" && !p.caught,
    );
    if (!target || !progressed.seekerId) return ok(view());

    const players = progressed.players.map((p) =>
      p.id === hiderId ? { ...p, caught: true } : p,
    );

    let next: RoomState = { ...progressed, players };
    if (allHidersCaught(players)) {
      next = {
        ...next,
        phase: "result",
        phaseStartedAt: now,
        result: buildRoundResult(players, progressed.seekerId, now),
      };
    }

    const nextState: RoomState = {
      ...next,
      version: state.version + 1,
      updatedAt: now,
    };
    const cas = await store.compareAndSwap(roomId, state.version, nextState, ROOM_TTL_SECONDS);
    if (cas === "ok") return ok(toPublicRoomState(nextState, null, now));
    if (cas === "not_found") return fail("not_found", "This room no longer exists.");
    // conflict → retry.
  }
  return fail("version_conflict", "The room is changing too quickly. Please try again.");
}

/** Host returns the room to the lobby (e.g. from the result screen → play again). */
export function returnToLobby(
  store: RoomStore,
  roomId: string,
  token: string | null,
  now: number = Date.now(),
): Promise<Result<PublicRoomState>> {
  return mutate(store, roomId, token, now, (state, me) => {
    if (!me) return fail("not_a_player", "You are not in this room.");
    if (!me.isHost) return fail("not_host", "Only the host can return to the lobby.");
    return ok(resetForLobby(state, now));
  });
}
