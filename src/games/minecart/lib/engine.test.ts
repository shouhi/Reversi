import { describe, it, expect } from "vitest";
import { createWorld, stepFixed, groundTopAt } from "./engine";
import { BASE_GROUND_Y, CART_H, FIXED_DT } from "./constants";
import type { Stage, World } from "../types";

/** A simple flat test stage with a long runway and a goal far to the right. */
function flatStage(over: Partial<Stage> = {}): Stage {
  return {
    id: "test-flat",
    name: "flat",
    difficulty: "easy",
    speed: 300,
    startX: 100,
    goalX: 5000,
    baseGroundY: BASE_GROUND_Y,
    platforms: [{ x: 0, width: 6000, y: BASE_GROUND_Y }],
    obstacles: [],
    ...over,
  };
}

function run(world: World): World {
  world.status = "running";
  return world;
}

/** Drive the world with a fixed-timestep accumulator (mirrors the game loop). */
function simulate(
  stage: Stage,
  frameDt: number,
  totalTime: number,
  jumpTimes: number[],
): World {
  const w = run(createWorld(stage));
  let acc = 0;
  let t = 0;
  const pending = [...jumpTimes];
  while (t < totalTime && w.status === "running") {
    acc += frameDt;
    // collect a jump edge if one is due this frame
    while (acc >= FIXED_DT) {
      let jump = false;
      if (pending.length && t >= pending[0]) {
        jump = true;
        pending.shift();
      }
      stepFixed(w, stage, FIXED_DT, jump);
      acc -= FIXED_DT;
      t += FIXED_DT;
      if (w.status !== "running") break;
    }
  }
  return w;
}

describe("createWorld", () => {
  it("places the cart resting on the ground, ready", () => {
    const s = flatStage();
    const w = createWorld(s);
    expect(w.status).toBe("ready");
    expect(w.onGround).toBe(true);
    expect(w.vy).toBe(0);
    expect(w.cartY + w.cartH).toBeCloseTo(BASE_GROUND_Y, 5);
  });
});

describe("groundTopAt", () => {
  it("returns the platform top over solid ground and null over a gap", () => {
    const s = flatStage({
      platforms: [
        { x: 0, width: 500, y: 400 },
        { x: 700, width: 500, y: 400 },
      ],
    });
    expect(groundTopAt(s, 250)).toBe(400);
    expect(groundTopAt(s, 600)).toBeNull(); // in the gap
    expect(groundTopAt(s, 900)).toBe(400);
  });
});

describe("gravity & jump", () => {
  it("a jump goes up, peaks, then comes back down to the ground", () => {
    const s = flatStage();
    const w = run(createWorld(s));
    // jump on the first step
    stepFixed(w, s, FIXED_DT, true);
    expect(w.vy).toBeLessThan(0); // moving up
    expect(w.onGround).toBe(false);

    let minY = w.cartY;
    let landed = false;
    for (let i = 0; i < 600; i++) {
      const ev = stepFixed(w, s, FIXED_DT, false);
      minY = Math.min(minY, w.cartY);
      if (ev.landed) {
        landed = true;
        break;
      }
    }
    expect(landed).toBe(true);
    expect(w.onGround).toBe(true);
    expect(Math.abs(w.vy)).toBeLessThan(1); // at rest after landing
    // apex rose meaningfully above the ground rest position
    const restY = BASE_GROUND_Y - CART_H;
    expect(restY - minY).toBeGreaterThan(100);
  });

  it("falls into a pit when running over a gap without jumping", () => {
    const s = flatStage({
      platforms: [
        { x: 0, width: 400, y: BASE_GROUND_Y },
        { x: 1200, width: 2000, y: BASE_GROUND_Y },
      ],
      goalX: 2500,
    });
    const w = simulate(s, 1 / 60, 10, []); // never jump
    expect(w.status).toBe("dead");
  });
});

