import { describe, it, expect, beforeEach } from "vitest";
import {
  buildSnapshot,
  ColorHideServer,
  type Outbound,
  type PosedPlayer,
  type RoomMeta,
  type RoomMetaProvider,
} from "./realtime";
import type { ServerMsg } from "./protocol";
import type { Aabb } from "../lib/geometry";
import type { Vec3 } from "../types";

// ---------------------------------------------------------------------------
// Pure snapshot filter — the security guarantee, with arbitrary geometry.
// ---------------------------------------------------------------------------

const posed = (
  id: string,
  role: PosedPlayer["role"],
  pos: Vec3,
  extra: Partial<PosedPlayer> = {},
): PosedPlayer => ({
  id,
  role,
  pos,
  yaw: 0,
  pitch: 0,
  anim: "idle",
  pose: "stand",
  caught: false,
  ...extra,
});

const wall: Aabb = {
  min: { x: -2, y: 0, z: -3 },
  max: { x: 2, y: 3, z: -2.5 },
};

describe("buildSnapshot (per-recipient visibility filter)", () => {
  const seeker = posed("S", "seeker", { x: 0, y: 0, z: 0 });
  const near = posed("N", "hider", { x: 0, y: 0, z: -5 });
  const far = posed("F", "hider", { x: 0, y: 0, z: -50 });

  it("a seeker sees itself and a visible hider, but NOT one out of range", () => {
    const ids = buildSnapshot(seeker, [seeker, near, far], []).map((p) => p.id);
    expect(ids).toContain("S");
    expect(ids).toContain("N");
    expect(ids).not.toContain("F");
  });

  it("a seeker NEVER receives a hider hidden behind a wall", () => {
    const ids = buildSnapshot(seeker, [seeker, near], [wall]).map((p) => p.id);
    expect(ids).toContain("S");
    expect(ids).not.toContain("N"); // occluded ⇒ not leaked to the seeker
  });

  it("a hider sees the seeker and fellow hiders (teammates), even hidden ones", () => {
    const me = posed("N", "hider", { x: 0, y: 0, z: -5 });
    const mate = posed("M", "hider", { x: 10, y: 0, z: 10 });
    const ids = buildSnapshot(me, [seeker, me, mate], [wall]).map((p) => p.id);
    expect(ids.sort()).toEqual(["M", "N", "S"]);
  });

  it("a caught hider is revealed to the seeker regardless of line of sight", () => {
    const caught = posed("C", "hider", { x: 0, y: 0, z: -50 }, { caught: true });
    const ids = buildSnapshot(seeker, [seeker, caught], [wall]).map((p) => p.id);
    expect(ids).toContain("C");
  });
});

// ---------------------------------------------------------------------------
// Server integration — stub provider + captured outbound.
// ---------------------------------------------------------------------------

function makeMeta(phase: RoomMeta["phase"]): RoomMeta {
  return {
    phase,
    phaseStartedAt: 0,
    mapId: "room",
    seekerId: "S",
    players: [
      { id: "S", role: "seeker", caught: false },
      { id: "A", role: "hider", caught: false },
    ],
  };
}

interface Harness {
  server: ColorHideServer;
  meta: RoomMeta;
  sent: Record<string, ServerMsg[]>;
  closed: string[];
  caughtCalls: string[];
  lastSnapshotIds: (connId: string) => string[];
}

function harness(phase: RoomMeta["phase"]): Harness {
  const meta = makeMeta(phase);
  const sent: Record<string, ServerMsg[]> = {};
  const closed: string[] = [];
  const caughtCalls: string[] = [];

  const provider: RoomMetaProvider = {
    async getMeta() {
      return meta;
    },
    async persistCatch(_roomId, hiderId) {
      caughtCalls.push(hiderId);
      const m = meta.players.find((p) => p.id === hiderId);
      if (m) m.caught = true;
    },
  };
  const out: Outbound = {
    send(connId, msg) {
      (sent[connId] ??= []).push(msg);
    },
    close(connId) {
      closed.push(connId);
    },
  };
  const server = new ColorHideServer(provider, out);

  const lastSnapshotIds = (connId: string): string[] => {
    const snaps = (sent[connId] ?? []).filter((m) => m.type === "snapshot");
    const last = snaps[snaps.length - 1];
    return last && last.type === "snapshot" ? last.players.map((p) => p.id) : [];
  };

  return { server, meta, sent, closed, caughtCalls, lastSnapshotIds };
}

let h: Harness;

describe("ColorHideServer.handleHello", () => {
  it("welcomes a known player with their role", async () => {
    h = harness("seeking");
    await h.server.handleHello("cS", "r", "S", 1000);
    const welcome = h.sent["cS"]?.find((m) => m.type === "welcome");
    expect(welcome).toBeTruthy();
    if (welcome?.type === "welcome") expect(welcome.role).toBe("seeker");
  });

  it("rejects and closes an unknown player", async () => {
    h = harness("seeking");
    await h.server.handleHello("cX", "r", "ghost", 1000);
    expect(h.sent["cX"]?.some((m) => m.type === "error")).toBe(true);
    expect(h.closed).toContain("cX");
  });
});

