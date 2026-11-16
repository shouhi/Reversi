import { NextResponse } from "next/server";
import { getStore, StoreNotConfiguredError, type RoomStore } from "./store";
import type { ServiceError, ServiceErrorCode } from "./roomService";

/** Header carrying the caller's raw player token on every request. */
export const TOKEN_HEADER = "x-reversi-token";

const STATUS_BY_CODE: Record<ServiceErrorCode, number> = {
  not_found: 404,
  invalid_request: 400,
  not_a_player: 403,
  room_full: 409,
  game_not_active: 409,
  game_over: 409,
  not_your_turn: 409,
  illegal_move: 400,
  version_conflict: 409,
};

/** Shared no-cache headers — game state must never be cached by anyone. */
const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
} as const;

export function jsonResponse(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: NO_STORE_HEADERS });
}

export function errorResponse(error: ServiceError): NextResponse {
  return jsonResponse(
    {
      error: {
        code: error.code,
        message: error.message,
      },
      // Include latest state (when available) so the client can re-sync.
      publicState: error.publicState ?? null,
    },
    STATUS_BY_CODE[error.code],
  );
}

/** Reads the player token from the request header, or null if absent. */
export function getToken(req: Request): string | null {
  const value = req.headers.get(TOKEN_HEADER);
  return value && value.length > 0 ? value : null;
}

/**
 * Resolves the store, translating configuration / connectivity failures into
 * clear 503 responses. Returns either the store or a ready-to-send response.
 */
export function resolveStore():
  | { store: RoomStore; response?: never }
  | { store?: never; response: NextResponse } {
  try {
    return { store: getStore() };
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
  console.error("[reversi] storage error:", e);
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