describe("frame-rate independence", () => {
  it("produces the same result at 30fps and 144fps for identical inputs", () => {
    const s = flatStage({ goalX: 2000 });
    const a = simulate(s, 1 / 30, 8, [0.3, 1.0]);
    const b = simulate(s, 1 / 144, 8, [0.3, 1.0]);
    // Both driven by the same fixed timestep → effectively identical.
    expect(Math.abs(a.cartX - b.cartX)).toBeLessThan(2);
    expect(Math.abs(a.cartY - b.cartY)).toBeLessThan(2);
    expect(a.status).toBe(b.status);
  });
});

describe("coyote time", () => {
  it("allows a jump shortly after leaving a ledge", () => {
    // Ground ends at x=400; cart starts near the edge so it runs off quickly.
    const s = flatStage({
      startX: 360,
      platforms: [{ x: 0, width: 400, y: BASE_GROUND_Y }],
      goalX: 99999,
      baseGroundY: BASE_GROUND_Y,
    });
    const w = run(createWorld(s));
    // step until just after we leave the ledge
    let leftLedge = false;
    for (let i = 0; i < 200 && !leftLedge; i++) {
      stepFixed(w, s, FIXED_DT, false);
      if (!w.onGround) leftLedge = true;
    }
    expect(leftLedge).toBe(true);
    expect(w.coyote).toBeGreaterThan(0); // grace window still open
    const vyBefore = w.vy;
    stepFixed(w, s, FIXED_DT, true); // jump during coyote window
    expect(w.vy).toBeLessThan(vyBefore); // launched upward
    expect(w.vy).toBeLessThan(0);
  });
});

describe("jump buffer", () => {
  it("honours a jump pressed just before landing", () => {
    const s = flatStage();
    const w = run(createWorld(s));
    const groundTop = BASE_GROUND_Y;
    stepFixed(w, s, FIXED_DT, true); // initial jump
    // fall until the cart is descending AND within the buffer window of landing
    for (let i = 0; i < 600; i++) {
      stepFixed(w, s, FIXED_DT, false);
      const feet = w.cartY + w.cartH;
      if (w.vy > 0 && groundTop - feet < 36) break; // ~<0.05s from touchdown
    }
    expect(w.onGround).toBe(false);
    // press jump while still airborne, just before landing
    stepFixed(w, s, FIXED_DT, true);
    expect(w.jumpBuffer).toBeGreaterThan(0);
    // on touchdown the buffered jump should immediately re-launch us
    let relaunched = false;
    for (let i = 0; i < 20; i++) {
      const before = w.onGround;
      const ev = stepFixed(w, s, FIXED_DT, false);
      if (ev.jumped && before === false) {
        relaunched = true;
        break;
      }
    }
    expect(relaunched).toBe(true);
  });
});

describe("collision", () => {
  it("dies on hitting a ground obstacle", () => {
    const s = flatStage({
      obstacles: [
        { kind: "rock", x: 500, y: BASE_GROUND_Y - 60, width: 40, height: 60 },
      ],
      goalX: 2000,
    });
    const w = simulate(s, 1 / 60, 10, []); // don't jump → hit it
    expect(w.status).toBe("dead");
  });

  it("does not tunnel through a thin obstacle at very high speed", () => {
    const s = flatStage({
      speed: 1200,
      obstacles: [
        { kind: "spike", x: 900, y: BASE_GROUND_Y - 80, width: 16, height: 80 },
      ],
      goalX: 3000,
    });
    const w = simulate(s, 1 / 60, 10, []); // never jump
    expect(w.status).toBe("dead"); // collision detected despite the speed
  });
});

describe("goal", () => {
  it("clears when the cart center reaches the goal", () => {
    const s = flatStage({ goalX: 900 });
    const w = simulate(s, 1 / 60, 10, []);
    expect(w.status).toBe("cleared");
  });

  it("does not advance while not running", () => {
    const s = flatStage();
    const w = createWorld(s); // status "ready"
    const x0 = w.cartX;
    stepFixed(w, s, FIXED_DT, true);
    expect(w.cartX).toBe(x0);
    expect(w.status).toBe("ready");
  });
});
