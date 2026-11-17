import { MAX_PAINT_BYTES } from "./constants";

/**
 * COLOR HIDE — paint payload validation.
 *
 * Players paint their character on a 2D offscreen canvas (the UV texture) and
 * commit it as a compressed data URL at well-defined moments (e.g. "ready"),
 * never per-frame. This module is the server's gate on that data: it rejects
 * anything that is not a small, well-formed raster image so the store can never
 * be filled with arbitrary unbounded blobs.
 *
 * Pure + dependency-free so the room service and tests can share it. It does NOT
 * decode pixels (no image lib on the server) — it validates the envelope: an
 * allowed raster MIME, base64 body, and a hard byte cap. Rate limiting (min
 * interval between commits) lives in the room service alongside `updatedAt`.
 */

/** Only these raster image types may be stored as a character's paint. */
export type AllowedMime = "image/png" | "image/webp";

const DATA_URL_RE =
  /^data:(image\/png|image\/webp);base64,([A-Za-z0-9+/]+={0,2})$/;

export type PaintValidation =
  | { ok: true; bytes: number; mime: AllowedMime }
  | { ok: false; reason: string };

/** Approximate decoded byte length of a base64 string (4 chars → 3 bytes). */
export function base64ByteLength(b64: string): number {
  const len = b64.length;
  if (len === 0) return 0;
  let padding = 0;
  if (b64.endsWith("==")) padding = 2;
  else if (b64.endsWith("=")) padding = 1;
  return Math.floor((len * 3) / 4) - padding;
}

/**
 * Validates a paint commit payload. Accepts a `data:image/png|webp;base64,...`
 * URL under {@link MAX_PAINT_BYTES} once decoded; rejects everything else.
 */
export function validatePaintPayload(payload: unknown): PaintValidation {
  if (typeof payload !== "string") {
    return { ok: false, reason: "paint must be a data-URL string" };
  }
  // Cheap length guard before the regex, so a megabyte string can't burn CPU.
  // base64 inflates ~33%, so cap the raw string at 4/3 of the byte budget + slack.
  if (payload.length > Math.ceil((MAX_PAINT_BYTES * 4) / 3) + 64) {
    return { ok: false, reason: "paint payload too large" };
  }
  const match = DATA_URL_RE.exec(payload);
  if (!match) {
    return { ok: false, reason: "paint must be a base64 PNG or WebP data URL" };
  }
  const mime = match[1] as AllowedMime;
  const bytes = base64ByteLength(match[2]);
  if (bytes <= 0) {
    return { ok: false, reason: "paint payload is empty" };
  }
  if (bytes > MAX_PAINT_BYTES) {
    return { ok: false, reason: "paint payload too large" };
  }
  return { ok: true, bytes, mime };
}

/** Convenience boolean wrapper for call sites that only need pass/fail. */
export function isValidPaintPayload(payload: unknown): payload is string {
  return validatePaintPayload(payload).ok;
}

/**
 * Maps a raycast UV coordinate (0..1, origin bottom-left) to a pixel on the
 * paint canvas (origin top-left). Texture V is flipped relative to canvas Y, so
 * the brush lands where the player actually clicked on the 3D surface. Clamped so
 * a stray UV at a seam never draws off-canvas. Pure (DOM-free) → unit-tested.
 */
export function uvToPixel(
  u: number,
  v: number,
  size: number,
): { x: number; y: number } {
  const cu = Math.min(1, Math.max(0, u));
  const cv = Math.min(1, Math.max(0, v));
  return { x: cu * size, y: (1 - cv) * size };
}
