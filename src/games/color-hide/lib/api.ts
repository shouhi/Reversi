import { NextResponse } from "next/server";
import { jsonResponse, getToken, resolveStore } from "@/lib/apiHelpers";
import type { ServiceError, ServiceErrorCode } from "./roomService";
import { COLOR_HIDE_ROOM_PREFIX } from "./roomService";
import { COLOR_HIDE_PAINT_PREFIX, type PaintRecord } from "./paintService";
import type { RoomState } from "../types";

/** Header carrying the caller's raw player token on every COLOR HIDE request. */
export const TOKEN_HEADER = "x-color-hide-token";

/**
 * Header the trusted realtime host uses to authenticate server-to-server writes
 * (currently only "a hider was caught"). The secret comes from the environment;
 * a well-known dev default lets local-first play work with zero config, and it is
 * NEVER a real credential. Production would set COLOR_HIDE_RT_SECRET.
 */
export const RT_SECRET_HEADER = "x-color-hide-rt-secret";
export const DEV_RT_SECRET = "color-hide-dev-rt-secret";

export function realtimeSecret(): string {
  return process.env.COLOR_HIDE_RT_SECRET || DEV_RT_SECRET;
}

/** True if the request carries the correct realtime-host secret. */
export function isTrustedRealtime(req: Request): boolean {
  return req.headers.get(RT_SECRET_HEADER) === realtimeSecret();
}

const STATUS_BY_CODE: Record<ServiceErrorCode, number> = {
  not_found: 404,
  invalid_request: 400,
  not_a_player: 403,
  not_host: 403,
  room_full: 409,
  game_in_progress: 409,
  not_enough_players: 409,
  not_all_ready: 409,
  bad_phase: 409,
  version_conflict: 409,
};

/** Builds an error response using COLOR HIDE's error-code → HTTP-status map. */
export function errorResponse(error: ServiceError): NextResponse {
  return jsonResponse(
    {
      error: { code: error.code, message: error.message },
      publicState: error.publicState ?? null,
    },
    STATUS_BY_CODE[error.code],
  );
}

/** Reads the COLOR HIDE player token from the request (or null). */
export function getColorHideToken(req: Request): string | null {
  return getToken(req, TOKEN_HEADER);
}

/** Resolves the COLOR HIDE room store (or a ready 503 response). */
export function resolveColorHideStore() {
  return resolveStore<RoomState>(COLOR_HIDE_ROOM_PREFIX);
}

/** Resolves the COLOR HIDE paint store (or a ready 503 response). */
export function resolveColorHidePaintStore() {
  return resolveStore<PaintRecord>(COLOR_HIDE_PAINT_PREFIX);
}
