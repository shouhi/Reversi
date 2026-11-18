import { test, expect, type APIRequestContext } from "@playwright/test";
import { WebSocket } from "ws";
import { spawn, type ChildProcess } from "node:child_process";
import {
  planInputSend,
  type InputSample,
} from "../src/games/color-hide/lib/inputSend";

/**
 * COLOR HIDE — PartyServer / Cloudflare Durable Object integration test.
 *
 * Runs the ACTUAL Worker on `wrangler dev` (local workerd — no Cloudflare account,
 * no deploy) and drives real WebSocket clients against the Durable Object, with the
 * Playwright-managed Next app as the room authority. Proves the production realtime
 * path end-to-end: per-room DO routing, token auth, position sync, the no-info-leak
 * guarantee, anti-teleport, catch → win, win-by-timer, 6 players, cross-room
 * isolation, paint sharing, and reconnect.
 *
 * Runs only under the `partyserver` Playwright project: `npm run test:partyserver`.
 */

const APP = "http://localhost:3100";
const WS = "ws://localhost:8787/parties/color-hide";
const RT_SECRET = "color-hide-dev-rt-secret";

let host: ChildProcess;

async function waitForHealth(url: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      /* not up */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`wrangler dev did not become healthy at ${url}`);
}

test.beforeAll(async () => {
  host = spawn(
    `npx wrangler dev --config cloudflare/color-hide/wrangler.toml --port 8787 ` +
      `--var ENVIRONMENT:development --var COLOR_HIDE_APP_URL:${APP} ` +
      `--var COLOR_HIDE_RT_SECRET:${RT_SECRET} ` +
      // An allowlist so the Origin check is active. Node ws clients send no Origin
      // (→ allowed); the bad-Origin test sends a disallowed one (→ 403).
      `--var COLOR_HIDE_ALLOWED_ORIGINS:${APP}`,
    { shell: true, env: { ...process.env }, stdio: "pipe" },
  );
  host.stderr?.on("data", (d) => {
    const s = d.toString();
    if (/EADDRINUSE|error/i.test(s)) console.error("[wrangler]", s.trim());
  });
  await waitForHealth("http://localhost:8787/health", 90_000);
});

test.afterAll(() => {
  host?.kill("SIGKILL");
});

// --- HTTP helpers -----------------------------------------------------------
async function createRoom(request: APIRequestContext, nickname: string) {
  return (await request.post(`/api/games/color-hide/rooms`, { data: { nickname } })).json();
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
  const r = await request.post(`/api/games/color-hide/rooms/${roomId}/action`, {
    headers: { "x-color-hide-token": token },
    data: { action: "start" },
  });
  expect(r.ok()).toBeTruthy();
}
async function getRoom(request: APIRequestContext, roomId: string) {
  return (await (await request.get(`/api/games/color-hide/rooms/${roomId}`)).json()).publicState;
}
async function waitForPhase(request: APIRequestContext, roomId: string, phase: string, ms = 25_000) {
  const deadline = Date.now() + ms;
  let last = "";
  while (Date.now() < deadline) {
    const s = await getRoom(request, roomId);
    last = s.phase;
    if (s.phase === phase) return s;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`room ${roomId} never reached ${phase} (last ${last})`);
}

// --- WS client to the Durable Object ---------------------------------------
interface Client {
  ws: WebSocket;
  welcome?: { role: string | null };
  snaps: Array<{ players: Array<{ id: string; x: number; z: number; role: string | null }> }>;
  errors: string[];
  latest(): Client["snaps"][number] | undefined;
  input(p: Partial<{ x: number; z: number; yaw: number; moving: boolean; running: boolean }>): void;
  catch(id: string): void;
  waitFor(pred: (c: Client) => boolean, ms?: number): Promise<void>;
  close(): void;
}

