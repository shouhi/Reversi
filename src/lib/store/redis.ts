import { Redis } from "@upstash/redis";
import type { CasResult, KvStore, VersionedRecord } from "./types";

/**
 * Atomic compare-and-set executed inside Redis so the read-check-write cycle
 * cannot be interleaved by a concurrent request.
 *
 *   KEYS[1] = record key
 *   ARGV[1] = expected version (string)
 *   ARGV[2] = new serialized record (JSON string)
 *   ARGV[3] = ttl seconds (string)
 *
 * Returns: 1 ok · 0 version conflict · -1 not found · -2 corrupt record.
 */
const CAS_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then
  return -1
end
local ok, record = pcall(cjson.decode, raw)
if not ok or type(record) ~= 'table' then
  return -2
end
if tostring(record.version) ~= ARGV[1] then
  return 0
end
redis.call('SET', KEYS[1], ARGV[2], 'EX', tonumber(ARGV[3]))
return 1
`;

/**
 * Builds a Redis-backed store for records under `keyPrefix`. For Reversi the
 * prefix is `reversi:room:`, which keeps the on-disk key and record format
 * byte-identical to the original single-game app (backward compatible).
 */
export function createRedisStore<T extends VersionedRecord>(
  url: string,
  token: string,
  keyPrefix: string,
): KvStore<T> {
  // Disable automatic (de)serialization: we control JSON ourselves so that the
  // exact string stored matches what the Lua script reads with cjson.decode.
  const redis = new Redis({ url, token, automaticDeserialization: false });
  const keyFor = (id: string) => `${keyPrefix}${id}`;

  return {
    kind: "redis",

    async get(id) {
      const raw = await redis.get<string>(keyFor(id));
      if (raw == null) return null;
      return JSON.parse(raw) as T;
    },

    async create(id, record, ttlSeconds) {
      const result = await redis.set(keyFor(id), JSON.stringify(record), {
        nx: true,
        ex: ttlSeconds,
      });
      // Upstash returns "OK" when the NX set succeeds, null when the key exists.
      return result === "OK";
    },

    async compareAndSwap(id, expectedVersion, next, ttlSeconds): Promise<CasResult> {
      const result = (await redis.eval(
        CAS_SCRIPT,
        [keyFor(id)],
        [String(expectedVersion), JSON.stringify(next), String(ttlSeconds)],
      )) as number;

      switch (result) {
        case 1:
          return "ok";
        case 0:
          return "conflict";
        case -1:
          return "not_found";
        default:
          throw new Error(`Corrupt record for ${keyFor(id)}`);
      }
    },
  };
}
