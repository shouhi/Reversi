import { NextResponse } from "next/server";
import { jsonResponse, getToken, resolveStore } from "@/lib/apiHelpers";
import type { ServiceError, ServiceErrorCode } from "./roomService";
import { REVERSI_ROOM_PREFIX } from "./roomService";
import type { RoomState } from "../types";

/** Header carrying the caller's raw player token on every Reversi request. */
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
  rematch_unavailable: 409,
  stale_round: 409,
  version_conflict: 409,
};

/** Builds an error response using Reversi's error-code → HTTP-status map. */
export function errorResponse(error: ServiceError): NextResponse {
  return jsonResponse(
    {
      error: { code: error.code, message: error.message },
      // Include latest state (when available) so the client can re-sync.
      publicState: error.publicState ?? null,
    },
    STATUS_BY_CODE[error.code],
  );
}

/** Reads the Reversi player token from the request. */
export function getReversiToken(req: Request): string | null {
  return getToken(req, TOKEN_HEADER);
}

/** Resolves the Reversi room store (or a ready 503 response). */
export function resolveReversiStore() {
  return resolveStore<RoomState>(REVERSI_ROOM_PREFIX);
}
