import type { RoomStore } from "./types";
import { createRedisStore } from "./redis";
import { createMemoryStore } from "./memory";

export type { RoomStore, CasResult } from "./types";

/** Thrown when no usable store is configured (and we refuse to guess one). */
export class StoreNotConfiguredError extends Error {
  constructor() {
    super(
      "Storage is not configured. Set UPSTASH_REDIS_REST_URL and " +
        "UPSTASH_REDIS_REST_TOKEN (see .env.example), or set REVERSI_MEMORY_STORE=1 " +
        "for local/test use only.",
    );
    this.name = "StoreNotConfiguredError";
  }
}

let cached: RoomStore | null = null;

/**
 * Resolves the active store. Order of precedence:
 *   1. Upstash Redis, when both REST credentials are present (the only option
 *      that works across serverless instances — i.e. production).
 *   2. In-memory, ONLY when explicitly opted in via REVERSI_MEMORY_STORE=1 or
 *      when running under the test runner (NODE_ENV=test).
 *   3. Otherwise throw — we never silently fall back to memory in production.
 */
export function getStore(): RoomStore {
  if (cached) return cached;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    cached = createRedisStore(url, token);
    return cached;
  }

  const memoryOptIn =
    process.env.REVERSI_MEMORY_STORE === "1" ||
    process.env.NODE_ENV === "test";
  if (memoryOptIn) {
    cached = createMemoryStore();
    return cached;
  }

  throw new StoreNotConfiguredError();
}

/** Test-only: drop the cached store so env changes take effect. */
export function __resetStoreCache(): void {
  cached = null;
}
