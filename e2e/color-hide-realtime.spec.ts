import { test, expect, type APIRequestContext } from "@playwright/test";
import { WebSocket } from "ws";
import { spawn, type ChildProcess } from "node:child_process";

/**
 * Real-socket multiplayer verification for COLOR HIDE.
 *
 * This drives the ACTUAL realtime stack — the local WS host running the netcode,
 * real WebSocket clients, and the HTTP app — with no WebGL, so it is reliable in
 * CI. It proves the things unit tests can't: that the wiring delivers the right
 * (filtered) data over real sockets and that the catch authority chain works.
 *
 * Requires short phase timers (set in playwright.config's webServer env) so a
 * round reaches `seeking` in ~10s instead of ~95s.
 */

const APP = "http://localhost:3100";
const WS_PORT = 1999;
const WS_URL = `ws://localhost:${WS_PORT}`;
const RT_SECRET = "color-hide-dev-rt-secret"; // app's dev default (unset env)

let host: ChildProcess;

async function waitForHealth(url: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`realtime host did not become healthy at ${url}`);
}

test.beforeAll(async () => {
  host = spawn(
    `npx tsx src/games/color-hide/server/localServer.ts`,
    {
      shell: true,
      env: { ...process.env, COLOR_HIDE_APP_URL: APP, COLOR_HIDE_WS_PORT: String(WS_PORT) },
      stdio: "pipe",
    },
  );
  host.stderr?.on("data", (d) => {
    const s = d.toString();
    if (/error|Error|EADDRINUSE/.test(s)) console.error("[rt-host]", s.trim());
  });
  await waitForHealth(`http://localhost:${WS_PORT}/health`, 20_000);
});

test.afterAll(() => {
  host?.kill("SIGKILL");
});

// --- HTTP helpers -----------------------------------------------------------

async function createRoom(request: APIRequestContext, nickname: string) {
  const res = await request.post(`/api/games/color-hide/rooms`, { data: { nickname } });
  expect(res.ok()).toBeTruthy();
  return res.json();
}
async function join(request: APIRequestContext, roomId: string, nickname: string) {
  const res = await request.post(`/api/games/color-hide/rooms/${roomId}/join`, {
    data: { nickname },
  });
  return { status: res.status(), body: res.ok() ? await res.json() : null };
}
async function ready(request: APIRequestContext, roomId: string, token: string) {
  await request.post(`/api/games/color-hide/rooms/${roomId}/action`, {
    headers: { "x-color-hide-token": token },
    data: { action: "ready", ready: true },
  });
}
async function start(request: APIRequestContext, roomId: string, token: string) {
  const res = await request.post(`/api/games/color-hide/rooms/${roomId}/action`, {
    headers: { "x-color-hide-token": token },
    data: { action: "start" },
  });
  expect(res.ok()).toBeTruthy();
}
async function getRoom(request: APIRequestContext, roomId: string) {
  const res = await request.get(`/api/games/color-hide/rooms/${roomId}`);
  return (await res.json()).publicState;
}
async function waitForPhase(
  request: APIRequestContext,
  roomId: string,
  phase: string,
  timeoutMs = 20_000,
) {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < deadline) {
    const s = await getRoom(request, roomId);
    last = s.phase;
    if (s.phase === phase) return s;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`room ${roomId} never reached ${phase} (last: ${last})`);
}

// --- WS client helper -------------------------------------------------------

interface RTClient {
  ws: WebSocket;
  welcome?: { role: string | null };
  snapshots: Array<{ players: Array<{ id: string; x: number; z: number; role: string | null }> }>;
  caught: Array<{ hiderId: string }>;
  errors: string[];
  bytes: number;
  latest(): RTClient["snapshots"][number] | undefined;
  sendInput(p: Partial<{ x: number; z: number; yaw: number; pose: string; running: boolean; moving: boolean }>): void;
  waitFor(pred: (c: RTClient) => boolean, ms?: number): Promise<void>;
  close(): void;
}

