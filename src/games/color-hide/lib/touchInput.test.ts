import { describe, it, expect } from "vitest";
import { stickVector, knobOffset, clampLookDelta } from "./touchInput";

const rect = { left: 0, top: 0, width: 100, height: 100 }; // center (50,50), radius 50

describe("stickVector", () => {
  it("is zero at the center", () => {
    expect(stickVector(50, 50, rect)).toEqual({ x: 0, y: 0 });
  });
  it("is forward (+y) when pushed up, back (-y) when pushed down", () => {
    expect(stickVector(50, 0, rect)).toEqual({ x: 0, y: 1 }); // top edge → forward
    expect(stickVector(50, 100, rect)).toEqual({ x: 0, y: -1 }); // bottom → back
  });
  it("is +x to the right, -x to the left", () => {
    expect(stickVector(100, 50, rect)).toEqual({ x: 1, y: 0 });
    expect(stickVector(0, 50, rect)).toEqual({ x: -1, y: 0 });
  });
  it("clamps magnitude to 1 beyond the edge", () => {
    const v = stickVector(1000, 1000, rect); // far past the corner
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(1);
  });
});

describe("knobOffset", () => {
  it("maps forward (+y) to screen-up (-pixel y) within the radius", () => {
    expect(knobOffset({ x: 0, y: 1 }, 40)).toEqual({ x: 0, y: -40 });
    expect(knobOffset({ x: 1, y: 0 }, 40)).toEqual({ x: 40, y: 0 });
  });
});

describe("clampLookDelta", () => {
  it("passes small deltas through and clamps large ones", () => {
    expect(clampLookDelta(20, 60)).toBe(20);
    expect(clampLookDelta(200, 60)).toBe(60);
    expect(clampLookDelta(-200, 60)).toBe(-60);
  });
});
