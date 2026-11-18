/**
 * COLOR HIDE — tunable constants.
 *
 * Every gameplay number the designer might want to tweak lives here so balance
 * changes never require hunting through logic. These are imported by the pure
 * engine (phases / detection / winner), the server room service, the realtime
 * server, and the client — a single source of truth shared by all tiers.
 *
 * Times are in MILLISECONDS unless a name says otherwise.
 */

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------

/** A room needs at least this many players before the host can start. */
export const MIN_PLAYERS = 2;
/** Hard cap on players in a room. The 7th join must be rejected. */
export const MAX_PLAYERS = 6;

// ---------------------------------------------------------------------------
// Phase durations (server-clock authoritative)
// ---------------------------------------------------------------------------

/**
 * Phase durations can be overridden per-deployment via env vars (handy for E2E,
 * which can't wait minutes per round). Overrides are read on the SERVER only; the
 * client always renders the duration the server sends in PublicRoomState, so
 * production behaviour is unchanged whether or not an override is set.
 */
function envMs(name: string, def: number): number {
  // Access via globalThis so this file typechecks + runs in both Node and the
  // Cloudflare Workers runtime (where `process` is simply absent).
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env;
  const raw = env?.[name];
  const n = raw != null && raw !== "" ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : def;
}

/**
 * Short role-reveal + map-load window after the host starts a round. The seeker
 * learns they are "it"; hiders learn the map. No movement yet.
 */
export const PREPARING_MS = envMs("COLOR_HIDE_PREPARING_MS", 5_000);
/**
 * LEGACY (Phase 10): the standalone "painting" phase is no longer entered by new
 * rounds — painting now happens IN the world during {@link HIDING_MS}. This value
 * is kept only so a room that was already in "painting" when this code deployed can
 * still advance safely (painting → hiding). See `phases.ts` LINEAR_NEXT.
 */
export const PAINTING_MS = envMs("COLOR_HIDE_PAINTING_MS", 60_000);
/**
 * Hiders move, choose a hiding spot, AND paint their character in-world (Phase 10).
 * The seeker is frozen and cannot see the map or the hiders. Raised from 30s to
 * 120s because this single window now absorbs the old 60s painting + 30s hiding
 * (90s) PLUS the extra time it takes to explore for a spot and sample/paint the
 * surrounding colours in 3D (slower than a dedicated flat paint screen). 120s is
 * the Phase 10 design target; tune via COLOR_HIDE_HIDING_MS.
 */
export const HIDING_MS = envMs("COLOR_HIDE_HIDING_MS", 120_000);
/** Seeker hunts. Round ends early if every hider is caught. */
export const SEEKING_MS = envMs("COLOR_HIDE_SEEKING_MS", 180_000);
/** How long the result screen lingers before the room may auto-return to lobby. */
export const RESULT_MS = envMs("COLOR_HIDE_RESULT_MS", 20_000);

/** Convenience map of each timed phase's duration, for the timer/HUD + server. */
export const PHASE_DURATION_MS = {
  preparing: PREPARING_MS,
  painting: PAINTING_MS,
  hiding: HIDING_MS,
  seeking: SEEKING_MS,
  result: RESULT_MS,
} as const;

// ---------------------------------------------------------------------------
// Movement (used by client prediction AND server validation)
// ---------------------------------------------------------------------------

/** Horizontal walk speed, world-units per second. */
export const WALK_SPEED = 3.2;
/** Horizontal run speed (Shift held), world-units per second. */
export const RUN_SPEED = 6.0;
/** Crouch multiplier applied to the active base speed. */
export const CROUCH_SPEED_MULT = 0.45;
/**
 * Seeker move-speed multiplier (balance). Hiders and the seeker otherwise share
 * speeds, which makes a fleeing hider impossible to run down (relative closing
 * speed = 0) — so catches depend entirely on cornering, and the seeker is
 * increasingly disadvantaged as the hider count grows (they must catch ALL of
 * them). A modest edge lets a skilled seeker close distance in the open while
 * hiders still escape by breaking line of sight. Applied in BOTH client
 * prediction AND server move validation so the two never disagree. See the
 * deterministic pursuit simulation in `balance.ts` / `balance.test.ts`.
 */
export const SEEKER_SPEED_MULT = 1.15;
/**
 * Max horizontal distance a player may legitimately move between two position
 * updates, as a multiple of (RUN_SPEED * dt). Anything beyond this is clamped /
 * rejected by the server as a teleport attempt. The slack absorbs jitter.
 */
export const MOVE_TOLERANCE = 1.6;
/** Character capsule radius for collision against map AABBs. */
export const PLAYER_RADIUS = 0.35;
/** Standing eye height above the character's floor position (for seeker LOS). */
export const EYE_HEIGHT = 1.5;

// ---------------------------------------------------------------------------
// Seeker detection (server-authoritative; clients never decide a catch)
// ---------------------------------------------------------------------------

