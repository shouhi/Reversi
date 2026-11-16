import { randomBytes, createHash } from "node:crypto";

/**
 * Secret helpers. Everything here runs on the server only — raw tokens are
 * generated and hashed here and the raw value is handed to exactly one client.
 */

// 36-char alphabet (digits + lowercase) for human-friendly, URL-safe room ids.
const ROOM_ID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/**
 * A hard-to-guess room id used in the shareable URL. 12 chars over a 36-symbol
 * alphabet ≈ 62 bits of entropy — ample for a casual, short-lived game room.
 */
export function generateRoomId(length = 12): string {
  const bytes = randomBytes(length);
  let id = "";
  for (let i = 0; i < length; i++) {
    id += ROOM_ID_ALPHABET[bytes[i] % ROOM_ID_ALPHABET.length];
  }
  return id;
}

/**
 * A 256-bit player token. The raw value is stored in the player's own browser
 * (localStorage) and sent on each request; only its hash is persisted server-side.
 */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/** sha256 hex digest — what we persist so the raw token never leaves the owner. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Shallow sanity check so obviously malformed ids never hit the store. */
export function isValidRoomId(roomId: unknown): roomId is string {
  return (
    typeof roomId === "string" &&
    roomId.length >= 6 &&
    roomId.length <= 64 &&
    /^[a-z0-9]+$/.test(roomId)
  );
}
