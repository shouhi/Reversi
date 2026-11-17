export type CasResult = "ok" | "conflict" | "not_found";

/**
 * Any record this store can hold must carry a numeric `version`, which the
 * optimistic compare-and-set is keyed on. This is the one field the storage
 * layer understands; everything else is opaque JSON owned by the game.
 */
export interface VersionedRecord {
  version: number;
}

/**
 * Generic storage abstraction for versioned game records (one per "room").
 * It is deliberately game-agnostic: a game picks a key prefix (e.g.
 * `reversi:room:`) and a record type, and gets atomic create / read /
 * compare-and-set across serverless instances for free.
 *
 * Two implementations exist:
 *   - RedisStore : production, backed by Upstash with an atomic Lua CAS.
 *   - MemoryStore: a single-process in-memory map for tests / local dev only.
 *
 * All writes are optimistic-concurrency safe: `compareAndSwap` only persists the
 * new record when the stored version still matches the caller's expectation.
 */
export interface KvStore<T extends VersionedRecord> {
  /** The implementation name, for diagnostics. */
  readonly kind: "redis" | "memory";

  /** Returns the record, or null if it does not exist / has expired. */
  get(id: string): Promise<T | null>;

  /**
   * Creates the record only if the id is not already taken (set-if-absent).
   * Returns false if a record with that id already exists.
   */
  create(id: string, record: T, ttlSeconds: number): Promise<boolean>;

  /**
   * Atomically replaces the record ONLY IF its currently-stored version equals
   * `expectedVersion`. Also refreshes the TTL. Returns:
   *   - "ok"        : write succeeded
   *   - "conflict"  : stored version differed (a concurrent write won)
   *   - "not_found" : the record no longer exists
   */
  compareAndSwap(
    id: string,
    expectedVersion: number,
    next: T,
    ttlSeconds: number,
  ): Promise<CasResult>;
}