function connect(roomId: string, playerId: string, token: string): Promise<RTClient> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    let seq = 0;
    const c: RTClient = {
      ws,
      snapshots: [],
      caught: [],
      errors: [],
      bytes: 0,
      latest() {
        return this.snapshots[this.snapshots.length - 1];
      },
      sendInput(p) {
        seq += 1;
        ws.send(
          JSON.stringify({
            type: "input",
            seq,
            t: Date.now(),
            x: p.x ?? 0,
            z: p.z ?? 0,
            yaw: p.yaw ?? 0,
            pitch: 0,
            anim: "idle",
            pose: p.pose ?? "stand",
            moving: p.moving ?? false,
            running: p.running ?? true,
          }),
        );
      },
      async waitFor(pred, ms = 8000) {
        const deadline = Date.now() + ms;
        while (Date.now() < deadline) {
          if (pred(this)) return;
          await new Promise((r) => setTimeout(r, 50));
        }
        throw new Error("waitFor timed out");
      },
      close() {
        ws.close();
      },
    };
    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "hello", roomId, playerId, token }));
      resolve(c);
    });
    ws.on("message", (d) => {
      const raw = d.toString();
      c.bytes += raw.length;
      let m: Record<string, unknown>;
      try {
        m = JSON.parse(raw);
      } catch {
        return;
      }
      if (m.type === "welcome") c.welcome = { role: m.role as string | null };
      else if (m.type === "snapshot") c.snapshots.push(m as never);
      else if (m.type === "caught") c.caught.push(m as never);
      else if (m.type === "error") c.errors.push(String(m.message));
    });
    ws.on("error", reject);
    setTimeout(() => reject(new Error("ws open timeout")), 8000);
  });
}

// ---------------------------------------------------------------------------

test("a WebSocket with a bad token is rejected and never welcomed", async ({ request }) => {
  const room = await createRoom(request, "ホスト");
  const client = await connect(room.roomId, room.playerId, "totally-wrong-token");
  await client.waitFor((c) => c.errors.length > 0, 8000);
  expect(client.errors.join()).toMatch(/auth/i);
  expect(client.welcome).toBeUndefined();
  client.close();
});

test("two-player round: roles, position sync, anti-teleport, NO info leak, catch → seeker win", async ({
  request,
}) => {
  const host0 = await createRoom(request, "ホスト");
  const guest = await join(request, host0.roomId, "ゲスト");
  expect(guest.status).toBe(200);
  const roomId: string = host0.roomId;

  await ready(request, roomId, host0.token);
  await ready(request, roomId, guest.body.token);
  await start(request, roomId, host0.token);

  // Identify roles from the server state (authoritative).
  const started = await getRoom(request, roomId);
  const seekerP = started.players.find((p: { role: string }) => p.role === "seeker");
  const hiderP = started.players.find((p: { role: string }) => p.role === "hider");
  const seekerIsHost = seekerP.id === host0.playerId;
  const seekerTok = seekerIsHost ? host0.token : guest.body.token;
  const hiderTok = seekerIsHost ? guest.body.token : host0.token;

  const seeker = await connect(roomId, seekerP.id, seekerTok);
  const hider = await connect(roomId, hiderP.id, hiderTok);
  await seeker.waitFor((c) => c.welcome?.role === "seeker");
  await hider.waitFor((c) => c.welcome?.role === "hider");

  // Drive to the seeking phase.
  await waitForPhase(request, roomId, "seeking");

  // Keep the hider parked in a corner far in front of where the seeker will NOT
  // look, and point the seeker AT A WALL (away from the hider). Then the seeker
  // must receive ZERO hiders — the core anti-info-leak guarantee, over the wire.
  const parkHider = async () => {
    for (let i = 0; i < 6; i++) {
      hider.sendInput({ x: -6, z: -1, yaw: 0, moving: true, running: true });
      await new Promise((r) => setTimeout(r, 60));
    }
  };
  await parkHider();
  for (let i = 0; i < 8; i++) {
    seeker.sendInput({ x: 0, z: 5, yaw: Math.PI, moving: false }); // face +Z (the wall)
    await new Promise((r) => setTimeout(r, 60));
  }
  seeker.snapshots.length = 0;
  await seeker.waitFor((c) => c.snapshots.length >= 3, 4000);
  const leaked = seeker.snapshots.some((s) =>
    s.players.some((p) => p.id === hiderP.id),
  );
  expect(leaked, "seeker must not receive a hidden hider's position").toBe(false);

  // The hider, by contrast, always receives the seeker (public).
  await hider.waitFor(
    (c) => (c.latest()?.players ?? []).some((p) => p.id === seekerP.id),
    4000,
  );

  // Anti-teleport: the seeker claims a wild jump; the hider's view of the seeker
  // stays clamped near the arena, never at the bogus coordinate.
  for (let i = 0; i < 4; i++) {
    seeker.sendInput({ x: 9999, z: 9999, yaw: 0, moving: true, running: true });
    await new Promise((r) => setTimeout(r, 60));
  }
  await new Promise((r) => setTimeout(r, 300));
  const seekerSeenByHider = (hider.latest()?.players ?? []).find((p) => p.id === seekerP.id);
  expect(Math.abs(seekerSeenByHider!.x)).toBeLessThan(20);
  expect(Math.abs(seekerSeenByHider!.z)).toBeLessThan(20);

  // Catch authority: a client WITHOUT the realtime secret cannot mark a catch.
  const forged = await request.post(`/api/games/color-hide/rooms/${roomId}/catch`, {
    data: { hiderId: hiderP.id },
  });
  expect(forged.status()).toBe(403);

  // The trusted realtime host path (shared secret) catches the last hider → win.
  const legit = await request.post(`/api/games/color-hide/rooms/${roomId}/catch`, {
    headers: { "x-color-hide-rt-secret": RT_SECRET },
    data: { hiderId: hiderP.id },
  });
  expect(legit.ok()).toBeTruthy();
  const after = await getRoom(request, roomId);
  expect(after.phase).toBe("result");
  expect(after.result.winner).toBe("seeker");

  seeker.close();
  hider.close();
});