function connect(roomId: string, playerId: string, token: string): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS}/${roomId}`);
    let seq = 0;
    const c: Client = {
      ws,
      snaps: [],
      errors: [],
      latest() {
        return this.snaps[this.snaps.length - 1];
      },
      input(p) {
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
            pose: "stand",
            moving: p.moving ?? false,
            running: p.running ?? true,
          }),
        );
      },
      catch(id) {
        ws.send(JSON.stringify({ type: "catch", targetId: id }));
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
      let m: Record<string, unknown>;
      try {
        m = JSON.parse(d.toString());
      } catch {
        return;
      }
      if (m.type === "welcome") c.welcome = { role: m.role as string | null };
      else if (m.type === "snapshot") c.snaps.push(m as never);
      else if (m.type === "error") c.errors.push(String(m.message));
    });
    ws.on("error", reject);
    setTimeout(() => reject(new Error("ws open timeout")), 8000);
  });
}

/** Walks a player toward (x,z) by resending the target (the DO clamps each step). */
async function moveTo(c: Client, x: number, z: number, yaw: number, steps = 30) {
  for (let i = 0; i < steps; i++) {
    c.input({ x, z, yaw, moving: true, running: true });
    await new Promise((r) => setTimeout(r, 50));
  }
}

// ---------------------------------------------------------------------------

test("bad token is rejected by the Durable Object", async ({ request }) => {
  const room = await createRoom(request, "H");
  const c = await connect(room.roomId, room.playerId, "wrong");
  await c.waitFor((x) => x.errors.length > 0);
  expect(c.errors.join()).toMatch(/auth/i);
  expect(c.welcome).toBeUndefined();
  c.close();
});

test("a disallowed Origin is rejected before the WebSocket upgrade", async ({ request }) => {
  const room = await createRoom(request, "H");
  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(`${WS}/${room.roomId}`, { origin: "https://evil.example" });
    ws.on("open", () => {
      ws.close();
      reject(new Error("disallowed Origin should not have connected"));
    });
    ws.on("unexpected-response", () => resolve());
    ws.on("error", () => resolve()); // 403 upgrade surfaces as an error
    setTimeout(() => reject(new Error("no response to bad-Origin upgrade")), 6000);
  });
});

test("the 7th player is rejected (6-seat cap enforced by the app)", async ({ request }) => {
  const h = await createRoom(request, "H");
  for (let i = 2; i <= 6; i++) {
    const j = await join(request, h.roomId, `P${i}`);
    expect(j.status).toBe(200);
  }
  const seventh = await join(request, h.roomId, "P7");
  expect(seventh.status).toBe(409);
});

test("2-player round over the DO: roles, sync, no info leak, anti-teleport, catch → win", async ({
  request,
}) => {
  const h = await createRoom(request, "ホスト");
  const g = await join(request, h.roomId, "ゲスト");
  const roomId = h.roomId as string;
  await ready(request, roomId, h.token);
  await ready(request, roomId, g.body.token);
  await start(request, roomId, h.token);

  const started = await getRoom(request, roomId);
  const seekerP = started.players.find((p: { role: string }) => p.role === "seeker");
  const hiderP = started.players.find((p: { role: string }) => p.role === "hider");
  const seekerTok = seekerP.id === h.playerId ? h.token : g.body.token;
  const hiderTok = seekerP.id === h.playerId ? g.body.token : h.token;

  const seeker = await connect(roomId, seekerP.id, seekerTok);
  const hider = await connect(roomId, hiderP.id, hiderTok);
  await seeker.waitFor((c) => c.welcome?.role === "seeker");
  await hider.waitFor((c) => c.welcome?.role === "hider");
  await waitForPhase(request, roomId, "seeking");

  // No info leak: seeker faces the +Z wall (away from the hider) → receives no hiders.
  for (let i = 0; i < 6; i++) {
    seeker.input({ x: 0, z: 5, yaw: Math.PI, moving: false });
    await new Promise((r) => setTimeout(r, 60));
  }
  seeker.snaps.length = 0;
  await seeker.waitFor((c) => c.snaps.length >= 3, 4000);
  expect(seeker.snaps.some((s) => s.players.some((p) => p.id === hiderP.id))).toBe(false);
  // Hider always receives the seeker.
  await hider.waitFor((c) => (c.latest()?.players ?? []).some((p) => p.id === seekerP.id), 4000);

  // Anti-teleport: a wild jump is clamped in the hider's view of the seeker.
  for (let i = 0; i < 4; i++) {
    seeker.input({ x: 9999, z: 9999, yaw: 0, moving: true, running: true });
    await new Promise((r) => setTimeout(r, 60));
  }
  await new Promise((r) => setTimeout(r, 300));
  const seen = (hider.latest()?.players ?? []).find((p) => p.id === seekerP.id)!;
  expect(Math.abs(seen.x)).toBeLessThan(20);

  // Catch → win: bring the hider in front of the seeker; seeker faces it and catches.
  for (let i = 0; i < 6; i++) {
    seeker.input({ x: 0, z: 5, yaw: 0, moving: false }); // face -Z, at spawn
    await new Promise((r) => setTimeout(r, 50));
  }
  await moveTo(hider, 0, 3, 0, 36); // ~2 units in front of the seeker
  for (let i = 0; i < 8; i++) {
    seeker.catch(hiderP.id);
    await new Promise((r) => setTimeout(r, 150));
    const s = await getRoom(request, roomId);
    if (s.phase === "result") break;
  }
  const after = await getRoom(request, roomId);
  expect(after.phase).toBe("result");
  expect(after.result.winner).toBe("seeker");

  seeker.close();
  hider.close();
});

test("win by timer over the DO: hiders survive", async ({ request }) => {
  const h = await createRoom(request, "H");
  const g = await join(request, h.roomId, "G");
  const roomId = h.roomId as string;
  await ready(request, roomId, h.token);
  await ready(request, roomId, g.body.token);
  await start(request, roomId, h.token);
  const result = await waitForPhase(request, roomId, "result", 30_000);
  expect(result.result.winner).toBe("hider");
});

test("six players connect to the DO and are welcomed (1 seeker, 5 hiders)", async ({ request }) => {
  const h = await createRoom(request, "H");
  const roomId = h.roomId as string;
  const players = [{ id: h.playerId, token: h.token }];
  for (let i = 2; i <= 6; i++) {
    const j = await join(request, roomId, `P${i}`);
    players.push({ id: j.body.playerId, token: j.body.token });
  }
  for (const p of players) await ready(request, roomId, p.token);
  await start(request, roomId, h.token);

  const clients = await Promise.all(players.map((p) => connect(roomId, p.id, p.token)));
  for (const c of clients) await c.waitFor((x) => x.welcome !== undefined, 10_000);
  expect(clients.filter((c) => c.welcome?.role === "seeker")).toHaveLength(1);
  expect(clients.filter((c) => c.welcome?.role === "hider")).toHaveLength(5);
  for (const c of clients) c.close();
});

test("cross-room isolation: room A never sees room B's players", async ({ request }) => {
  const a = await createRoom(request, "A-host");
  const ag = await join(request, a.roomId, "A-guest");
  const b = await createRoom(request, "B-host");
  const bg = await join(request, b.roomId, "B-guest");
  for (const [rid, ...toks] of [
    [a.roomId, a.token, ag.body.token],
    [b.roomId, b.token, bg.body.token],
  ] as const) {
    await ready(request, rid, toks[0]);
    await ready(request, rid, toks[1]);
    await start(request, rid, toks[0]);
  }
  await waitForPhase(request, a.roomId, "seeking");
  await waitForPhase(request, b.roomId, "seeking");

  const aHost = await connect(a.roomId, a.playerId, a.token);
  const bHost = await connect(b.roomId, b.playerId, b.token);
  await aHost.waitFor((c) => c.snaps.length >= 3, 5000);
  const aIds = new Set(aHost.snaps.flatMap((s) => s.players.map((p) => p.id)));
  // A's DO must only ever contain room A's players.
  expect(aIds.has(b.playerId)).toBe(false);
  expect(aIds.has(bg.body.playerId)).toBe(false);
  expect([...aIds].every((id) => id === a.playerId || id === ag.body.playerId)).toBe(true);

  aHost.close();
  bHost.close();
});

test("paint sharing: a committed paint is retrievable by others", async ({ request }) => {
  const h = await createRoom(request, "H");
  const g = await join(request, h.roomId, "G");
  const roomId = h.roomId as string;
  const png =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  const commit = await request.post(`/api/games/color-hide/rooms/${roomId}/paint`, {
    headers: { "x-color-hide-token": g.body.token },
    data: { paint: png },
  });
  expect(commit.ok()).toBeTruthy();
  const paints = (await (await request.get(`/api/games/color-hide/rooms/${roomId}/paint`)).json())
    .paints;
  expect(paints[g.body.playerId]).toBe(png);
});

test("reconnect to the DO with the same token/id", async ({ request }) => {
  const h = await createRoom(request, "H");
  const g = await join(request, h.roomId, "G");
  const roomId = h.roomId as string;
  await ready(request, roomId, h.token);
  await ready(request, roomId, g.body.token);
  await start(request, roomId, h.token);
  await waitForPhase(request, roomId, "seeking");

  const first = await connect(roomId, h.playerId, h.token);
  await first.waitFor((c) => c.welcome !== undefined);
  first.close();
  await new Promise((r) => setTimeout(r, 400));
  const again = await connect(roomId, h.playerId, h.token);
  await again.waitFor((c) => c.welcome !== undefined, 8000);
  expect(again.welcome).toBeDefined();
  again.close();
});

test("SPECTATOR over the DO: a caught hider no longer receives uncaught hiders' positions", async ({
  request,
}) => {
  // 3 players so there is an uncaught hider to (not) leak. Seeker catches hider A;
  // A becomes a spectator and must NOT see the still-uncaught hider B — enforced
  // server-side in the real Durable Object (local workerd), not on the client.
  const h = await createRoom(request, "H");
  const g1 = await join(request, h.roomId, "G1");
  const g2 = await join(request, h.roomId, "G2");
  const roomId = h.roomId as string;
  await ready(request, roomId, h.token);
  await ready(request, roomId, g1.body.token);
  await ready(request, roomId, g2.body.token);
  await start(request, roomId, h.token);

  const started = await getRoom(request, roomId);
  const seekerP = started.players.find((p: { role: string }) => p.role === "seeker");
  const hiders = started.players.filter((p: { role: string }) => p.role === "hider");
  const tokenOf = (id: string) =>
    id === h.playerId ? h.token : id === g1.body.playerId ? g1.body.token : g2.body.token;

  const seeker = await connect(roomId, seekerP.id, tokenOf(seekerP.id));
  const hiderA = await connect(roomId, hiders[0].id, tokenOf(hiders[0].id));
  const hiderB = await connect(roomId, hiders[1].id, tokenOf(hiders[1].id));
  await seeker.waitFor((c) => c.welcome?.role === "seeker");
  await hiderA.waitFor((c) => c.welcome?.role === "hider");
  await hiderB.waitFor((c) => c.welcome?.role === "hider");
  await waitForPhase(request, roomId, "seeking");

  // Keep B well away and uncaught; bring A in front of the seeker and catch A.
  await moveTo(hiderB, -6, -5, 0, 30);
  for (let i = 0; i < 6; i++) {
    seeker.input({ x: 0, z: 5, yaw: 0, moving: false }); // seeker at spawn facing -Z
    await new Promise((r) => setTimeout(r, 50));
  }
  await moveTo(hiderA, 0, 3, 0, 36); // ~2 units in front of the seeker
  let caught = false;
  for (let i = 0; i < 10; i++) {
    seeker.catch(hiders[0].id);
    await new Promise((r) => setTimeout(r, 150));
    const s = await getRoom(request, roomId);
    const a = s.players.find((p: { id: string }) => p.id === hiders[0].id);
    if (a?.caught) { caught = true; break; }
  }
  expect(caught).toBe(true);

  // Now A is a spectator. Collect fresh snapshots and assert A never receives B
  // (the uncaught hider), while still receiving the (public) seeker.
  hiderA.snaps.length = 0;
  await hiderA.waitFor((c) => c.snaps.length >= 4, 5000);
  const everSawB = hiderA.snaps.some((s) => s.players.some((p) => p.id === hiders[1].id));
  const sawSeeker = hiderA.snaps.some((s) => s.players.some((p) => p.id === seekerP.id));
  expect(everSawB).toBe(false); // uncaught hider NEVER leaked to the spectator
  expect(sawSeeker).toBe(true); // seeker is public — spectator may watch them

  seeker.close();
  hiderA.close();
  hiderB.close();
});

test("NETCODE: the hybrid send planner cuts inbound messages vs a fixed rate (real DO)", async ({
  request,
}) => {
  // Real socket + real Durable Object (local workerd) measurement of Phase 9-E.
  // 3 players so an ACTIVE-hider observer always sees the mover (teammates are
  // mutually visible), letting us confirm the server still relays real movement.
  const h = await createRoom(request, "H");
  const g1 = await join(request, h.roomId, "MOVER");
  const g2 = await join(request, h.roomId, "OBS");
  const roomId = h.roomId as string;
  await ready(request, roomId, h.token);
  await ready(request, roomId, g1.body.token);
  await ready(request, roomId, g2.body.token);
  await start(request, roomId, h.token);

  const started = await getRoom(request, roomId);
  const seekerP = started.players.find((p: { role: string }) => p.role === "seeker");
  const hiders = started.players.filter((p: { role: string }) => p.role === "hider");
  const tokenOf = (id: string) =>
    id === h.playerId ? h.token : id === g1.body.playerId ? g1.body.token : g2.body.token;
  const moverP = hiders[0];
  const obsP = hiders[1];

  const seeker = await connect(roomId, seekerP.id, tokenOf(seekerP.id));
  const mover = await connect(roomId, moverP.id, tokenOf(moverP.id));
  const obs = await connect(roomId, obsP.id, tokenOf(obsP.id));
  await mover.waitFor((c) => !!c.welcome);
  await obs.waitFor((c) => !!c.welcome);
  await waitForPhase(request, roomId, "seeking", 20000);

  // Drive the mover through the REAL planInputSend over ~6s at ~60 fps:
  // 2s still → 3s moving (+x) → 1s still. Count real socket sends, and count what
  // a fixed-rate (~18 Hz nominal) client WOULD send over the identical timeline.
  obs.snaps.length = 0;
  let prevSent: InputSample | null = null;
  let lastPlannerAt = 0;
  let lastLegacyAt = -Infinity;
  let plannerSends = 0;
  let legacySends = 0;
  const LEGACY_INTERVAL = 1000 / 18;
  const t0 = Date.now();
  const DURATION = 6000;
  while (Date.now() - t0 < DURATION) {
    const el = Date.now() - t0;
    const moving = el >= 2000 && el < 5000;
    const x = el < 2000 ? 0 : el < 5000 ? ((el - 2000) / 1000) * 2.5 : 7.5;
    const cur: InputSample = { x, z: 3, yaw: 0, moving, running: false, pose: "stand" };
    const now = Date.now();
    if (now - lastLegacyAt >= LEGACY_INTERVAL) {
      legacySends += 1;
      lastLegacyAt = now;
    }
    const dtSince = prevSent ? now - lastPlannerAt : Infinity;
    if (planInputSend(prevSent, cur, dtSince) !== "none") {
      mover.input({ x, z: 3, yaw: 0, moving, running: false });
      prevSent = cur;
      lastPlannerAt = now;
      plannerSends += 1;
    }
    await new Promise((r) => setTimeout(r, 1000 / 60));
  }

  const moverXs = obs.snaps
    .map((s) => s.players.find((p) => p.id === moverP.id)?.x)
    .filter((v): v is number => typeof v === "number");
  const range = moverXs.length ? Math.max(...moverXs) - Math.min(...moverXs) : 0;
  const reductionPct = legacySends ? (100 * (1 - plannerSends / legacySends)).toFixed(0) : "n/a";
  console.log(
    `[netcode] plannerSends=${plannerSends} legacySends=${legacySends} reduction=${reductionPct}% moverXrange=${range.toFixed(2)}`,
  );

  expect(range).toBeGreaterThan(1.0); // the real DO relayed genuine movement
  expect(plannerSends).toBeGreaterThan(0);
  expect(plannerSends).toBeLessThan(legacySends * 0.6); // ≥40% fewer inbound messages

  seeker.close();
  mover.close();
  obs.close();
});
