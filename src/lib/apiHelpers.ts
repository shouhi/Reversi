import { NextResponse } from "next/server";
import {
  getStore,
  StoreNotConfiguredError,
  type KvStore,
  type VersionedRecord,
} from "./store";

/**
 * Framework-level HTTP helpers shared by every game's route handlers. Anything
 * game-specific (error-code → status maps, the player-token header name) lives
 * in that game's own module, e.g. `src/games/reversi/lib/api.ts`.
 */

/** Shared no-cache headers — live game state must never be cached by anyone. */
export const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
} as const;

export function jsonResponse(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: NO_STORE_HEADERS });
}

/** Reads a player token from the given request header, or null if absent. */
export function getToken(req: Request, headerName: string): string | null {
  const value = req.headers.get(headerName);
  return value && value.length > 0 ? value : null;
}

/**
 * Resolves a store for `keyPrefix`, translating a missing configuration into a
 * clear 503 response. Returns either the store or a ready-to-send response.
 */
export function resolveStore<T extends VersionedRecord>(
  keyPrefix: string,
):
  | { store: KvStore<T>; response?: never }
  | { store?: never; response: NextResponse } {
  try {
    return { store: getStore<T>(keyPrefix) };
  } catch (e) {
    if (e instanceof StoreNotConfiguredError) {
      return {
        response: jsonResponse(
          {
            error: {
              code: "store_not_configured",
              message: e.message,
            },
          },
          503,
        ),
      };
    }
    throw e;
  }
}

/** Maps an unexpected storage/runtime error to a safe 503 (never leaks secrets). */
export function storageUnavailable(e: unknown): NextResponse {
  // Log server-side for debugging; the message is generic and secret-free.
  console.error("[game-platform] storage error:", e);
  return jsonResponse(
    {
      error: {
        code: "store_unavailable",
        message:
          "Could not reach the game storage. Check your connection and try again.",
      },
    },
    503,
  );
}
