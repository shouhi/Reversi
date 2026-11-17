import { NextResponse } from "next/server";
import { jsonResponse, getToken, resolveStore } from "@/lib/apiHelpers";
import type { ServiceError, ServiceErrorCode } from "./roomService";
import { COLOR_HIDE_ROOM_PREFIX } from "./roomService";
import { COLOR_HIDE_PAINT_PREFIX, type PaintRecord } from "./paintService";
import {
  DEV_RT_SECRET,
  RT_SECRET_HEADER,
  TOKEN_HEADER,
} from "./realtimeShared";
import type { RoomState } from "../types";

export { TOKEN_HEADER, RT_SECRET_HEADER, DEV_RT_SECRET };

/**
 * Resolves the realtime-host shared secret and whether it is misconfigured.
 *
 * FAIL CLOSED in production: on a Vercel production deployment (`VERCEL_ENV ===
 * "production"`), the secret MUST be set explicitly and MUST NOT be the well-known
 * dev default — otherwise `misconfigured` is true and `/catch` rejects everything.
 * Locally and in CI (`VERCEL_ENV` unset) the dev default is accepted so local-first
 * play works with zero config. The secret value is never logged.
 */
export function realtimeSecretConfig(): { secret: string; misconfigured: boolean } {
  const explicit = process.env.COLOR_HIDE_RT_SECRET;
  const isVercelProd = process.env.VERCEL_ENV === "production";
  if (isVercelProd && (!explicit || explicit === DEV_RT_SECRET)) {
    return { secret: "", misconfigured: true };
  }
  return { secret: explicit || DEV_RT_SECRET, misconfigured: false };
}

/** True if the request carries the correct realtime-host secret (fails closed in prod). */
export function isTrustedRealtime(req: Request): boolean {
  const { secret, misconfigured } = realtimeSecretConfig();
  if (misconfigured) {
    // Never log the secret itself — only that it is unset/dev in production.
    console.error(
      "[color-hide] COLOR_HIDE_RT_SECRET is not configured for production; rejecting realtime catch requests.",
    );
    return false;
  }
  const provided = req.headers.get(RT_SECRET_HEADER);
  return typeof provided === "string" && provided.length > 0 && provided === secret;
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
