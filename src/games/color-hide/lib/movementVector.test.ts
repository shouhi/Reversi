import { describe, it, expect } from "vitest";
import { cameraRelativeMove } from "./movementVector";

/** Round tiny float noise so axis-aligned expectations compare cleanly. */
const r = (v: number) => Math.abs(v) < 1e-9 ? 0 : Number(v.toFixed(6));
const vec = (camYaw: number, mx: number, my: number) => {
  const d = cameraRelativeMove(camYaw, mx, my);
  return { x: r(d.x), z: r(d.z) };
};

const HALF_PI = Math.PI / 2;

// Input convention: moveY +1 = forward, moveX +1 = player's RIGHT (screen-right).
// World: yaw 0 faces -Z; +X is screen-right at yaw 0.
describe("cameraRelativeMove — P0-3 left/right regression guard", () => {
  describe("yaw 0 (facing -Z)", () => {
    it("forward (W/↑) → -Z", () => expect(vec(0, 0, 1)).toEqual({ x: 0, z: -1 }));
    it("back (S/↓) → +Z", () => expect(vec(0, 0, -1)).toEqual({ x: 0, z: 1 }));
    it("RIGHT (D/→) → +X (screen-right, NOT -X)", () =>
      expect(vec(0, 1, 0)).toEqual({ x: 1, z: 0 }));
    it("LEFT (A/←) → -X (screen-left)", () => expect(vec(0, -1, 0)).toEqual({ x: -1, z: 0 }));
  });

  describe("yaw 90° (facing +X)", () => {
    it("forward → +X", () => expect(vec(HALF_PI, 0, 1)).toEqual({ x: 1, z: 0 }));
    it("RIGHT → +Z (to the facing direction's right)", () =>
      expect(vec(HALF_PI, 1, 0)).toEqual({ x: 0, z: 1 }));
    it("LEFT → -Z", () => expect(vec(HALF_PI, -1, 0)).toEqual({ x: 0, z: -1 }));
  });

  describe("yaw 180° (facing +Z)", () => {
    it("forward → +Z", () => expect(vec(Math.PI, 0, 1)).toEqual({ x: 0, z: 1 }));
    it("RIGHT → -X", () => expect(vec(Math.PI, 1, 0)).toEqual({ x: -1, z: 0 }));
  });

  describe("yaw 270° (facing -X)", () => {
    it("forward → -X", () => expect(vec(3 * HALF_PI, 0, 1)).toEqual({ x: -1, z: 0 }));
    it("RIGHT → -Z", () => expect(vec(3 * HALF_PI, 1, 0)).toEqual({ x: 0, z: -1 }));
  });

  it("forward+right is diagonal with magnitude preserved", () => {
    const d = cameraRelativeMove(0, 1, 1); // right(+X) + forward(-Z)
    expect(d.x).toBeGreaterThan(0);
    expect(d.z).toBeLessThan(0);
    expect(Math.hypot(d.x, d.z)).toBeCloseTo(Math.SQRT2, 5); // magnitude = |(1,1)|
  });

  it("forward and right are an orthonormal basis at arbitrary yaw", () => {
    for (const yaw of [0, 0.3, HALF_PI, 2, Math.PI, 5]) {
      const right = cameraRelativeMove(yaw, 1, 0); // moveX only
      const forward = cameraRelativeMove(yaw, 0, 1); // moveY only
      // unit length
      expect(Math.hypot(right.x, right.z)).toBeCloseTo(1, 6);
      expect(Math.hypot(forward.x, forward.z)).toBeCloseTo(1, 6);
      // orthogonal: right · forward ≈ 0 (so left/right can never bleed into forward/back)
      expect(right.x * forward.x + right.z * forward.z).toBeCloseTo(0, 6);
    }
  });
});
