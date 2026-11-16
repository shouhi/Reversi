import type { RoomState } from "../types";

export type CasResult = "ok" | "conflict" | "not_found";

/**
 * Storage abstraction for room records. Two implementations exist:
 *   - RedisStore: production, backed by Upstash with an atomic Lua compare-and-set.
 *   - MemoryStore: a single-process in-memory map used for tests / local dev only.
 *
 * All writes are optimistic-concurrency safe: `compareAndSwap` only persists the
 * new state when the stored version still matches the caller's expectation.
 */
export interface RoomStore {
  /** The implementation name, for diagnostics. */
  readonly kind: "redis" | "memory";

  /** Returns the room, or null if it does not exist / has expired. */
  get(roomId: string): Promise<RoomState | null>;

  /**
   * Creates the room only if it does not already exist (set-if-absent).
   * Returns false if a room with that id already exists.
   */
  create(state: RoomState, ttlSeconds: number): Promise<boolean>;

  /**
   * Atomically replaces the room ONLY IF its currently-stored version equals
   * `expectedVersion`. Also refreshes the TTL. Returns:
   *   - "ok"        : write succeeded
   *   - "conflict"  : stored version differed (a concurrent write won)
   *   - "not_found" : the room no longer exists
   */
  compareAndSwap(
    expectedVersion: number,
    nextState: RoomState,
    ttlSeconds: number,
  ): Promise<CasResult>;
}
