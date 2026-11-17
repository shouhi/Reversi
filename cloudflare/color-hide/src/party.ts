import { Server, type Connection } from "partyserver";
import { ColorHideServer, type Outbound } from "../../../src/games/color-hide/net/realtime";
import { parseClientMsg } from "../../../src/games/color-hide/net/protocol";
import { MAX_PLAYERS, NET_TICK_HZ } from "../../../src/games/color-hide/lib/constants";
import {
  DEV_RT_SECRET,
  MAX_MSGS_PER_SEC,
} from "../../../src/games/color-hide/lib/realtimeShared";
import {
  authenticate as authPlayer,
  createHttpProvider,
} from "../../../src/games/color-hide/server/httpProvider";

/**
 * COLOR HIDE — Cloudflare Durable Object adapter (PartyServer).
 *
 * ONE Durable Object instance per room (`this.name` === roomId, addressed by
 * PartyServer via `idFromName`). It runs the SAME transport-agnostic
 * {@link ColorHideServer} netcode that the local WS host runs — only this glue
 * differs. The DO holds ONLY ephemeral live positions (never persisted); the
 * durable room record stays in the Vercel app + Upstash, read over HTTP via the
 * shared {@link createHttpProvider}. Non-hibernating so the 15 Hz `setInterval`
 * game loop stays alive while players are connected.
 *
 * Security enforced here: Origin allowlist (in the Worker entry), per-connection
 * token auth (hello → verified against the app), room isolation (one DO per room +
 * hello.roomId must equal this.name), a connection cap, per-connection flood
 * limiting, and a production secret requirement (fails closed on the dev default).
 */

export interface Env {
  ColorHide: DurableObjectNamespace;
  /** Absolute URL of the Vercel app (e.g. https://zen-gamebox.vercel.app). */
  COLOR_HIDE_APP_URL: string;
  /** Shared secret for server-to-server /catch; MUST be non-dev in production. */
  COLOR_HIDE_RT_SECRET: string;
  /** Comma-separated allowed Origins for WS upgrades (enforced in index.ts). */
  COLOR_HIDE_ALLOWED_ORIGINS?: string;
  /** "production" | "development" — gates the secret requirement. */
  ENVIRONMENT?: string;
}

interface RateState {
  windowStart: number;
  count: number;
}

export class ColorHide extends Server<Env> {
  // Keep WebSockets in memory so the game-loop interval survives between ticks.
  static options = { hibernate: false };

  private game?: ColorHideServer;
  private conns = new Map<string, Connection>();
  private authed = new Set<string>();
  private rate = new Map<string, RateState>();
  private tickTimer?: ReturnType<typeof setInterval>;

  /** Resolves the RT secret, failing closed on the dev default in production. */
  private secret(): string {
    const s = this.env.COLOR_HIDE_RT_SECRET;
    const isProd = this.env.ENVIRONMENT === "production";
    if (isProd && (!s || s === DEV_RT_SECRET)) {
      throw new Error(
        "COLOR_HIDE_RT_SECRET must be set to a strong non-dev value in production",
      );
    }
    return s || DEV_RT_SECRET;
  }

  private ensureGame(): ColorHideServer {
    if (!this.game) {
      const provider = createHttpProvider({
        appUrl: this.env.COLOR_HIDE_APP_URL,
        secret: this.secret(),
      });
      const out: Outbound = {
        send: (id, msg) => {
          const c = this.conns.get(id);
          if (c && c.readyState === WebSocket.OPEN) c.send(JSON.stringify(msg));
        },
        close: (id) => this.conns.get(id)?.close(),
      };
      this.game = new ColorHideServer(provider, out);
    }
    return this.game;
  }

  onConnect(connection: Connection): void {
    // Hard cap concurrent connections (auth also limits to the ≤6-seat roster).
    if (this.conns.size >= MAX_PLAYERS) {
      connection.close(1013, "room full");
      return;
    }
    try {
      this.ensureGame(); // validates prod secret; closes on misconfiguration
    } catch {
      connection.send(JSON.stringify({ type: "error", message: "server misconfigured" }));
      connection.close(1011, "server misconfigured");
      return;
    }
    this.conns.set(connection.id, connection);
    this.startTick();
  }

  async onMessage(connection: Connection, message: string | ArrayBuffer): Promise<void> {
    if (!this.rateOk(connection.id)) {
      connection.close(1008, "rate limit");
      return;
    }
    const text = typeof message === "string" ? message : new TextDecoder().decode(message);
    const msg = parseClientMsg(safeJson(text));
    if (!msg) return;
    const game = this.ensureGame();

    if (!this.authed.has(connection.id)) {
      if (msg.type !== "hello") return; // ignore anything before a valid hello
      // Room isolation: the hello's room must be THIS Durable Object's room.
      if (msg.roomId !== this.name) {
        connection.send(JSON.stringify({ type: "error", message: "room mismatch" }));
        connection.close(1008, "room mismatch");
        return;
      }
      const ok = await authPlayer(
        this.env.COLOR_HIDE_APP_URL,
        this.name,
        msg.playerId,
        msg.token,
      );
      if (!ok) {
        connection.send(JSON.stringify({ type: "error", message: "authentication failed" }));
        connection.close(1008, "auth failed");
        return;
      }
      this.authed.add(connection.id);
      await game.handleHello(connection.id, this.name, msg.playerId, Date.now());
      return;
    }

    if (msg.type === "input") game.handleInput(connection.id, msg, Date.now());
    else if (msg.type === "catch") await game.handleCatch(connection.id, msg.targetId, Date.now());
    else if (msg.type === "ping") game.handlePing(connection.id, msg.t);
  }

  onClose(connection: Connection): void {
    this.conns.delete(connection.id);
    this.authed.delete(connection.id);
    this.rate.delete(connection.id);
    this.game?.handleDisconnect(connection.id);
    if (this.conns.size === 0) this.stopTick();
  }

  onError(connection: Connection): void {
    try {
      connection.close(1011, "error");
    } catch {
      /* already closing */
    }
  }

  private startTick(): void {
    if (this.tickTimer) return;
    const game = this.ensureGame();
    this.tickTimer = setInterval(() => {
      const now = Date.now();
      void game.refreshMeta(this.name, now);
      game.tick(now);
    }, Math.round(1000 / NET_TICK_HZ));
  }

  private stopTick(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = undefined;
    }
  }

  private rateOk(id: string): boolean {
    const now = Date.now();
    const r = this.rate.get(id) ?? { windowStart: now, count: 0 };
    if (now - r.windowStart >= 1000) {
      r.windowStart = now;
      r.count = 0;
    }
    r.count += 1;
    this.rate.set(id, r);
    return r.count <= MAX_MSGS_PER_SEC;
  }
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
