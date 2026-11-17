/**
 * Physics & world constants, in world units (design-resolution pixels), with
 * y increasing downward. These are tuned for a snappy, fair auto-runner and are
 * the single source of truth shared by the engine, the stage designer, and the
 * clearability solver — so levels are provably fair by construction.
 */

/** Design (logical) resolution. The canvas scales to fit; physics never change. */
export const VIEW_W = 960;
export const VIEW_H = 540;

/** Fixed simulation timestep (seconds). Small enough that fast carts never tunnel. */
export const FIXED_DT = 1 / 120;
/** Never advance more than this of real time per frame (avoids spiral-of-death). */
export const MAX_FRAME_DT = 1 / 15;

/** Downward gravity (px/s²). */
export const GRAVITY = 2600;
/** Upward launch velocity of a jump (px/s). */
export const JUMP_VELOCITY = 900;

/** Cart box size (world units). */
export const CART_W = 66;
export const CART_H = 46;

/** The default rail height (cart bottom rests here on the base ground). */
export const BASE_GROUND_Y = 410;
/** Falling this far below the base ground counts as falling into a pit (death). */
export const FALL_KILL_BELOW = 220;

/** Fairness helpers: a short grace window after leaving an edge, and a buffered
 * jump press that "sticks" briefly before landing. */
export const COYOTE_TIME = 0.09;
export const JUMP_BUFFER = 0.12;

/** The cart sits this fraction from the left edge of the viewport. */
export const CAMERA_LEAD = 0.3;

/**
 * Derived: time aloft on a flat jump (takeoff to landing at the same height),
 * and the horizontal distance covered at a given run speed. Used to size gaps.
 */
export const flatAirtime = (): number => (2 * JUMP_VELOCITY) / GRAVITY;
export const flatJumpDistance = (speed: number): number =>
  speed * flatAirtime();
/** Peak jump height above takeoff. */
export const jumpApex = (): number => (JUMP_VELOCITY * JUMP_VELOCITY) / (2 * GRAVITY);
