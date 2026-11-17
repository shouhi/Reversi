import type {
  ConnectionStatus,
  InputState,
  RealtimeTransport,
} from "./transport";
import type { ClientMsg, ServerMsg } from "./protocol";
import { PARTY_NAME } from "../lib/realtimeShared";

/** Give up auto-reconnecting after this many consecutive failed attempts. */
const MAX_RECONNECT_ATTEMPTS = 8;
/** Exponential backoff base/cap (ms). */
const BACKOFF_BASE_MS = 1000;
const BACKOFF_CAP_MS = 8000;

/**
 * WebSocket implementation of {@link RealtimeTransport}, pointed at the local WS
 * host in development and (later) PartyKit in production. Reconnects with a short
 * backoff and re-sends `hello` on each (re)open so a dropped connection recovers.
 */

export interface WsTransportOptions {
  url: string;
  roomId: string;
  playerId: string;
  token: string | null;
}

/**
 * Resolves the full WebSocket URL for a room.
 *
 * - PRODUCTION / Cloudflare: when `NEXT_PUBLIC_COLOR_HIDE_WS_URL` is set it is a
 *   PartyServer base; we route by path to this room's Durable Object:
 *   `${base}/parties/color-hide/<roomId>`.
 * - LOCAL dev: no env → the local WS host on :1999 (roomId travels in the hello).
 *
 * Switching backends is therefore a single env var — no code change.
 */
export function resolveWsUrl(roomId: string): string {
  const env = process.env.NEXT_PUBLIC_COLOR_HIDE_WS_URL;
  if (env) {
    const base = env.replace(/\/$/, "");
    return `${base}/parties/${PARTY_NAME}/${encodeURIComponent(roomId)}`;
  }
  if (typeof window !== "undefined") {
    return `ws://${window.location.hostname}:1999`;
  }
  return "ws://localhost:1999";
}

export function createWsTransport(opts: WsTransportOptions): RealtimeTransport {
  let ws: WebSocket | null = null;
  let closedByUser = false;
  let attempts = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let messageCb: ((msg: ServerMsg) => void) | null = null;
  let statusCb: ((status: ConnectionStatus) => void) | null = null;
  let status: ConnectionStatus = "connecting";

  const setStatus = (s: ConnectionStatus) => {
    if (s === status) return;
    status = s;
    statusCb?.(s);
  };

  const send = (msg: ClientMsg) => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };

  const connect = () => {
    // Duplicate-connection guard: never open a second socket while one is
    // connecting or open.
    if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
      return;
    }
    setStatus("connecting");
    ws = new WebSocket(opts.url);
    ws.onopen = () => {
      attempts = 0;
      setStatus("connected");
      send({
        type: "hello",
        roomId: opts.roomId,
        playerId: opts.playerId,
        token: opts.token ?? undefined,
      });
    };
    ws.onmessage = (ev) => {
      try {
        messageCb?.(JSON.parse(ev.data as string) as ServerMsg);
      } catch {
        /* ignore malformed frames */
      }
    };
    ws.onclose = () => {
      ws = null;
      if (closedByUser) {
        setStatus("disconnected");
        return;
      }
      attempts += 1;
      if (attempts > MAX_RECONNECT_ATTEMPTS) {
        setStatus("failed"); // stop looping; the UI can offer a manual retry
        return;
      }
      setStatus("reconnecting");
      const delay = Math.min(BACKOFF_BASE_MS * 2 ** (attempts - 1), BACKOFF_CAP_MS);
      reconnectTimer = setTimeout(connect, delay);
    };
    ws.onerror = () => ws?.close();
  };

  connect();

  return {
    get connected() {
      return ws?.readyState === WebSocket.OPEN;
    },
    get status() {
      return status;
    },
    onMessage(cb) {
      messageCb = cb;
    },
    onStatus(cb) {
      statusCb = cb;
      cb(status); // deliver the current status immediately
    },
    sendInput(input: InputState) {
      send({ type: "input", ...input });
    },
    sendCatch(targetId: string) {
      send({ type: "catch", targetId });
    },
    reconnect() {
      // Manual retry after the automatic attempts were exhausted.
      if (status === "failed" || status === "disconnected") {
        closedByUser = false;
        attempts = 0;
        if (reconnectTimer) clearTimeout(reconnectTimer);
        connect();
      }
    },
    close() {
      closedByUser = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      setStatus("disconnected");
      ws?.close();
    },
  };
}