test("win by timer: with no catches, the hiders win when seeking ends", async ({ request }) => {
  const host0 = await createRoom(request, "ホスト");
  const guest = await join(request, host0.roomId, "ゲスト");
  const roomId: string = host0.roomId;
  await ready(request, roomId, host0.token);
  await ready(request, roomId, guest.body.token);
  await start(request, roomId, host0.token);

  // Let the whole round elapse without any catch.
  const result = await waitForPhase(request, roomId, "result", 30_000);
  expect(result.result.winner).toBe("hider");
  expect(result.result.survivors.length).toBeGreaterThanOrEqual(1);
});

test("six players: one seeker, five hiders, all welcomed over sockets", async ({ request }) => {
  const host0 = await createRoom(request, "ホスト");
  const roomId: string = host0.roomId;
  const players = [{ id: host0.playerId, token: host0.token }];
  for (let i = 2; i <= 6; i++) {
    const j = await join(request, roomId, `P${i}`);
    expect(j.status).toBe(200);
    players.push({ id: j.body.playerId, token: j.body.token });
  }
  for (const p of players) await ready(request, roomId, p.token);
  await start(request, roomId, host0.token);

  const state = await getRoom(request, roomId);
  expect(state.players.filter((p: { role: string }) => p.role === "seeker")).toHaveLength(1);
  expect(state.players.filter((p: { role: string }) => p.role === "hider")).toHaveLength(5);

  const clients = await Promise.all(
    players.map((p) => connect(roomId, p.id, p.token)),
  );
  for (const c of clients) await c.waitFor((cc) => cc.welcome !== undefined, 10_000);
  expect(clients.filter((c) => c.welcome?.role === "seeker")).toHaveLength(1);
  expect(clients.filter((c) => c.welcome?.role === "hider")).toHaveLength(5);

  // Measure realtime traffic for the report: snapshots a single client receives.
  await waitForPhase(request, roomId, "seeking");
  const sample = clients[0];
  sample.snapshots.length = 0;
  const startBytes = sample.bytes;
  await new Promise((r) => setTimeout(r, 2000));
  const msgs = sample.snapshots.length;
  const kb = ((sample.bytes - startBytes) / 1024).toFixed(1);
  console.log(`[perf] 6p seeking: one client received ${msgs} snapshots / ${kb} KB in 2s`);
  expect(msgs).toBeGreaterThan(10); // ~15 Hz → ~30 in 2s

  for (const c of clients) c.close();
});

