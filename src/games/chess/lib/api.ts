import { NextResponse } from "next/server";
import { jsonResponse, getToken, resolveStore } from "@/lib/apiHelpers";
import type { ServiceError, ServiceErrorCode } from "./roomService";
import { CHESS_ROOM_PREFIX } from "./roomService";
import type { RoomState } from "../types";

/** Header carrying the caller's raw player token on every Chess request. */
export const TOKEN_HEADER = "x-chess-token";

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

/** Builds an error response using the error-code → HTTP-status map. */
export function errorResponse(error: ServiceError): NextResponse {
  return jsonResponse(
    {
      error: { code: error.code, message: error.message },
      publicState: error.publicState ?? null,
    },
    STATUS_BY_CODE[error.code],
  );
}

/** Reads the Chess player token from the request. */
export function getChessToken(req: Request): string | null {
  return getToken(req, TOKEN_HEADER);
}

/** Resolves the Chess room store (or a ready 503 response). */
export function resolveChessStore() {
  return resolveStore<RoomState>(CHESS_ROOM_PREFIX);
}
