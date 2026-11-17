import { describe, it, expect } from "vitest";
import { createWorld, stepFixed, obstacleRect } from "./engine";
import { solveStage, replaySteps } from "./solver";
import { BASE_GROUND_Y, CART_H, FIXED_DT } from "./constants";
import type { Obstacle, Stage, World } from "../types";

function stage(over: Partial<Stage>): Stage {
  return {
    id: "m",
    name: "m",
    difficulty: "hard",
    speed: 300,
    startX: 120,
    goalX: 1500,
    baseGroundY: BASE_GROUND_Y,
    platforms: [{ x: 0, width: 4000, y: BASE_GROUND_Y }],
    obstacles: [],
    ...over,
  };
}

function runNoJump(s: Stage, seconds = 12): World {
  const w = createWorld(s);
  w.status = "running";
  const steps = Math.ceil(seconds / FIXED_DT);
  for (let i = 0; i < steps && w.status === "running"; i++) {
    stepFixed(w, s, FIXED_DT, false);
  }
  return w;
}

describe("obstacleRect — deterministic periodic motion", () => {
  it("oscillates on the y axis by amplitude", () => {
    const o: Obstacle = {
      kind: "bat",
      x: 100,
      y: 100,
      width: 40,
      height: 30,
      move: { axis: "y", amplitude: 50, period: 2, phase: 0 },
    };
    expect(obstacleRect(o, 0).y).toBeCloseTo(100, 3); // sin(0)=0
    expect(obstacleRect(o, 0.5).y).toBeCloseTo(150, 1); // sin(π/2)=+1
    expect(obstacleRect(o, 1.5).y).toBeCloseTo(50, 1); // sin(3π/2)=-1
  });

  it("is a pure function of time (reproducible)", () => {
    const o: Obstacle = {
      kind: "rock",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      move: { axis: "x", amplitude: 30, period: 1.3, phase: 0.7 },
    };
    expect(obstacleRect(o, 3.21)).toEqual(obstacleRect(o, 3.21));
  });
});

describe("death cause", () => {
  it("falling into a pit → 'fall'", () => {
    const s = stage({
      platforms: [
        { x: 0, width: 400, y: BASE_GROUND_Y },
        { x: 1200, width: 3000, y: BASE_GROUND_Y },
      ],
    });
    const w = runNoJump(s);
    expect(w.status).toBe("dead");
    expect(w.deathCause).toBe("fall");
  });

  it("hitting a ground rock → 'crash'", () => {
    const s = stage({
      obstacles: [{ kind: "rock", x: 520, y: BASE_GROUND_Y - 60, width: 40, height: 60 }],
    });
    const w = runNoJump(s);
    expect(w.status).toBe("dead");
    expect(w.deathCause).toBe("crash");
  });

  it("hitting an overhead hazard dipped into the path → 'overhead'", () => {
    const s = stage({
      obstacles: [
        { kind: "bat", x: 520, y: BASE_GROUND_Y - CART_H + 6, width: 48, height: 40 },
      ],
    });
    const w = runNoJump(s);
    expect(w.status).toBe("dead");
    expect(w.deathCause).toBe("overhead");
  });
});

describe("elevation (jump up onto a higher platform across a gap)", () => {
  const base = BASE_GROUND_Y;
  const s = stage({
    speed: 300,
    startX: 120,
    goalX: 1200,
    platforms: [
      { x: 0, width: 520, y: base },
      { x: 660, width: 1400, y: base - 80 }, // higher platform across a 140px gap
    ],
  });

  it("without jumping, the cart falls into the gap", () => {
    const w = runNoJump(s);
    expect(w.status).toBe("dead");
    expect(w.deathCause).toBe("fall");
  });

  it("the solver finds a jump that lands on the higher platform, and it replays", () => {
    const r = solveStage(s);
    expect(r.cleared).toBe(true);
    expect(replaySteps(s, r.jumpSteps).cleared).toBe(true);
  });

  it("does not teleport up: a too-weak path never snaps onto the high ledge", () => {
    // Prove the landing guard: run the solver's non-jump baseline — the cart must
    // physically be above the ledge (descending) to land, so no-jump => fall.
    const w = runNoJump(s);
    expect(w.cartY + w.cartH).toBeGreaterThan(base - 80); // never snapped up to the ledge
  });
});

describe("overhead beam is a stay-grounded zone", () => {
  const s = stage({
    speed: 320,
    obstacles: [
      { kind: "beam", x: 500, y: BASE_GROUND_Y - CART_H - 30, width: 160, height: 18 },
    ],
  });

  it("a grounded cart passes under the beam unharmed", () => {
    const w = createWorld(s);
    w.status = "running";
    for (let i = 0; i < 400 && w.cartX < 760; i++) stepFixed(w, s, FIXED_DT, false);
    expect(w.status).toBe("running"); // survived under the beam
  });

  it("jumping under the beam is fatal (overhead)", () => {
    const w = createWorld(s);
    w.status = "running";
    // jump right as we approach the beam
    let died = false;
    for (let i = 0; i < 400; i++) {
      const jump = w.cartX > 420 && w.cartX < 440 && w.onGround;
      const ev = stepFixed(w, s, FIXED_DT, jump);
      if (ev.died) {
        died = true;
        break;
      }
      if (w.cartX > 760) break;
    }
    expect(died).toBe(true);
    expect(w.deathCause).toBe("overhead");
  });
});
