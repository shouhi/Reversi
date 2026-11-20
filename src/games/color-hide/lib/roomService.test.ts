import { describe, it, expect, beforeEach } from "vitest";
import { createMemoryStore, __resetMemoryStore } from "@/lib/store/memory";
import {
  COLOR_HIDE_ROOM_PREFIX,
  createRoom,
  getRoomView,
  joinRoom,
  leaveRoom,
  markCaught,
  normalizeRoom,
  returnToLobby,
  selectMap,
  setReady,
  startGame,
  type RoomStore,
} from "./roomService";
import type { PlayerRecord, RoomState } from "../types";
import {
  DEFAULT_MAP_ID,
  DISCONNECT_TIMEOUT_MS,
  MAX_PLAYERS,
  PREPARING_MS,
  PAINTING_MS,
  HIDING_MS,
  SEEKING_MS,
} from "./constants";

function freshStore(): RoomStore {
  return createMemoryStore<RoomState>(COLOR_HIDE_ROOM_PREFIX);
}

beforeEach(() => __resetMemoryStore());

/** Creates a room and fills it to `count` players, returning their tokens. */
async function roomWith(store: RoomStore, count: number, t0 = 1000) {
  const created = await createRoom(store, "Host", t0);
  if (!created.ok) throw new Error("create failed");
  const roomId = created.value.roomId;
  const tokens = [created.value.token];
  for (let i = 1; i < count; i++) {
    const j = await joinRoom(store, roomId, null, `P${i}`, t0);
    if (!j.ok || !j.value.token) throw new Error("join failed");
    tokens.push(j.value.token);
  }
  return { roomId, tokens };
}

describe("createRoom / joinRoom", () => {
  it("creates a lobby with the creator as host", async () => {
    const store = freshStore();
    const res = await createRoom(store, "Alice", 1000);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const s = res.value.publicState;
    expect(s.phase).toBe("lobby");
    expect(s.players).toHaveLength(1);
    expect(s.players[0].isHost).toBe(true);
    expect(s.players[0].nickname).toBe("Alice");
    expect(s.yourRole).toBeNull();
  });

  it("lets a second player join and issues them a token", async () => {
    const store = freshStore();
    const created = await createRoom(store, "Host", 1000);
    if (!created.ok) return;
    const j = await joinRoom(store, created.value.roomId, null, "Bob", 1000);
    expect(j.ok).toBe(true);
    if (!j.ok) return;
    expect(j.value.token).toBeTruthy();
    expect(j.value.publicState.players).toHaveLength(2);
  });

  it(`allows up to ${MAX_PLAYERS} players and rejects the 7th`, async () => {
    const store = freshStore();
    const { roomId } = await roomWith(store, MAX_PLAYERS);
    const seventh = await joinRoom(store, roomId, null, "Seven", 1000);
    expect(seventh.ok).toBe(false);
    if (seventh.ok) return;
    expect(seventh.error.code).toBe("room_full");
  });

  it("treats a known token as a reconnect (no new seat, same id)", async () => {
    const store = freshStore();
    const created = await createRoom(store, "Host", 1000);
    if (!created.ok) return;
    const { roomId, token, playerId } = created.value;
    const again = await joinRoom(store, roomId, token, "Host", 2000);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.value.token).toBeUndefined();
    expect(again.value.playerId).toBe(playerId);
    expect(again.value.publicState.players).toHaveLength(1);
  });

  it("returns not_found for an unknown room", async () => {
    const store = freshStore();
    const res = await joinRoom(store, "doesnotexist", null, "X", 1000);
    expect(res.ok).toBe(false);
  });
});

describe("lobby mutations", () => {
  it("only the host can select a map, and only a known map", async () => {
    const store = freshStore();
    const { roomId, tokens } = await roomWith(store, 2);
    const asGuest = await selectMap(store, roomId, tokens[1], "warehouse", 1000);
    expect(asGuest.ok).toBe(false);
    if (!asGuest.ok) expect(asGuest.error.code).toBe("not_host");

    const asHost = await selectMap(store, roomId, tokens[0], "warehouse", 1000);
    expect(asHost.ok).toBe(true);
    if (asHost.ok) expect(asHost.value.mapId).toBe("warehouse");

    const bad = await selectMap(store, roomId, tokens[0], "nope", 1000);
    expect(bad.ok).toBe(false);
  });
});