describe("ColorHideServer.handleInput (phase gating + collision)", () => {
  const clear: Vec3 = { x: -3, y: 0, z: 2 }; // a spot clear of 'room' obstacles

  it("freezes the seeker before the seeking phase", async () => {
    h = harness("hiding");
    await h.server.handleHello("cS", "r", "S", 0);
    await h.server.handleHello("cA", "r", "A", 0);
    h.server.__setPose("cS", { pos: clear, yaw: 0 });
    h.server.handleInput(
      "cS",
      { seq: 1, x: -2.5, z: 2, yaw: 0, pitch: 0, anim: "walk", pose: "stand", running: false },
      100,
    );
    h.server.tick(200);
    // A (hider) always sees the seeker; its position must be unchanged (frozen).
    const snap = (h.sent["cA"] ?? []).filter((m) => m.type === "snapshot").pop();
    const s = snap?.type === "snapshot" ? snap.players.find((p) => p.id === "S") : undefined;
    expect(s?.x).toBeCloseTo(-3);
  });

  it("moves the seeker during seeking", async () => {
    h = harness("seeking");
    await h.server.handleHello("cS", "r", "S", 0);
    await h.server.handleHello("cA", "r", "A", 0);
    h.server.__setPose("cS", { pos: clear, yaw: 0 });
    h.server.handleInput(
      "cS",
      { seq: 1, x: -2.6, z: 2, yaw: 0, pitch: 0, anim: "walk", pose: "stand", running: false },
      100,
    );
    h.server.tick(200);
    const snap = (h.sent["cA"] ?? []).filter((m) => m.type === "snapshot").pop();
    const s = snap?.type === "snapshot" ? snap.players.find((p) => p.id === "S") : undefined;
    expect(s?.x).toBeGreaterThan(-3); // advanced toward -2.6
  });

  it("ignores stale / out-of-order input", async () => {
    h = harness("seeking");
    await h.server.handleHello("cS", "r", "S", 0);
    h.server.__setPose("cS", { pos: clear, yaw: 0 });
    h.server.handleInput("cS", { seq: 5, x: -2.6, z: 2, yaw: 0, pitch: 0, anim: "walk", pose: "stand", running: false }, 100);
    h.server.handleInput("cS", { seq: 3, x: -5, z: 2, yaw: 0, pitch: 0, anim: "walk", pose: "stand", running: false }, 200);
    h.server.tick(300);
    const ids = h.lastSnapshotIds("cS");
    expect(ids).toContain("S"); // still attached, stale input simply dropped
  });
});

describe("ColorHideServer.handleCatch (server-authoritative)", () => {
  const sPos: Vec3 = { x: -3, y: 0, z: 2 };

  it("catches a close, visible hider during seeking (and persists + broadcasts)", async () => {
    h = harness("seeking");
    await h.server.handleHello("cS", "r", "S", 0);
    await h.server.handleHello("cA", "r", "A", 0);
    h.server.__setPose("cS", { pos: sPos, yaw: 0 });
    h.server.__setPose("cA", { pos: { x: -3, y: 0, z: 0.2 } });
    const ok = await h.server.handleCatch("cS", "A", 1000);
    expect(ok).toBe(true);
    expect(h.caughtCalls).toEqual(["A"]);
    expect(h.sent["cA"]?.some((m) => m.type === "caught")).toBe(true);
  });

  it("does not catch a hider that is too far away", async () => {
    h = harness("seeking");
    await h.server.handleHello("cS", "r", "S", 0);
    await h.server.handleHello("cA", "r", "A", 0);
    h.server.__setPose("cS", { pos: sPos, yaw: 0 });
    h.server.__setPose("cA", { pos: { x: -3, y: 0, z: -5 } });
    expect(await h.server.handleCatch("cS", "A", 1000)).toBe(false);
    expect(h.caughtCalls).toEqual([]);
  });

  it("rejects a catch from a non-seeker", async () => {
    h = harness("seeking");
    await h.server.handleHello("cS", "r", "S", 0);
    await h.server.handleHello("cA", "r", "A", 0);
    h.server.__setPose("cA", { pos: sPos, yaw: 0 });
    h.server.__setPose("cS", { pos: { x: -3, y: 0, z: 0.2 } });
    expect(await h.server.handleCatch("cA", "S", 1000)).toBe(false);
  });

  it("rejects a catch outside the seeking phase", async () => {
    h = harness("hiding");
    await h.server.handleHello("cS", "r", "S", 0);
    await h.server.handleHello("cA", "r", "A", 0);
    h.server.__setPose("cS", { pos: sPos, yaw: 0 });
    h.server.__setPose("cA", { pos: { x: -3, y: 0, z: 0.2 } });
    expect(await h.server.handleCatch("cS", "A", 1000)).toBe(false);
  });
});

describe("ColorHideServer.tick (snapshot filtering end-to-end)", () => {
  beforeEach(async () => {
    h = harness("seeking");
    await h.server.handleHello("cS", "r", "S", 0);
    await h.server.handleHello("cA", "r", "A", 0);
  });

  it("does not leak a far/hidden hider's position to the seeker", () => {
    h.server.__setPose("cS", { pos: { x: -3, y: 0, z: 2 }, yaw: 0 });
    h.server.__setPose("cA", { pos: { x: -3, y: 0, z: -60 } }); // well out of range
    h.server.tick(500);
    expect(h.lastSnapshotIds("cS").sort()).toEqual(["S"]); // only itself
    // The hider still sees itself and the seeker.
    expect(h.lastSnapshotIds("cA").sort()).toEqual(["A", "S"]);
  });
});
