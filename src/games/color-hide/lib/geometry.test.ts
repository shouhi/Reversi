import { describe, it, expect } from "vitest";
import {
  distanceXZ,
  expandAabb,
  forwardFromAngles,
  normalize,
  pointInAabb,
  segmentBlocked,
  segmentIntersectsAabb,
  type Aabb,
} from "./geometry";

const box: Aabb = {
  min: { x: -1, y: 0, z: -1 },
  max: { x: 1, y: 2, z: 1 },
};

describe("segmentIntersectsAabb", () => {
  it("detects a segment passing straight through the box", () => {
    expect(
      segmentIntersectsAabb({ x: -5, y: 1, z: 0 }, { x: 5, y: 1, z: 0 }, box),
    ).toBe(true);
  });

  it("returns false for a segment that misses above the box", () => {
    expect(
      segmentIntersectsAabb({ x: -5, y: 5, z: 0 }, { x: 5, y: 5, z: 0 }, box),
    ).toBe(false);
  });

  it("returns false when both endpoints are on the same side (no crossing)", () => {
    expect(
      segmentIntersectsAabb({ x: 3, y: 1, z: 0 }, { x: 5, y: 1, z: 0 }, box),
    ).toBe(false);
  });

  it("detects a segment that starts inside the box", () => {
    expect(
      segmentIntersectsAabb({ x: 0, y: 1, z: 0 }, { x: 10, y: 1, z: 0 }, box),
    ).toBe(true);
  });

  it("segmentBlocked is true if ANY box blocks", () => {
    const far: Aabb = { min: { x: 100, y: 0, z: 100 }, max: { x: 101, y: 1, z: 101 } };
    expect(
      segmentBlocked({ x: -5, y: 1, z: 0 }, { x: 5, y: 1, z: 0 }, [far, box]),
    ).toBe(true);
    expect(
      segmentBlocked({ x: -5, y: 5, z: 0 }, { x: 5, y: 5, z: 0 }, [far]),
    ).toBe(false);
  });
});

describe("vector helpers", () => {
  it("normalize returns unit length and zero for degenerate input", () => {
    const n = normalize({ x: 3, y: 0, z: 4 });
    expect(Math.hypot(n.x, n.y, n.z)).toBeCloseTo(1);
    expect(normalize({ x: 0, y: 0, z: 0 })).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("forwardFromAngles points down -Z at yaw 0 and +X at yaw 90°", () => {
    const f0 = forwardFromAngles(0, 0);
    expect(f0.x).toBeCloseTo(0);
    expect(f0.z).toBeCloseTo(-1);
    const f90 = forwardFromAngles(Math.PI / 2, 0);
    expect(f90.x).toBeCloseTo(1);
    expect(f90.z).toBeCloseTo(0);
  });

  it("distanceXZ ignores the Y axis", () => {
    expect(distanceXZ({ x: 0, y: 0, z: 0 }, { x: 3, y: 100, z: 4 })).toBeCloseTo(5);
  });

  it("pointInAabb / expandAabb", () => {
    expect(pointInAabb({ x: 0, y: 1, z: 0 }, box)).toBe(true);
    expect(pointInAabb({ x: 5, y: 1, z: 0 }, box)).toBe(false);
    const grown = expandAabb(box, 1);
    expect(pointInAabb({ x: 1.5, y: 1, z: 0 }, grown)).toBe(true);
  });
});
