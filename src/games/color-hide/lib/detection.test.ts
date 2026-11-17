import { describe, it, expect } from "vitest";
import {
  canCatch,
  evaluateVisibility,
  visibleHiderIds,
  type SeekerState,
} from "./detection";
import type { Aabb } from "./geometry";

// Seeker at the origin looking down -Z (yaw 0, level pitch).
const seeker: SeekerState = { pos: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0 };

/** A wall slab spanning the seeker's line of sight at z ≈ -2.75. */
const wall: Aabb = {
  min: { x: -2, y: 0, z: -3 },
  max: { x: 2, y: 3, z: -2.5 },
};

describe("evaluateVisibility", () => {
  it("sees a hider straight ahead, in range, with clear line of sight", () => {
    const r = evaluateVisibility(seeker, { pos: { x: 0, y: 0, z: -5 } }, []);
    expect(r.inRange).toBe(true);
    expect(r.inFov).toBe(true);
    expect(r.occluded).toBe(false);
    expect(r.visible).toBe(true);
  });

  it("CANNOT see a hider through a wall (occlusion blocks line of sight)", () => {
    const r = evaluateVisibility(seeker, { pos: { x: 0, y: 0, z: -5 } }, [wall]);
    expect(r.inRange).toBe(true);
    expect(r.inFov).toBe(true);
    expect(r.occluded).toBe(true);
    expect(r.visible).toBe(false);
  });

  it("cannot see a hider behind it (outside the view cone)", () => {
    const r = evaluateVisibility(seeker, { pos: { x: 0, y: 0, z: 5 } }, []);
    expect(r.inFov).toBe(false);
    expect(r.visible).toBe(false);
  });

  it("cannot see a hider beyond max distance", () => {
    const r = evaluateVisibility(seeker, { pos: { x: 0, y: 0, z: -30 } }, []);
    expect(r.inRange).toBe(false);
    expect(r.visible).toBe(false);
  });

  it("cannot see a hider far off to the side (outside the FOV half-angle)", () => {
    // Nearly 90° to the left of forward → outside a ~50° half-angle cone.
    const r = evaluateVisibility(seeker, { pos: { x: -5, y: 0, z: -0.2 } }, []);
    expect(r.inFov).toBe(false);
    expect(r.visible).toBe(false);
  });
});

describe("visibleHiderIds", () => {
  it("reveals only the hiders with a clear line of sight", () => {
    const hiders = [
      { id: "clear", pos: { x: 0, y: 0, z: -5 } },
      { id: "behind-wall", pos: { x: 0, y: 0, z: -5.01 } },
      { id: "behind-seeker", pos: { x: 0, y: 0, z: 6 } },
    ];
    // With the wall, the two ahead are both blocked; the one behind is out of FOV.
    expect(visibleHiderIds(seeker, hiders, [wall])).toEqual([]);
    // Without the wall, both ahead become visible; behind stays hidden.
    expect(visibleHiderIds(seeker, hiders, [])).toEqual(["clear", "behind-wall"]);
  });
});

describe("canCatch", () => {
  it("connects on a visible hider within the catch radius", () => {
    expect(canCatch(seeker, { pos: { x: 0, y: 0, z: -1.5 } }, [])).toBe(true);
  });

  it("misses a visible hider beyond the catch radius", () => {
    expect(canCatch(seeker, { pos: { x: 0, y: 0, z: -5 } }, [])).toBe(false);
  });

  it("cannot catch through a wall even at point-blank floor distance", () => {
    const closeWall: Aabb = {
      min: { x: -2, y: 0, z: -1 },
      max: { x: 2, y: 3, z: -0.5 },
    };
    expect(
      canCatch(seeker, { pos: { x: 0, y: 0, z: -1.5 } }, [closeWall]),
    ).toBe(false);
  });
});
