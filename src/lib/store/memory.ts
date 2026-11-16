import type { RoomState } from "../types";
import type { CasResult, RoomStore } from "./types";

interface Entry {
  /** Serialized to mirror Redis semantics and defend against accidental mutation. */
  raw: string;
  expiresAt: number;
}

/**
 * Stash the map on globalThis so it survives Next.js module re-evaluation / HMR
 * within a single server process. This store is intentionally process-local and
 * is ONLY used for tests and local dev without Redis — never in production.
 */
const globalForStore = globalThis as unknown as {
  __reversiMemory?: Map<string, Entry>;
};
const map: Map<string, Entry> =
  globalForStore.__reversiMemory ?? (globalForStore.__reversiMemory = new Map());

function live(roomId: string): Entry | null {
  const entry = map.get(roomId);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    map.delete(roomId);
    return null;
  }
  return entry;
}

export function createMemoryStore(): RoomStore {
  return {
    kind: "memory",

    async get(roomId) {
      const entry = live(roomId);
      return entry ? (JSON.parse(entry.raw) as RoomState) : null;
    },

    async create(state, ttlSeconds) {
      if (live(state.roomId)) return false;
      map.set(state.roomId, {
        raw: JSON.stringify(state),
        expiresAt: Date.now() + ttlSeconds * 1000,
      });
      return true;
    },

    async compareAndSwap(expectedVersion, nextState, ttlSeconds): Promise<CasResult> {
      const entry = live(nextState.roomId);
      if (!entry) return "not_found";
      const current = JSON.parse(entry.raw) as RoomState;
      if (current.version !== expectedVersion) return "conflict";
      map.set(nextState.roomId, {
        raw: JSON.stringify(nextState),
        expiresAt: Date.now() + ttlSeconds * 1000,
      });
      return "ok";
    },
  };
}

/** Test-only: wipe the shared map between test cases. */
export function __resetMemoryStore(): void {
  map.clear();
}