describe("startGame", () => {
  it("requires enough players", async () => {
    const store = freshStore();
    const created = await createRoom(store, "Solo", 1000);
    if (!created.ok) return;
    await setReady(store, created.value.roomId, created.value.token, true, 1000);
    const res = await startGame(store, created.value.roomId, created.value.token, 1000);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("not_enough_players");
  });

  it("requires everyone to be ready", async () => {
    const store = freshStore();
    const { roomId, tokens } = await roomWith(store, 3);
    await setReady(store, roomId, tokens[0], true, 1000);
    // tokens[1], tokens[2] not ready
    const res = await startGame(store, roomId, tokens[0], 1000);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("not_all_ready");
  });

  it("only the host can start", async () => {
    const store = freshStore();
    const { roomId, tokens } = await roomWith(store, 2);
    for (const t of tokens) await setReady(store, roomId, t, true, 1000);
    const res = await startGame(store, roomId, tokens[1], 1000);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("not_host");
  });

  it("assigns exactly one seeker and the rest hiders", async () => {
    const store = freshStore();
    const { roomId, tokens } = await roomWith(store, 3);
    for (const t of tokens) await setReady(store, roomId, t, true, 1000);
    // rng → 0 makes the host (index 0) the seeker, deterministically.
    const res = await startGame(store, roomId, tokens[0], 1000, () => 0);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const s = res.value;
    expect(s.phase).toBe("preparing");
    expect(s.round).toBe(1);
    const seekers = s.players.filter((p) => p.role === "seeker");
    const hiders = s.players.filter((p) => p.role === "hider");
    expect(seekers).toHaveLength(1);
    expect(hiders).toHaveLength(2);
    expect(s.seekerId).toBe(seekers[0].id);
    expect(s.yourRole).toBe("seeker"); // caller is the host == seeker here
  });

  it("rotates the seeker: the previous seeker is not picked again when avoidable", async () => {
    const store = freshStore();
    const { roomId, tokens } = await roomWith(store, 2);
    for (const t of tokens) await setReady(store, roomId, t, true, 1000);
    // Round 1: rng → 0 picks the host (index 0) as seeker.
    const r1 = await startGame(store, roomId, tokens[0], 1000, () => 0);
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    const seeker1 = r1.value.seekerId!;
    // Back to lobby, ready up, start again. Even with rng → 0, the previous
    // seeker is excluded from the candidate list, so the role must alternate.
    await returnToLobby(store, roomId, tokens[0], 2000);
    for (const t of tokens) await setReady(store, roomId, t, true, 2000);
    const r2 = await startGame(store, roomId, tokens[0], 2000, () => 0);
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.value.seekerId).not.toBe(seeker1); // rotated to the other player
  });
});

