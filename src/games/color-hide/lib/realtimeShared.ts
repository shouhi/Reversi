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

/** Parses a comma-separated Origin allowlist env value into trimmed entries. */
export function parseOrigins(raw: string | undefined | null): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Whether a WebSocket `Origin` is permitted, given an allowlist.
 *
 * - empty allowlist → allow (development convenience);
 * - no Origin header (non-browser client) → allow (token auth is the real gate);
 * - otherwise: exact match, or a glob entry containing `*` — e.g.
 *   `https://*.vercel.app` or `https://my-app-*-team.vercel.app` to admit the
 *   DYNAMIC Vercel Preview URLs used for limited-release testing. Allowlist
 *   entries are operator-controlled config (not user input), so the glob→RegExp
 *   is safe here.
 */
export function isOriginAllowed(
  origin: string | null | undefined,
  allowlist: string[],
): boolean {
  if (allowlist.length === 0) return true;
  if (!origin) return true;
  for (const entry of allowlist) {
    if (entry === origin) return true;
    if (entry.includes("*")) {
      const pattern: string =
        "^" + entry.split("*").map(escapeRegExp).join(".*") + "$";
      const re: RegExp = new RegExp(pattern);
      if (re.test(origin)) return true;
    }
  }
  return false;
}
