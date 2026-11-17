import type { KvStore, VersionedRecord } from "./types";
import { createRedisStore } from "./redis";
import { createMemoryStore } from "./memory";

export type { KvStore, CasResult, VersionedRecord } from "./types";

/** Thrown when no usable store is configured (and we refuse to guess one). */
export class StoreNotConfiguredError extends Error {
  constructor() {
    super(
      "Storage is not configured. Set UPSTASH_REDIS_REST_URL and " +
        "UPSTASH_REDIS_REST_TOKEN (or the Vercel Upstash integration's " +
        "KV_REST_API_URL and KV_REST_API_TOKEN — see .env.example), or set " +
        "REVERSI_MEMORY_STORE=1 for local/test use only.",
    );
    this.name = "StoreNotConfiguredError";
  }
}

// One store instance per key prefix. All games share the same Redis
// credentials / in-memory map; the prefix namespaces their records.
const cache = new Map<string, KvStore<VersionedRecord>>();

/**
 * Resolves a store for records under `keyPrefix` (e.g. `reversi:room:`).
 * Order of precedence:
 *   1. Upstash Redis, when both REST credentials are present (the only option
 *      that works across serverless instances — i.e. production).
 *   2. In-memory, ONLY when explicitly opted in via REVERSI_MEMORY_STORE=1 or
 *      when running under the test runner (NODE_ENV=test).
 *   3. Otherwise throw — we never silently fall back to memory in production.
 */
export function getStore<T extends VersionedRecord>(
  keyPrefix: string,
): KvStore<T> {
  const cached = cache.get(keyPrefix);
  if (cached) return cached as KvStore<T>;

  // Accept both naming conventions:
  //   - UPSTASH_REDIS_REST_URL / _TOKEN  (Upstash-native / manual setup)
  //   - KV_REST_API_URL / _TOKEN         (Vercel Marketplace "Upstash for Redis")
  const url =
    process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

  let store: KvStore<T>;
  if (url && token) {
    store = createRedisStore<T>(url, token, keyPrefix);
  } else if (
    process.env.REVERSI_MEMORY_STORE === "1" ||
    process.env.NODE_ENV === "test"
  ) {
    store = createMemoryStore<T>(keyPrefix);
  } else {
    throw new StoreNotConfiguredError();
  }

  cache.set(keyPrefix, store as KvStore<VersionedRecord>);
  return store;
}

/** Test-only: drop cached stores so env changes take effect. */
export function __resetStoreCache(): void {
  cache.clear();
}
