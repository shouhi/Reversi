import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createWsTransport } from "./wsTransport";
import type { ConnectionStatus } from "./transport";

/**
 * P0-4: connection-status + reconnect/backoff logic, driven through a mock
 * WebSocket + fake timers. Verifies the status machine, exponential backoff,
 * giving up after a cap (no infinite loop), the duplicate-connection guard, and
 * manual reconnect — without any real network.
 */

class MockWS {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: MockWS[] = [];
  readyState = 0;
  url: string;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(url: string) {
    this.url = url;
    MockWS.instances.push(this);
  }
  send(d: string) {
    this.sent.push(d);
  }
  close() {
    this.readyState = MockWS.CLOSED;
    this.onclose?.();
  }
  _open() {
    this.readyState = MockWS.OPEN;
    this.onopen?.();
  }
}

const opts = { url: "ws://x/parties/color-hide/room1", roomId: "room1", playerId: "p1", token: "t1" };

beforeEach(() => {
  vi.useFakeTimers();
  MockWS.instances = [];
  (globalThis as { WebSocket?: unknown }).WebSocket = MockWS as unknown;
});
afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as { WebSocket?: unknown }).WebSocket;
});

describe("createWsTransport status machine", () => {
  it("connecting → connected, and sends hello on open", () => {
    const seen: ConnectionStatus[] = [];
    const t = createWsTransport(opts);
    t.onStatus((s) => seen.push(s));
    expect(seen).toEqual(["connecting"]); // delivered immediately
    MockWS.instances[0]._open();
    expect(t.status).toBe("connected");
    expect(t.connected).toBe(true);
    const hello = JSON.parse(MockWS.instances[0].sent[0]);
    expect(hello).toMatchObject({ type: "hello", roomId: "room1", playerId: "p1", token: "t1" });
  });

  it("on a network drop → reconnecting, then reconnects after backoff", () => {
    const t = createWsTransport(opts);
    MockWS.instances[0]._open();
    MockWS.instances[0].close(); // network drop (not user)
    expect(t.status).toBe("reconnecting");
    expect(MockWS.instances).toHaveLength(1); // not yet retried
    vi.advanceTimersByTime(1000); // first backoff
    expect(MockWS.instances).toHaveLength(2); // retried
    MockWS.instances[1]._open();
    expect(t.status).toBe("connected");
  });

  it("gives up as 'failed' after the max attempts (no infinite loop)", () => {
    const t = createWsTransport(opts);
    // Never opens; keep closing + advancing. Should stop retrying at the cap.
    for (let i = 0; i < 20; i++) {
      const last = MockWS.instances[MockWS.instances.length - 1];
      last.close();
      vi.advanceTimersByTime(8000); // past the backoff cap
      if (t.status === "failed") break;
    }
    expect(t.status).toBe("failed");
    const count = MockWS.instances.length;
    vi.advanceTimersByTime(60000);
    expect(MockWS.instances).toHaveLength(count); // no more sockets after failing
  });

  it("manual reconnect() revives after failed", () => {
    const t = createWsTransport(opts);
    for (let i = 0; i < 20 && t.status !== "failed"; i++) {
      MockWS.instances[MockWS.instances.length - 1].close();
      vi.advanceTimersByTime(8000);
    }
    expect(t.status).toBe("failed");
    const before = MockWS.instances.length;
    t.reconnect();
    expect(MockWS.instances.length).toBe(before + 1);
    expect(t.status).toBe("connecting");
  });

  it("close() → disconnected and never auto-reconnects", () => {
    const t = createWsTransport(opts);
    MockWS.instances[0]._open();
    t.close();
    expect(t.status).toBe("disconnected");
    vi.advanceTimersByTime(60000);
    expect(MockWS.instances).toHaveLength(1); // no reconnect after a user close
  });
});