test("reconnect: a player can drop its socket and rejoin the live round", async ({ request }) => {
  const host0 = await createRoom(request, "ホスト");
  const guest = await join(request, host0.roomId, "ゲスト");
  const roomId: string = host0.roomId;
  await ready(request, roomId, host0.token);
  await ready(request, roomId, guest.body.token);
  await start(request, roomId, host0.token);
  await waitForPhase(request, roomId, "seeking");

  const first = await connect(roomId, host0.playerId, host0.token);
  await first.waitFor((c) => c.welcome !== undefined);
  first.close();
  await new Promise((r) => setTimeout(r, 300));

  const again = await connect(roomId, host0.playerId, host0.token);
  await again.waitFor((c) => c.welcome !== undefined, 8000);
  expect(again.welcome).toBeDefined();
  again.close();
});

// A valid tiny 1x1 PNG data URL (well under MAX_PAINT_BYTES, matches the payload regex).
const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

test("Phase 10: paint commit is accepted during hiding but REJECTED once seeking begins", async ({
  request,
}) => {
  const host = await createRoom(request, "H");
  const g = await join(request, host.roomId, "G");
  const roomId = host.roomId as string;
  await ready(request, roomId, host.token);
  await ready(request, roomId, g.body.token);
  await start(request, roomId, host.token);

  // Reach the hiding (& painting) phase and commit — the server accepts it.
  await waitForPhase(request, roomId, "hiding");
  const ok = await request.post(`/api/games/color-hide/rooms/${roomId}/paint`, {
    headers: { "x-color-hide-token": host.token },
    data: { paint: TINY_PNG },
  });
  expect(ok.status()).toBe(200);

  // Once the hunt starts, the server refuses further commits (client can't extend).
  await waitForPhase(request, roomId, "seeking");
  const rejected = await request.post(`/api/games/color-hide/rooms/${roomId}/paint`, {
    headers: { "x-color-hide-token": host.token },
    data: { paint: TINY_PNG },
  });
  expect(rejected.status()).toBe(409);
  const body = await rejected.json();
  expect(body.error?.code).toBe("phase_closed");
});

test("Phase 10: during hiding the seeker receives NO hider positions (server-side)", async ({
  request,
}) => {
  const host = await createRoom(request, "H");
  const g = await join(request, host.roomId, "G");
  const roomId = host.roomId as string;
  await ready(request, roomId, host.token);
  await ready(request, roomId, g.body.token);
  await start(request, roomId, host.token);

  const started = await waitForPhase(request, roomId, "hiding");
  const seekerP = started.players.find((p: { role: string }) => p.role === "seeker");
  const hiderP = started.players.find((p: { role: string }) => p.role === "hider");
  const seekerTok = seekerP.id === host.playerId ? host.token : g.body.token;
  const hiderTok = hiderP.id === host.playerId ? host.token : g.body.token;

  const seeker = await connect(roomId, seekerP.id, seekerTok);
  const hider = await connect(roomId, hiderP.id, hiderTok);
  await seeker.waitFor((c) => c.welcome?.role === "seeker");
  await hider.waitFor((c) => c.welcome?.role === "hider");

  // Hider roams during hiding; collect the seeker's snapshots for ~2s.
  seeker.snapshots.length = 0;
  for (let i = 0; i < 20; i++) {
    hider.sendInput({ x: 0, z: 1 + i * 0.05, moving: true });
    await new Promise((r) => setTimeout(r, 90));
  }
  // The seeker must never have received the hider while hiding (server withholds it).
  const leaked = seeker.snapshots.some((s) => s.players.some((p) => p.id === hiderP.id));
  expect(leaked).toBe(false);
  // Sanity: the seeker is still receiving its own snapshots.
  expect(seeker.snapshots.some((s) => s.players.some((p) => p.id === seekerP.id))).toBe(true);

  seeker.close();
  hider.close();
});
