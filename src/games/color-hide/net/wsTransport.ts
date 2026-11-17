import type { InputState, RealtimeTransport } from "./transport";
import type { ClientMsg, ServerMsg } from "./protocol";

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

/** Resolves the realtime host URL (env override, else same-host dev port). */
export function resolveWsUrl(): string {
  const env = process.env.NEXT_PUBLIC_COLOR_HIDE_WS_URL;
  if (env) return env;
  if (typeof window !== "undefined") {
    return `ws://${window.location.hostname}:1999`;
  }
  return "ws://localhost:1999";
}

export function createWsTransport(opts: WsTransportOptions): RealtimeTransport {
  let ws: WebSocket | null = null;
  let closedByUser = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let messageCb: ((msg: ServerMsg) => void) | null = null;
  let statusCb: ((connected: boolean) => void) | null = null;

  const send = (msg: ClientMsg) => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };

  const connect = () => {
    ws = new WebSocket(opts.url);
    ws.onopen = () => {
      statusCb?.(true);
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
      statusCb?.(false);
      if (!closedByUser) {
        reconnectTimer = setTimeout(connect, 1200);
      }
    };
    ws.onerror = () => ws?.close();
  };

  connect();

  return {
    get connected() {
      return ws?.readyState === WebSocket.OPEN;
    },
    onMessage(cb) {
      messageCb = cb;
    },
    onStatus(cb) {
      statusCb = cb;
    },
    sendInput(input: InputState) {
      send({ type: "input", ...input });
    },
    sendCatch(targetId: string) {
      send({ type: "catch", targetId });
    },
    close() {
      closedByUser = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    },
  };
}
