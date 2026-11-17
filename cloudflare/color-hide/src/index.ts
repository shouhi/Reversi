import { routePartykitRequest } from "partyserver";
import { ColorHide, type Env } from "./party";

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
        const allowed = (env.COLOR_HIDE_ALLOWED_ORIGINS ?? "")
          .split(",")
          .map((s: string) => s.trim())
          .filter(Boolean);
        const origin = req.headers.get("Origin");
        // Enforce only when an allowlist is configured AND the client sent an
        // Origin (browsers do; non-browser clients still need a valid token).
        if (allowed.length > 0 && origin && !allowed.includes(origin)) {
          return new Response("forbidden origin", { status: 403 });
        }
      },
    });
    return res ?? new Response("not found", { status: 404 });
  },
};

export default worker;
