import { describe, it, expect } from "vitest";
import { clampToBoundsXZ, resolveMove, validateMove } from "./movement";
import type { Aabb } from "./geometry";
import type { Vec3 } from "../types";
import { PLAYER_RADIUS, RUN_SPEED } from "./constants";

const bounds: Aabb = { min: { x: -10, y: 0, z: -10 }, max: { x: 10, y: 3, z: 10 } };
const pillar: Aabb = { min: { x: -1, y: 0, z: -1 }, max: { x: 1, y: 3, z: 1 } };
const at = (x: number, z: number): Vec3 => ({ x, y: 0, z });

describe("clampToBoundsXZ", () => {
  it("keeps the player a radius inside the walls", () => {
    const p = clampToBoundsXZ(at(100, -100), bounds);
    expect(p.x).toBeCloseTo(10 - PLAYER_RADIUS);
    expect(p.z).toBeCloseTo(-10 + PLAYER_RADIUS);
  });
});

describe("resolveMove", () => {
  it("allows free movement in open space", () => {
    expect(resolveMove(at(0, 5), at(2, 5), [], bounds)).toEqual(at(2, 5));
  });

  it("stops you from entering an obstacle head-on", () => {
    // Moving from the left straight into the pillar: X is blocked, Z unchanged.
    const res = resolveMove(at(-3, 0), at(0, 0), [pillar], bounds);
    expect(res.x).toBeLessThan(-1 - PLAYER_RADIUS + 0.001);
    expect(res.z).toBeCloseTo(0);
  });

  it("slides along a wall when moving diagonally into it", () => {
    // From the lower-left heading up-right into the pillar: the player skims the
    // south face — X advances freely (still below the pillar) while Z is blocked.
    const from = at(-2, -3);
    const res = resolveMove(from, at(0, -1), [pillar], bounds);
    expect(res.x).toBeGreaterThan(from.x); // slid along X
    expect(res.z).toBeCloseTo(from.z); // blocked on Z (didn't enter the pillar)
    // And the result is genuinely outside the (expanded) pillar.
    const inPillarX = res.x > -1.35 && res.x < 1.35;
    const inPillarZ = res.z > -1.35 && res.z < 1.35;
    expect(inPillarX && inPillarZ).toBe(false);
  });

  it("clamps a move that would leave the arena", () => {
    const res = resolveMove(at(9, 0), at(50, 0), [], bounds);
    expect(res.x).toBeCloseTo(10 - PLAYER_RADIUS);
  });
});

describe("validateMove (server anti-cheat)", () => {
  const dt = 100; // ms

  it("accepts a legitimate small step", () => {
    const from = at(0, 0);
    const step = (RUN_SPEED * dt) / 1000; // one frame at run speed
    const claimed = at(step * 0.9, 0);
    const res = validateMove(from, claimed, dt, [], bounds);
    expect(res.x).toBeCloseTo(claimed.x, 5);
  });

  it("clamps a teleport to the reachable distance", () => {
    const from = at(0, 0);
    const res = validateMove(from, at(500, 0), dt, [], bounds);
    // Far less than the claimed 500; bounded by maxSpeed * dt * tolerance.
    expect(res.x).toBeGreaterThan(0);
    expect(res.x).toBeLessThan(2);
  });

  it("never lets a claim pass through a wall", () => {
    const from = at(-3, 0);
    // Claim a position on the far side of the pillar within one step.
    const res = validateMove(from, at(3, 0), dt, [pillar], bounds);
    expect(res.x).toBeLessThan(-1); // stopped on the near side
  });
});