describe("phase progression over time (server clock)", () => {
  it("walks preparing → hiding → seeking → result as time passes (Phase 10)", async () => {
    const store = freshStore();
    const { roomId, tokens } = await roomWith(store, 2, 0);
    for (const t of tokens) await setReady(store, roomId, t, true, 0);
    const start = await startGame(store, roomId, tokens[0], 0, () => 0);
    expect(start.ok).toBe(true);

    const at = async (now: number) => {
      const v = await getRoomView(store, roomId, tokens[0], now);
      if (!v.ok) throw new Error("view failed");
      return v.value.phase;
    };

    // Phase 10: the standalone painting phase is merged into hiding, so preparing
    // advances straight to hiding (where in-world painting happens).
    expect(await at(PREPARING_MS - 1)).toBe("preparing");
    expect(await at(PREPARING_MS + 1)).toBe("hiding");
    expect(await at(PREPARING_MS + HIDING_MS + 1)).toBe("seeking");

    const end = PREPARING_MS + HIDING_MS + SEEKING_MS + 1;
    const v = await getRoomView(store, roomId, tokens[0], end);
    if (!v.ok) throw new Error("view failed");
    expect(v.value.phase).toBe("result");
    // No hider was caught → hiders win.
    expect(v.value.result?.winner).toBe("hider");
    expect(v.value.result?.survivors).toHaveLength(1);
  });

  it("ends the round with a seeker win once every hider is caught", async () => {
    const store = freshStore();
    const { roomId, tokens } = await roomWith(store, 3, 0);
    for (const t of tokens) await setReady(store, roomId, t, true, 0);
    const start = await startGame(store, roomId, tokens[0], 0, () => 0);
    if (!start.ok) throw new Error("start failed");
    const hiderIds = start.value.players.filter((p) => p.role === "hider").map((p) => p.id);
    expect(hiderIds).toHaveLength(2);

    const duringSeek = PREPARING_MS + PAINTING_MS + HIDING_MS + 1000;
    const first = await markCaught(store, roomId, hiderIds[0], duringSeek);
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.value.phase).toBe("seeking"); // one still free

    const second = await markCaught(store, roomId, hiderIds[1], duringSeek + 10);
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.value.phase).toBe("result");
      expect(second.value.result?.winner).toBe("seeker");
      expect(second.value.result?.survivors).toEqual([]);
    }
  });

  it("ignores a catch outside the seeking phase (stale-meta safety: no false end)", async () => {
    const store = freshStore();
    const { roomId, tokens } = await roomWith(store, 3, 0);
    for (const t of tokens) await setReady(store, roomId, t, true, 0);
    const start = await startGame(store, roomId, tokens[0], 0, () => 0);
    if (!start.ok) throw new Error("start failed");
    const hiderIds = start.value.players.filter((p) => p.role === "hider").map((p) => p.id);

    // During HIDING (not seeking) — e.g. the DO acting on stale "seeking" meta.
    // Phase 10: painting is merged into hiding, so this is the pre-seeking window.
    const duringHiding = PREPARING_MS + 1000;
    const res = await markCaught(store, roomId, hiderIds[0], duringHiding);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.phase).toBe("hiding"); // phase unchanged
      expect(res.value.result).toBeNull(); // round NOT ended
      const target = res.value.players.find((p) => p.id === hiderIds[0]);
      expect(target?.caught).toBe(false); // hider NOT caught
    }
  });

  it("host can return to the lobby, resetting roles and readiness", async () => {
    const store = freshStore();
    const { roomId, tokens } = await roomWith(store, 2, 0);
    for (const t of tokens) await setReady(store, roomId, t, true, 0);
    await startGame(store, roomId, tokens[0], 0, () => 0);
    const back = await returnToLobby(store, roomId, tokens[0], 5000);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.value.phase).toBe("lobby");
    expect(back.value.seekerId).toBeNull();
    expect(back.value.players.every((p) => p.role === null)).toBe(true);
    expect(back.value.players.every((p) => p.ready === false)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Host continuity (Phase 13-A): migration, lobby hygiene, explicit leave
// ---------------------------------------------------------------------------

function mkPlayer(id: string, over: Partial<PlayerRecord> = {}): PlayerRecord {
  return {
    id,
    tokenHash: `hash-${id}`,
    nickname: id,
    isHost: false,
    ready: false,
    role: null,
    caught: false,
    lastSeen: 1000,
    joinedAt: 1000,
    ...over,
  };
}
function mkState(players: PlayerRecord[], over: Partial<RoomState> = {}): RoomState {
  return {
    roomId: "r",
    phase: "lobby",
    phaseStartedAt: 1000,
    mapId: DEFAULT_MAP_ID,
    players,
    seekerId: null,
    round: 0,
    result: null,
    version: 1,
    createdAt: 1000,
    updatedAt: 1000,
    ...over,
  };
}
const hostsOf = (s: RoomState) => s.players.filter((p) => p.isHost);

describe("normalizeRoom — host continuity (pure)", () => {
  const FAR = 1000 + DISCONNECT_TIMEOUT_MS + 10_000; // everyone from t=1000 is stale at FAR

  it("migrates host to the earliest-joined CONNECTED player when the host is gone", () => {
    const now = FAR;
    const s = mkState([
      mkPlayer("A", { isHost: true, lastSeen: 1000 }), // disconnected host
      mkPlayer("B", { joinedAt: 2000, lastSeen: now }), // connected, joined later
      mkPlayer("C", { joinedAt: 1500, lastSeen: now }), // connected, joined earlier
    ]);
    const out = normalizeRoom(s, now);
    // A is a disconnected host in the lobby → pruned; host goes to the earliest-joined
    // connected player (C, joined 1500 < B 2000).
    expect(out.players.map((p) => p.id).sort()).toEqual(["B", "C"]);
    expect(hostsOf(out).map((p) => p.id)).toEqual(["C"]);
  });

  it("leaves a connected host untouched (no needless churn)", () => {
    const now = 2000;
    const s = mkState([
      mkPlayer("A", { isHost: true, lastSeen: now }),
      mkPlayer("B", { lastSeen: now }),
    ]);
    expect(normalizeRoom(s, now)).toBe(s); // same reference → no change
  });

  it("collapses multiple host flags to exactly one (double-host prevention)", () => {
    const now = 2000;
    const s = mkState([
      mkPlayer("A", { isHost: true, lastSeen: now }),
      mkPlayer("B", { isHost: true, lastSeen: now }),
    ]);
    const out = normalizeRoom(s, now);
    expect(hostsOf(out)).toHaveLength(1);
  });

  it("does NOT prune disconnected players mid-round (keeps roles/seeker intact)", () => {
    const now = FAR;
    const s = mkState(
      [
        mkPlayer("A", { isHost: true, lastSeen: 1000, role: "hider" }),
        mkPlayer("B", { lastSeen: now, role: "seeker" }),
      ],
      { phase: "seeking", seekerId: "B" },
    );
    const out = normalizeRoom(s, now);
    expect(out.players.map((p) => p.id).sort()).toEqual(["A", "B"]); // A kept mid-round
    expect(hostsOf(out).map((p) => p.id)).toEqual(["B"]); // host migrated to connected B
    expect(out.seekerId).toBe("B");
  });

  it("assigns a deterministic single host even if all are disconnected (self-heals on reconnect)", () => {
    const now = FAR;
    const s = mkState([
      mkPlayer("A", { isHost: true, lastSeen: 1000, joinedAt: 3000 }),
      mkPlayer("B", { lastSeen: 1000, joinedAt: 1000 }),
    ]);
    const out = normalizeRoom(s, now);
    expect(hostsOf(out)).toHaveLength(1);
    expect(hostsOf(out)[0].id).toBe("B"); // earliest joined
  });

  it("is idempotent", () => {
    const now = FAR;
    const s = mkState([
      mkPlayer("A", { isHost: true, lastSeen: 1000 }),
      mkPlayer("B", { lastSeen: now }),
    ]);
    const once = normalizeRoom(s, now);
    expect(normalizeRoom(once, now)).toBe(once);
  });
});

describe("host continuity — integration (via the store)", () => {
  const T0 = 1000;
  const GONE = T0 + DISCONNECT_TIMEOUT_MS + 5_000; // host silent since T0 → disconnected

  it("a remaining player's poll migrates the host off a silently-disconnected host", async () => {
    const store = freshStore();
    const { roomId, tokens } = await roomWith(store, 3, T0);
    // Only P1 polls later; the host (and P2) stay silent since T0.
    const v = await getRoomView(store, roomId, tokens[1], GONE);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const hosts = v.value.players.filter((p) => p.isHost);
    expect(hosts).toHaveLength(1);
    expect(hosts[0].id).toBe(v.value.yourId); // P1 is the only connected player → host
    expect(hosts[0].connected).toBe(true);
    // The disconnected host + P2 were pruned from the lobby.
    expect(v.value.players).toHaveLength(1);
  });

  it("explicit leave migrates the host and removes the leaver (lobby)", async () => {
    const store = freshStore();
    const { roomId, tokens } = await roomWith(store, 3, T0);
    const left = await leaveRoom(store, roomId, tokens[0], T0 + 100); // host leaves
    expect(left.ok).toBe(true);
    const v = await getRoomView(store, roomId, tokens[1], T0 + 200);
    if (!v.ok) return;
    expect(v.value.players.some((p) => p.isHost === true)).toBe(true);
    expect(v.value.players.filter((p) => p.isHost)).toHaveLength(1);
    // the old host is gone (pruned in lobby), a connected player holds the host flag
    expect(v.value.players.length).toBe(2);
    expect(v.value.players.find((p) => p.isHost)?.connected).toBe(true);
  });

  it("a reconnecting old host does NOT reclaim the host (no double host)", async () => {
    const store = freshStore();
    const { roomId, tokens } = await roomWith(store, 3, T0);
    // Everyone ready, host starts a round so the roster is kept mid-round.
    for (const t of tokens) await setReady(store, roomId, t, true, T0);
    const started = await startGame(store, roomId, tokens[0], T0);
    expect(started.ok).toBe(true);
    // Mid-round: host goes silent; P1 + P2 keep polling → host migrates to one of them.
    const mid = T0 + DISCONNECT_TIMEOUT_MS + 2_000; // still "painting" (well before result)
    await getRoomView(store, roomId, tokens[1], mid);
    const v1 = await getRoomView(store, roomId, tokens[2], mid);
    if (!v1.ok) return;
    const newHostId = v1.value.players.find((p) => p.isHost)?.id;
    expect(newHostId).toBeDefined();
    expect(v1.value.players.filter((p) => p.isHost)).toHaveLength(1);
    const oldHostId = v1.value.players.find((p) => p.nickname === "Host")?.id;
    expect(newHostId).not.toBe(oldHostId);
    // Old host reconnects — must NOT become host again.
    const back = await getRoomView(store, roomId, tokens[0], mid + 500);
    if (!back.ok) return;
    expect(back.value.players.filter((p) => p.isHost)).toHaveLength(1);
    expect(back.value.players.find((p) => p.isHost)?.id).toBe(newHostId);
    const oldHost = back.value.players.find((p) => p.id === oldHostId);
    expect(oldHost?.isHost).toBe(false);
  });

  it("concurrent polls after the host leaves still yield exactly one host", async () => {
    const store = freshStore();
    const { roomId, tokens } = await roomWith(store, 3, T0);
    await Promise.all([
      getRoomView(store, roomId, tokens[1], GONE),
      getRoomView(store, roomId, tokens[2], GONE),
    ]);
    const v = await getRoomView(store, roomId, tokens[1], GONE + 100);
    if (!v.ok) return;
    expect(v.value.players.filter((p) => p.isHost)).toHaveLength(1);
    expect(v.value.players.find((p) => p.isHost)?.connected).toBe(true);
  });

  it("the migrated host can start a rematch; the old host's commands are rejected", async () => {
    const store = freshStore();
    const { roomId, tokens } = await roomWith(store, 3, T0);
    // Host leaves in the lobby; P1 + P2 keep playing.
    await leaveRoom(store, roomId, tokens[0], T0 + 100);
    // Whoever is host now can run the lobby. Discover the connected host token.
    const view = await getRoomView(store, roomId, tokens[1], T0 + 200);
    if (!view.ok) return;
    const myId = view.value.yourId;
    const hostId = view.value.players.find((p) => p.isHost)?.id;
    const hostToken = hostId === myId ? tokens[1] : tokens[2];
    const otherToken = hostToken === tokens[1] ? tokens[2] : tokens[1];
    // Old host (departed) cannot start.
    const oldHostStart = await startGame(store, roomId, tokens[0], T0 + 250);
    expect(oldHostStart.ok).toBe(false);
    if (!oldHostStart.ok) expect(oldHostStart.error.code).toMatch(/not_a_player|not_host/);
    // Both remaining ready up; the migrated host starts the next round.
    await setReady(store, roomId, hostToken, true, T0 + 300);
    await setReady(store, roomId, otherToken, true, T0 + 300);
    const started = await startGame(store, roomId, hostToken, T0 + 400);
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.value.phase).toBe("preparing");
    expect(started.value.seekerId).toBeTruthy();
  });

  it("with only one player left, the host cannot start (waits for players)", async () => {
    const store = freshStore();
    const { roomId, tokens } = await roomWith(store, 2, T0);
    await leaveRoom(store, roomId, tokens[0], T0 + 100); // host leaves → P1 sole host
    const v = await getRoomView(store, roomId, tokens[1], T0 + 200);
    if (!v.ok) return;
    expect(v.value.players).toHaveLength(1);
    expect(v.value.players[0].isHost).toBe(true);
    await setReady(store, roomId, tokens[1], true, T0 + 250);
    const started = await startGame(store, roomId, tokens[1], T0 + 300);
    expect(started.ok).toBe(false);
    if (!started.ok) expect(started.error.code).toBe("not_enough_players");
  });

  it("a non-participant poll never grants the host flag", async () => {
    const store = freshStore();
    const { roomId } = await roomWith(store, 2, T0);
    const before = await getRoomView(store, roomId, null, T0 + 50);
    const v = await getRoomView(store, roomId, "not-a-member-token", GONE);
    if (!v.ok || !before.ok) return;
    expect(v.value.yourId).toBeNull();
    // Still exactly one host among the actual members (not the stranger).
    expect(v.value.players.filter((p) => p.isHost)).toHaveLength(1);
  });

  it("a disconnected non-host player is pruned from the lobby", async () => {
    const store = freshStore();
    const { roomId, tokens } = await roomWith(store, 3, T0);
    // Host keeps polling; P2 goes silent.
    const v = await getRoomView(store, roomId, tokens[0], GONE);
    if (!v.ok) return;
    // Host is connected and stays host; the two silent players (P1, P2) are pruned.
    expect(v.value.players.filter((p) => p.isHost)).toHaveLength(1);
    expect(v.value.players.find((p) => p.isHost)?.id).toBe(v.value.yourId);
    expect(v.value.players).toHaveLength(1);
  });
});
