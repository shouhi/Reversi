/**
 * COLOR HIDE — realtime constants shared by the app, the local WS host, and the
 * Cloudflare Durable Object. Deliberately dependency-free (no next, no node) so it
 * is safe to bundle into a Worker.
 */

/** Request header carrying a player's raw token (HTTP + WS hello). */
export const TOKEN_HEADER = "x-color-hide-token";

/** Header the trusted realtime host uses to authenticate server-to-server writes. */
export const RT_SECRET_HEADER = "x-color-hide-rt-secret";

/**
 * Well-known DEV-ONLY realtime secret. A convenience default for local-first play.
 * It is REJECTED in production (both the app's /catch route and the Durable Object
 * fail closed if this value — or none — is configured in a production environment).
 */
export const DEV_RT_SECRET = "color-hide-dev-rt-secret";

/**
 * PartyServer routing namespace (kebab-case of the Durable Object class `ColorHide`).
 * The client connects to `${base}/parties/color-hide/<roomId>`.
 */
export const PARTY_NAME = "color-hide";

/** Per-connection inbound message cap (sliding 1s window) — anti-flood. */
export const MAX_MSGS_PER_SEC = 40;
