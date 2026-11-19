/**
 * COLOR HIDE — camera-relative movement math (Phase 12 P0-3).
 *
 * Pure + unit-tested so the "pressing D/→ moves the character to the player's
 * right" guarantee can never silently invert again. The third-person camera sits
 * behind the character; the player looks down the camera's forward direction, so
 * input is interpreted relative to the camera yaw:
 *
 *   moveY = +1  → forward  (into the screen, away from the camera)
 *   moveX = +1  → the player's RIGHT (screen-right)
 *
 * Forward is `(sin(yaw), 0, -cos(yaw))` (yaw 0 faces -Z). The player's RIGHT is
 * forward rotated -90° about +Y = `(-forward.z, 0, forward.x)`, which is `(+1,0,0)`
 * at yaw 0 — i.e. +X / screen-right. (The previous code used `(forward.z, 0,
 * -forward.x)` = the player's LEFT, so D/→ moved the wrong way.)
 *
 * Returns a world XZ delta DIRECTION whose magnitude equals the input magnitude
 * (fwd/right are orthonormal), so the caller scales it by speed·dt as before. This
 * is purely client-side prediction; the server still re-validates the resulting
 * position (anti-teleport + speed cap), so the fix needs no protocol change.
 */
export function cameraRelativeMove(
  camYaw: number,
  moveX: number,
  moveY: number,
): { x: number; z: number } {
  const fx = Math.sin(camYaw);
  const fz = -Math.cos(camYaw);
  // Player's right = forward rotated -90° about +Y (screen-right).
  const rx = -fz;
  const rz = fx;
  return {
    x: fx * moveY + rx * moveX,
    z: fz * moveY + rz * moveX,
  };
}
