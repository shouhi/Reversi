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
 * Normalized move vector for a joystick: (0,0) at the base center, magnitude
 * clamped to 1 at/after the edge. Y is inverted so screen-up = forward (+y).
 */
export function stickVector(clientX: number, clientY: number, rect: Rect): { x: number; y: number } {
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  let dx = (clientX - cx) / (rect.width / 2);
  let dy = (clientY - cy) / (rect.height / 2);
  const len = Math.hypot(dx, dy);
  if (len > 1) {
    dx /= len;
    dy /= len;
  }
  return { x: nz(dx), y: nz(-dy) };
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
