/**
 * Headless clearability solver. It derives a jump schedule from a stage's
 * geometry (jump just before each gap edge; take off so the jump apex sits over
 * each ground obstacle; never jump under overhead hazards) and simulates the real
 * engine with it. If the solver reaches the goal, the stage provably has at least
 * one success pattern — this is what the stage tests assert for all 12 stages.
 */

import type { Stage } from "../types";
import { createWorld, stepFixed } from "./engine";
import { CART_W, FIXED_DT, GRAVITY, JUMP_VELOCITY } from "./constants";

interface Trigger {
  x: number; // cart-center x at which to jump
  fired: boolean;
}

/** Time from takeoff to the jump apex. */
const TIME_TO_APEX = JUMP_VELOCITY / GRAVITY;

export function buildJumpSchedule(stage: Stage): number[] {
  const triggers: number[] = [];
  const airtime = 2 * TIME_TO_APEX;
  const dist = stage.speed * airtime; // flat jump distance

  // Gaps between consecutive platforms → take off a touch before the near edge.
  const plats = [...stage.platforms].sort((a, b) => a.x - b.x);
  for (let i = 0; i < plats.length - 1; i++) {
    const edge = plats[i].x + plats[i].width;
    const nextStart = plats[i + 1].x;
    if (nextStart > edge + 1) {
      const width = nextStart - edge;
      const margin = Math.max(0, dist - width);
      const early = Math.min(margin * 0.45, 24);
      triggers.push(edge - early);
    }
  }

  // Ground obstacles → take off so the apex is over the obstacle's x-center.
  for (const o of stage.obstacles) {
    if (o.kind === "bat") continue; // overhead: pass underneath, never jump
    const spanCenter = o.x + o.width / 2;
    triggers.push(spanCenter - stage.speed * TIME_TO_APEX);
  }

  return triggers.sort((a, b) => a - b);
}

export interface SolveResult {
  cleared: boolean;
  timeMs: number;
  /** Cart x where the attempt ended (for diagnostics). */
  endX: number;
  reason?: "died" | "timeout";
}

export function solveStage(stage: Stage, maxSeconds = 120): SolveResult {
  const world = createWorld(stage);
  world.status = "running";
  const triggers: Trigger[] = buildJumpSchedule(stage).map((x) => ({
    x,
    fired: false,
  }));
  const maxSteps = Math.ceil(maxSeconds / FIXED_DT);

  for (let step = 0; step < maxSteps; step++) {
    const centerX = world.cartX + CART_W / 2;
    let jump = false;
    if (world.onGround || world.coyote > 0) {
      for (const t of triggers) {
        if (!t.fired && centerX >= t.x) {
          t.fired = true;
          jump = true;
          break;
        }
      }
    }
    const ev = stepFixed(world, stage, FIXED_DT, jump);
    if (ev.cleared) {
      return { cleared: true, timeMs: Math.round(world.elapsed * 1000), endX: world.cartX };
    }
    if (ev.died) {
      return {
        cleared: false,
        timeMs: Math.round(world.elapsed * 1000),
        endX: world.cartX,
        reason: "died",
      };
    }
  }
  return {
    cleared: false,
    timeMs: Math.round(world.elapsed * 1000),
    endX: world.cartX,
    reason: "timeout",
  };
}
