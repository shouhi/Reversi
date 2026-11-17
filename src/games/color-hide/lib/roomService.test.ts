import { describe, it, expect, beforeEach } from "vitest";
import { createMemoryStore, __resetMemoryStore } from "@/lib/store/memory";
import {
  COLOR_HIDE_ROOM_PREFIX,
  createRoom,
  getRoomView,
  joinRoom,
  markCaught,
  returnToLobby,
  selectMap,
  setReady,
  startGame,
  type RoomStore,
} from "./roomService";
import type { RoomState } from "../types";
import {
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
});

describe("phase progression over time (server clock)", () => {
  it("walks preparing → painting → hiding → seeking → result as time passes", async () => {
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

    expect(await at(PREPARING_MS - 1)).toBe("preparing");
    expect(await at(PREPARING_MS + 1)).toBe("painting");
    expect(await at(PREPARING_MS + PAINTING_MS + 1)).toBe("hiding");
    expect(await at(PREPARING_MS + PAINTING_MS + HIDING_MS + 1)).toBe("seeking");

    const end =
      PREPARING_MS + PAINTING_MS + HIDING_MS + SEEKING_MS + 1;
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
