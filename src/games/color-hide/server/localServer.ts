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

import { createServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { ColorHideServer, type Outbound } from "../net/realtime";
import { parseClientMsg } from "../net/protocol";
import { NET_TICK_HZ } from "../lib/constants";
import { DEV_RT_SECRET } from "../lib/realtimeShared";
import { authenticate as authPlayer, createHttpProvider } from "./httpProvider";

const PORT = Number(process.env.COLOR_HIDE_WS_PORT ?? 1999);
const APP_URL = process.env.COLOR_HIDE_APP_URL ?? "http://localhost:3000";
const RT_SECRET = process.env.COLOR_HIDE_RT_SECRET ?? DEV_RT_SECRET;

// Shared provider + auth (identical code runs in the Cloudflare Durable Object).
const provider = createHttpProvider({ appUrl: APP_URL, secret: RT_SECRET });
const authenticate = (roomId: string, playerId: string, token: string | undefined) =>
  authPlayer(APP_URL, roomId, playerId, token);

// A tiny HTTP server shares the port so tooling (and Playwright) can health-check
// readiness; the WebSocket server is attached to it.
const httpServer = createServer((req, res) => {
  if (req.method === "GET" && (req.url === "/health" || req.url === "/")) {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
    return;
  }
  res.writeHead(404);
  res.end();
});
const wss = new WebSocketServer({ server: httpServer });
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

const metaRefreshMs = Number(process.env.COLOR_HIDE_META_REFRESH_MS) || undefined;
const server = new ColorHideServer(provider, out, { metaRefreshMs });

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

httpServer.listen(PORT, () => {
  console.log(
    `[color-hide] realtime host listening on ws://localhost:${PORT} ` +
      `(health: http://localhost:${PORT}/health, app: ${APP_URL}, tick: ${NET_TICK_HZ}Hz)`,
  );
});
