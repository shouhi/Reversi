import { routePartykitRequest } from "partyserver";
import { ColorHide, type Env } from "./party";
import {
  isOriginAllowed,
  parseOrigins,
} from "../../../src/games/color-hide/lib/realtimeShared";

/**
 * COLOR HIDE realtime Worker entry.
 *
 * Routes `/parties/color-hide/<roomId>` to this room's Durable Object (the
 * `ColorHide` class). `onBeforeConnect` enforces an Origin allowlist before any
 * WebSocket upgrade (defense-in-depth against cross-site WS hijacking — the real
 * gate is the per-connection token auth inside the DO). `/health` is a plain probe.
 */

export { ColorHide };

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health" || url.pathname === "/") {
      return new Response("ok", { status: 200 });
    }

    const res = await routePartykitRequest(request, env, {
      onBeforeConnect(req: Request) {
        // Kill switch: refuse NEW upgrades when realtime is disabled (operators
        // flip COLOR_HIDE_REALTIME_ENABLED=0 to stop new connections fast).
        const enabled = env.COLOR_HIDE_REALTIME_ENABLED;
        if (enabled === "0" || enabled === "false") {
          return new Response("realtime disabled", { status: 503 });
        }
        // Validate the room id from the path (/parties/color-hide/<roomId>) so a
        // junk name can never spin up a Durable Object.
        const parts = new URL(req.url).pathname.split("/").filter(Boolean);
        const room = parts[2];
        if (!room || !/^[a-z0-9]{6,64}$/.test(room)) {
          return new Response("invalid room", { status: 400 });
        }
        // Origin allowlist (defense-in-depth vs cross-site WS; token auth is the
        // real gate). Supports wildcard entries for dynamic Vercel Preview URLs.
        const origin = req.headers.get("Origin");
        if (!isOriginAllowed(origin, parseOrigins(env.COLOR_HIDE_ALLOWED_ORIGINS))) {
          return new Response("forbidden origin", { status: 403 });
        }
      },
    });
    return res ?? new Response("not found", { status: 404 });
  },
};

export default worker;
