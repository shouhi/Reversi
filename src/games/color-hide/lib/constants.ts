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
 * Short role-reveal + map-load window after the host starts a round. The seeker
 * learns they are "it"; hiders learn the map. No movement yet.
 */
export const PREPARING_MS = 5_000;
/** Hiders paint their character. Seeker waits (blind). */
export const PAINTING_MS = 60_000;
/** Hiders move and hide. Seeker is frozen and cannot see the map. */
export const HIDING_MS = 30_000;
/** Seeker hunts. Round ends early if every hider is caught. */
export const SEEKING_MS = 180_000;
/** How long the result screen lingers before the room may auto-return to lobby. */
export const RESULT_MS = 20_000;

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

/** All selectable maps, in difficulty order. Geometry lives in `maps/`. */
export const MAP_IDS = ["room", "warehouse", "toytown"] as const;
export type MapId = (typeof MAP_IDS)[number];
export const DEFAULT_MAP_ID: MapId = "room";
