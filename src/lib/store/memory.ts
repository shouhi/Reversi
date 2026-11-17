import type { CasResult, KvStore, VersionedRecord } from "./types";

interface Entry {
  /** Serialized to mirror Redis semantics and defend against accidental mutation. */
  raw: string;
  expiresAt: number;
}

/**
 * Stash the map on globalThis so it survives Next.js module re-evaluation / HMR
 * within a single server process. This store is intentionally process-local and
 * is ONLY used for tests and local dev without Redis — never in production.
 *
 * Keys are the fully-qualified `${keyPrefix}${id}`, so multiple games share one
 * map without colliding (exactly as they would share one Redis database).
 */
const globalForStore = globalThis as unknown as {
  __gamePlatformMemory?: Map<string, Entry>;
};
const map: Map<string, Entry> =
  globalForStore.__gamePlatformMemory ??
  (globalForStore.__gamePlatformMemory = new Map());

function live(key: string): Entry | null {
  const entry = map.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    map.delete(key);
    return null;
  }
  return entry;
}

export function createMemoryStore<T extends VersionedRecord>(
  keyPrefix = "",
): KvStore<T> {
  const keyFor = (id: string) => `${keyPrefix}${id}`;

  return {
    kind: "memory",

    async get(id) {
      const entry = live(keyFor(id));
      return entry ? (JSON.parse(entry.raw) as T) : null;
    },

    async create(id, record, ttlSeconds) {
      const key = keyFor(id);
      if (live(key)) return false;
      map.set(key, {
        raw: JSON.stringify(record),
        expiresAt: Date.now() + ttlSeconds * 1000,
      });
      return true;
    },

    async compareAndSwap(id, expectedVersion, next, ttlSeconds): Promise<CasResult> {
      const key = keyFor(id);
      const entry = live(key);
      if (!entry) return "not_found";
      const current = JSON.parse(entry.raw) as T;
      if (current.version !== expectedVersion) return "conflict";
      map.set(key, {
        raw: JSON.stringify(next),
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
