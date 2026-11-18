import { describe, it, expect } from "vitest";
import { moveSpeedFor, seekerSpeed, simulatePursuit } from "./balance";
import { RUN_SPEED, WALK_SPEED, CROUCH_SPEED_MULT, SEEKER_SPEED_MULT } from "./constants";

describe("seeker speed edge", () => {
  it("only the seeker gets the multiplier", () => {
    expect(seekerSpeed(RUN_SPEED, "seeker")).toBeCloseTo(RUN_SPEED * SEEKER_SPEED_MULT);
    expect(seekerSpeed(RUN_SPEED, "hider")).toBe(RUN_SPEED);
    expect(seekerSpeed(RUN_SPEED, null)).toBe(RUN_SPEED);
  });

  it("moveSpeedFor composes run/crouch with the role edge consistently", () => {
    expect(moveSpeedFor("hider", { running: true, crouched: false })).toBe(RUN_SPEED);
    expect(moveSpeedFor("hider", { running: false, crouched: false })).toBe(WALK_SPEED);
    expect(moveSpeedFor("hider", { running: true, crouched: true })).toBe(WALK_SPEED * CROUCH_SPEED_MULT);
    // Seeker is faster at the same action — the edge the balance fix introduces.
    expect(moveSpeedFor("seeker", { running: true, crouched: false })).toBeGreaterThan(
      moveSpeedFor("hider", { running: true, crouched: false }),
    );
  });
});

describe("pursuit model — the balance rationale (estimates, not measured win-rates)", () => {
  it("at EQUAL speed a fleeing hider is NEVER caught (gap never closes)", () => {
    const r = simulatePursuit({ seekerSpeed: RUN_SPEED, hiderSpeed: RUN_SPEED, startGap: 8 });
    expect(r.caught).toBe(false);
    expect(r.timeToCatch).toBeNull();
    expect(r.finalGap).toBeCloseTo(8); // unchanged
  });

  it("with the seeker edge, the seeker DOES run down a fleeing hider in finite time", () => {
    const r = simulatePursuit({
      seekerSpeed: RUN_SPEED * SEEKER_SPEED_MULT,
      hiderSpeed: RUN_SPEED,
      startGap: 8,
    });
    expect(r.caught).toBe(true);
    expect(r.timeToCatch).not.toBeNull();
    expect(r.timeToCatch!).toBeLessThan(180); // within a seek round
  });

  it("time-to-catch shrinks as the edge grows (monotonic)", () => {
    const base = { hiderSpeed: RUN_SPEED, startGap: 10 } as const;
    const slow = simulatePursuit({ ...base, seekerSpeed: RUN_SPEED * 1.1 });
    const fast = simulatePursuit({ ...base, seekerSpeed: RUN_SPEED * 1.3 });
    expect(slow.timeToCatch).not.toBeNull();
    expect(fast.timeToCatch).not.toBeNull();
    expect(fast.timeToCatch!).toBeLessThan(slow.timeToCatch!);
  });

  it("a slower seeker can never catch (sanity)", () => {
    const r = simulatePursuit({ seekerSpeed: RUN_SPEED * 0.9, hiderSpeed: RUN_SPEED, startGap: 5 });
    expect(r.caught).toBe(false);
  });
});
