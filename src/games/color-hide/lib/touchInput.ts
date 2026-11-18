/**
 * COLOR HIDE — pure touch-input math (DOM-free, unit-tested).
 *
 * Shared by the mobile virtual joystick and the look-drag handler so the geometry
 * is testable without a browser.
 */

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Collapses negative zero to +0 so outputs compare cleanly and never render as "-0px". */
function nz(v: number): number {
  return v === 0 ? 0 : v;
}

/**
 * Radial deadzone for the virtual stick (Phase 11). A thumb resting slightly off
 * the base centre — common on touch — should read as "not moving", and control
 * should ramp smoothly from 0 just past the threshold (no sudden jump). Centre
 * stays exactly (0,0) and full deflection stays magnitude 1, so the existing
 * geometry tests are unchanged.
 */
export const STICK_DEADZONE = 0.18;

/**
 * Normalized move vector for a joystick: (0,0) at the base center, magnitude
 * clamped to 1 at/after the edge, with a radial deadzone near the centre. Y is
 * inverted so screen-up = forward (+y).
 */
export function stickVector(
  clientX: number,
  clientY: number,
  rect: Rect,
  deadzone: number = STICK_DEADZONE,
): { x: number; y: number } {
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  let dx = (clientX - cx) / (rect.width / 2);
  let dy = (clientY - cy) / (rect.height / 2);
  let len = Math.hypot(dx, dy);
  if (len > 1) {
    dx /= len;
    dy /= len;
    len = 1;
  }
  if (len <= deadzone || len === 0) return { x: 0, y: 0 };
  // Rescale (deadzone..1] → (0..1] so motion starts smoothly past the threshold.
  const k = (len - deadzone) / (1 - deadzone) / len;
  return { x: nz(dx * k), y: nz(-dy * k) };
}

/** Pixel offset of the knob from center, clamped to the base radius (for display). */
export function knobOffset(move: { x: number; y: number }, radius: number): { x: number; y: number } {
  // move.y is forward-positive (screen-up); knobs move screen-down for -y.
  return { x: nz(move.x * radius), y: nz(-move.y * radius) };
}

/** Clamp a single look-drag delta so one large jump can't whip the camera. */
export function clampLookDelta(delta: number, max: number): number {
  return Math.max(-max, Math.min(max, delta));
}
