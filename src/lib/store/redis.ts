import { Redis } from "@upstash/redis";
import type { RoomState } from "../types";
import type { CasResult, RoomStore } from "./types";

const keyFor = (roomId: string) => `reversi:room:${roomId}`;

/**
 * Atomic compare-and-set executed inside Redis so the read-check-write cycle
 * cannot be interleaved by a concurrent request.
 *
 *   KEYS[1] = room key
 *   ARGV[1] = expected version (string)
 *   ARGV[2] = new serialized state (JSON string)
 *   ARGV[3] = ttl seconds (string)
 *
 * Returns: 1 ok · 0 version conflict · -1 not found · -2 corrupt record.
 */
const CAS_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then
  return -1
end
local ok, room = pcall(cjson.decode, raw)
if not ok or type(room) ~= 'table' then
  return -2
end
if tostring(room.version) ~= ARGV[1] then
  return 0
end
redis.call('SET', KEYS[1], ARGV[2], 'EX', tonumber(ARGV[3]))
return 1
`;

export function createRedisStore(url: string, token: string): RoomStore {
  // Disable automatic (de)serialization: we control JSON ourselves so that the
  // exact string stored matches what the Lua script reads with cjson.decode.
  const redis = new Redis({ url, token, automaticDeserialization: false });

  return {
    kind: "redis",

    async get(roomId) {
      const raw = await redis.get<string>(keyFor(roomId));
      if (raw == null) return null;
      return JSON.parse(raw) as RoomState;
    },

    async create(state, ttlSeconds) {
      const result = await redis.set(keyFor(state.roomId), JSON.stringify(state), {
        nx: true,
        ex: ttlSeconds,
      });
      // Upstash returns "OK" when the NX set succeeds, null when the key exists.
      return result === "OK";
    },

    async compareAndSwap(expectedVersion, nextState, ttlSeconds): Promise<CasResult> {
      const result = (await redis.eval(
        CAS_SCRIPT,
        [keyFor(nextState.roomId)],
        [String(expectedVersion), JSON.stringify(nextState), String(ttlSeconds)],
      )) as number;

      switch (result) {
        case 1:
          return "ok";
        case 0:
          return "conflict";
        case -1:
          return "not_found";
        default:
          throw new Error(`Corrupt room record for ${nextState.roomId}`);
      }
    },
  };
}
