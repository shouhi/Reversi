import { describe, it, expect } from "vitest";
import {
  advancePhase,
  damp,
  dampAngle,
  dampFactor,
  gaitParams,
  limbPose,
  shortestAngleDelta,
  shouldSnap,
  wrapAngle,
  TELEPORT_SNAP_DISTANCE,
} from "./animation";

describe("angle helpers", () => {
  it("wrapAngle keeps angles in (-π, π]", () => {
    expect(wrapAngle(0)).toBeCloseTo(0);
    expect(wrapAngle(Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(Math.PI + 0.1)).toBeCloseTo(-Math.PI + 0.1, 5);
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(-3 * Math.PI)).toBeCloseTo(Math.PI);
  });

  it("shortestAngleDelta takes the short way around the wrap", () => {
    // from just below +π to just above -π is a small positive step, not ~-2π.
    expect(shortestAngleDelta(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(0.2, 5);
    expect(shortestAngleDelta(0, Math.PI / 2)).toBeCloseTo(Math.PI / 2);
    expect(Math.abs(shortestAngleDelta(0, Math.PI))).toBeCloseTo(Math.PI);
  });
});

describe("dampFactor / damp (frame-rate independent)", () => {
  it("is 0 for non-positive dt or rate, and in [0,1) otherwise", () => {
    expect(dampFactor(10, 0)).toBe(0);
    expect(dampFactor(0, 0.016)).toBe(0);
    const f = dampFactor(10, 0.016);
    expect(f).toBeGreaterThan(0);
    expect(f).toBeLessThan(1);
  });

  it("two half-steps ≈ one full-step (exponential, dt-consistent)", () => {
    // Damping for dt is composable: applying rate for dt/2 twice ≈ once for dt.
    const rate = 8, dt = 0.1, target = 1;
    const once = damp(0, target, rate, dt);
    let twice = damp(0, target, rate, dt / 2);
    twice = damp(twice, target, rate, dt / 2);
    expect(twice).toBeCloseTo(once, 6);
  });

  it("damp never overshoots the target", () => {
    expect(damp(0, 10, 100, 1)).toBeLessThanOrEqual(10);
    expect(damp(0, 10, 100, 1)).toBeGreaterThan(9);
  });

  it("dampAngle turns the short way across the ±π seam", () => {
    const from = Math.PI - 0.05;
    const to = -Math.PI + 0.05; // ~0.1 rad away the short way
    const next = dampAngle(from, to, 20, 0.05);
    // Must move toward `to` by the SHORT path: it gets closer to `to`, and the
    // step from `from` is tiny (~0.06 rad) — NOT a ~2π unwind the long way round.
    expect(Math.abs(shortestAngleDelta(next, to))).toBeLessThan(Math.abs(shortestAngleDelta(from, to)));
    expect(Math.abs(shortestAngleDelta(from, next))).toBeLessThan(0.2);
  });
});

describe("gait", () => {
  it("advancePhase wraps into [0, 2π)", () => {
    expect(advancePhase(0, 8, 1)).toBeCloseTo(8 % (2 * Math.PI));
    const p = advancePhase(6.2, 8, 1);
    expect(p).toBeGreaterThanOrEqual(0);
    expect(p).toBeLessThan(2 * Math.PI);
  });

  it("run has a larger stride and lean than walk; idle has no stride", () => {
    expect(gaitParams("run").swing).toBeGreaterThan(gaitParams("walk").swing);
    expect(gaitParams("run").lean).toBeGreaterThan(gaitParams("walk").lean);
    expect(gaitParams("idle").swing).toBe(0);
    expect(gaitParams("idle").bob).toBeGreaterThan(0); // breathing
  });

  it("reduced motion zeroes all amplitudes", () => {
    const g = gaitParams("run", true);
    expect(g.swing).toBe(0);
    expect(g.armSwing).toBe(0);
    expect(g.lean).toBe(0);
    expect(g.bob).toBe(0);
  });

  it("legs swing in opposite phase and arms counter the legs", () => {
    const p = gaitParams("walk");
    const lp = limbPose(p, Math.PI / 2); // sin = 1
    expect(lp.legL).toBeCloseTo(p.swing);
    expect(lp.legR).toBeCloseTo(-p.swing);
    expect(Math.sign(lp.armL)).toBe(-Math.sign(lp.legL)); // arm counters same-side leg
    expect(Math.sign(lp.armR)).toBe(-Math.sign(lp.legR));
  });

  it("intensity 0 collapses to rest (no stride, no bob)", () => {
    const lp = limbPose(gaitParams("run"), 1.23, 0);
    expect(lp.legL).toBeCloseTo(0);
    expect(lp.legR).toBeCloseTo(0);
    expect(lp.lean).toBeCloseTo(0);
    expect(lp.bob).toBeCloseTo(0);
  });
});

describe("teleport snap (reconnect / correction)", () => {
  it("snaps on a big jump, interpolates on a small one", () => {
    expect(shouldSnap({ x: 0, z: 0 }, { x: 0.2, z: 0.1 })).toBe(false);
    expect(shouldSnap({ x: 0, z: 0 }, { x: TELEPORT_SNAP_DISTANCE + 1, z: 0 })).toBe(true);
  });
});
