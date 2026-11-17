/**
 * COLOR HIDE — local realtime host (development / test only).
 *
 * A standalone `ws` server that runs the transport-agnostic {@link ColorHideServer}
 * netcode. It is the "local-first" stand-in for a managed realtime host (PartyKit):
 * the same netcode class will later run inside PartyKit unchanged — only this glue
 * is replaced. It never embeds game secrets; it talks to the Next app over HTTP:
 *
 *   - auth:         GET  /api/games/color-hide/rooms/:id   (with the player token)
 *   - room meta:    GET  /api/games/color-hide/rooms/:id   (no token)
 *   - persist catch:POST /api/games/color-hide/rooms/:id/catch  (shared RT secret)
 *
 * Run with:  npm run dev:color-hide-rt   (alongside `npm run dev`)
 *
 * Config (env): COLOR_HIDE_WS_PORT (1999), COLOR_HIDE_APP_URL (http://localhost:3000),
 * COLOR_HIDE_RT_SECRET (dev default).
 */

import { WebSocketServer, type WebSocket } from "ws";
import {
  ColorHideServer,
  type Outbound,
  type RoomMeta,
  type RoomMetaProvider,
} from "../net/realtime";
import { parseClientMsg } from "../net/protocol";
import { NET_TICK_HZ } from "../lib/constants";

const PORT = Number(process.env.COLOR_HIDE_WS_PORT ?? 1999);
const APP_URL = process.env.COLOR_HIDE_APP_URL ?? "http://localhost:3000";
const RT_SECRET = process.env.COLOR_HIDE_RT_SECRET ?? "color-hide-dev-rt-secret";

const roomUrl = (roomId: string) =>
  `${APP_URL}/api/games/color-hide/rooms/${encodeURIComponent(roomId)}`;

/** Maps the app's public room view into the meta slice the netcode needs. */
function toMeta(publicState: {
  phase: RoomMeta["phase"];
  phaseStartedAt: number;
  mapId: RoomMeta["mapId"];
  seekerId: string | null;
  players: Array<{ id: string; role: RoomMeta["players"][number]["role"]; caught: boolean }>;
}): RoomMeta {
  return {
    phase: publicState.phase,
    phaseStartedAt: publicState.phaseStartedAt,
    mapId: publicState.mapId,
    seekerId: publicState.seekerId,
    players: publicState.players.map((p) => ({ id: p.id, role: p.role, caught: p.caught })),
  };
}

const provider: RoomMetaProvider = {
  async getMeta(roomId) {
    try {
      const res = await fetch(roomUrl(roomId), { cache: "no-store" });
      if (!res.ok) return null;
      const body = (await res.json()) as { publicState?: Parameters<typeof toMeta>[0] };
      return body.publicState ? toMeta(body.publicState) : null;
    } catch {
      return null;
    }
  },
  async persistCatch(roomId, hiderId) {
    try {
      await fetch(`${roomUrl(roomId)}/catch`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-color-hide-rt-secret": RT_SECRET,
        },
        body: JSON.stringify({ hiderId }),
      });
    } catch {
      /* best-effort; the next tick re-reads meta anyway */
    }
  },
};

/** Verifies a player's token maps to the claimed id (via the app's own view). */
async function authenticate(
  roomId: string,
  playerId: string,
  token: string | undefined,
): Promise<boolean> {
  if (!token) return false;
  try {
    const res = await fetch(roomUrl(roomId), {
      cache: "no-store",
      headers: { "x-color-hide-token": token },
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { publicState?: { yourId?: string | null } };
    return body.publicState?.yourId === playerId;
  } catch {
    return false;
  }
}

const wss = new WebSocketServer({ port: PORT });
const sockets = new Map<string, WebSocket>();
const activeRooms = new Set<string>();
let nextConnId = 1;

const out: Outbound = {
  send(connId, msg) {
    const ws = sockets.get(connId);
    if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  },
  close(connId) {
    sockets.get(connId)?.close();
  },
};

const server = new ColorHideServer(provider, out);

wss.on("connection", (ws) => {
  const connId = String(nextConnId++);
  sockets.set(connId, ws);
  let helloed = false;

  ws.on("message", async (data) => {
    const msg = parseClientMsg(safeParse(data.toString()));
    if (!msg) return;

    if (msg.type === "hello") {
      if (helloed) return;
      const ok = await authenticate(msg.roomId, msg.playerId, msg.token);
      if (!ok) {
        out.send(connId, { type: "error", message: "authentication failed" });
        ws.close();
        return;
      }
      helloed = true;
      activeRooms.add(msg.roomId);
      await server.handleHello(connId, msg.roomId, msg.playerId, Date.now());
      return;
    }
    if (!helloed) return;

    if (msg.type === "input") {
      server.handleInput(connId, msg, Date.now());
    } else if (msg.type === "catch") {
      await server.handleCatch(connId, msg.targetId, Date.now());
    } else if (msg.type === "ping") {
      server.handlePing(connId, msg.t);
    }
  });

  ws.on("close", () => {
    sockets.delete(connId);
    server.handleDisconnect(connId);
  });
  ws.on("error", () => ws.close());
});

// Refresh meta + broadcast filtered snapshots at the network tick rate.
const tickMs = Math.round(1000 / NET_TICK_HZ);
setInterval(() => {
  const now = Date.now();
  for (const roomId of activeRooms) void server.refreshMeta(roomId, now);
  server.tick(now);
}, tickMs);

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

console.log(
  `[color-hide] realtime host listening on ws://localhost:${PORT} (app: ${APP_URL}, tick: ${NET_TICK_HZ}Hz)`,
);