/** A hider beyond this distance is never visible, regardless of line of sight. */
export const MAX_SEE_DISTANCE = 22;
/** Seeker field-of-view half-angle in radians (~100° total cone). */
export const FOV_HALF_ANGLE = (100 * Math.PI) / 180 / 2;
/**
 * Max distance for the seeker's "catch" action to connect. The hider must also
 * be currently visible (in FOV + not occluded) for the catch to count.
 */
export const CATCH_DISTANCE = 2.2;
/**
 * Target height (above floor) sampled for a hider when tracing line-of-sight.
 * Center-of-mass-ish so a hider isn't trivially hidden behind a knee-high lip.
 */
export const HIDER_TARGET_HEIGHT = 0.8;

// ---------------------------------------------------------------------------
// Paint data limits (anti-abuse: bound size, frequency, retention)
// ---------------------------------------------------------------------------

/** Square paint texture edge, in pixels. Keeps GPU + payload cost bounded. */
export const PAINT_TEXTURE_SIZE = 256;
/**
 * Max serialized paint payload accepted from a client, in bytes (post-encode).
 * A 256² texture as PNG stays well under this; the cap rejects abusive blobs.
 */
export const MAX_PAINT_BYTES = 48 * 1024;
/** Min interval between accepted paint commits from one player, in ms. */
export const PAINT_COMMIT_MIN_INTERVAL_MS = 1_000;

// ---------------------------------------------------------------------------
// Room lifecycle / networking
// ---------------------------------------------------------------------------

/** Rooms (and their records) live this long; every write refreshes the TTL. */
export const ROOM_TTL_SECONDS = 6 * 60 * 60;
/**
 * A player not seen (no heartbeat) for this long is treated as disconnected.
 * They keep their seat and can reconnect until the room expires.
 */
export const DISCONNECT_TIMEOUT_MS = 15_000;
/** Target position-broadcast rate from the realtime server, in Hz. */
export const NET_TICK_HZ = 15;

// ---------------------------------------------------------------------------
// Input send cadence (client → server) — Phase 9-E netcode optimization
// ---------------------------------------------------------------------------
/**
 * Cloudflare bills INBOUND WebSocket messages (20 received msgs = 1 request);
 * server→client frames are free. So the real cost is how often each CLIENT sends
 * input. The old client sent a fixed 18 Hz regardless of what the player did —
 * wasteful in hide-and-seek, where hiders stand still for long stretches. The
 * client now sends on a HYBRID schedule that preserves feel while cutting inbound:
 *   • immediately on a meaningful change (move start/stop, run, crouch/pose) —
 *     floored by {@link INPUT_EVENT_MIN_INTERVAL_MS} so rapid toggles can't flood;
 *   • a steady, lower rate while continuously moving or looking;
 *   • a slow heartbeat when idle (keepalive + resync after a lost packet).
 * The pure decision lives in `lib/inputSend.ts` and is unit-tested; these knobs
 * keep the cadence documented and tunable in one place. Local prediction is still
 * every frame, so these never affect the local player's own responsiveness.
 */
/** Steady send rate while moving/looking. */
export const INPUT_MOVE_SEND_HZ = 10;
/** Derived interval for the steady moving/looking rate (ms). */
export const INPUT_MOVE_SEND_INTERVAL_MS = Math.round(1000 / INPUT_MOVE_SEND_HZ);
/**
 * Minimum gap between event-driven sends (start/stop/run/crouch/pose). Caps bursts
 * at 20 Hz — as responsive as the old fixed 18 Hz — while a genuine STOP is flushed
 * within one frame of this floor (stop latency ≤ ~50 ms, better than the old 55 ms).
 */
export const INPUT_EVENT_MIN_INTERVAL_MS = 50;
/** Idle keepalive: resend the latest input at least this often (1 Hz). */
export const INPUT_HEARTBEAT_MS = 1_000;
/** Below this position delta (world units) a move is treated as jitter (no send). */
export const INPUT_POS_EPSILON = 0.03;
/** Below this yaw delta (radians, ~1.1°) a look change is treated as jitter. */
export const INPUT_YAW_EPSILON = 0.02;
/**
 * Server failsafe. If no input arrives from a player for this long, the server
 * coerces a moving animation ("walk"/"run") back to a stopped one so a LOST "stop"
 * packet can never leave a hider visually running forever. Position is already
 * frozen between inputs (the server never moves a player on its own), so this only
 * closes the cosmetic/anim gap. Set comfortably above {@link INPUT_HEARTBEAT_MS} so
 * a healthy idle client (1 Hz heartbeat) never trips it; only real packet loss does.
 */
export const INPUT_STALE_MS = 2_500;

/** All selectable maps, in difficulty order. Geometry lives in `maps/`. */
export const MAP_IDS = ["room", "warehouse", "toytown"] as const;
export type MapId = (typeof MAP_IDS)[number];
export const DEFAULT_MAP_ID: MapId = "room";
