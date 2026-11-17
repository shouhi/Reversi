/**
 * Pure, deterministic Minecart simulation. No canvas, DOM, or React — so it can
 * be unit tested and used headlessly by the stage-clearability solver.
 *
 * The caller drives time with a fixed timestep (see FIXED_DT): accumulate real
 * frame time and call `stepFixed` once per fixed slice. Determinism + a small
 * timestep guarantee frame-rate-independent physics and no high-speed tunneling.
 */

import type { Obstacle, Stage, StepEvents, World } from "../types";
import {
  BASE_GROUND_Y,
  CART_H,
  CART_W,
  COYOTE_TIME,
  FALL_KILL_BELOW,
  GRAVITY,
  JUMP_BUFFER,
  JUMP_VELOCITY,
} from "./constants";

const WHEEL_RADIUS = CART_H * 0.32;

/** The top (surface) y of the platform under world-x `x`, or null over a gap. */
export function groundTopAt(stage: Stage, x: number): number | null {
  let top: number | null = null;
  for (const p of stage.platforms) {
    if (x >= p.x && x <= p.x + p.width) {
      if (top === null || p.y < top) top = p.y;
    }
  }
  return top;
}

function aabbOverlap(
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  b: Obstacle,
): boolean {
  return (
    ax < b.x + b.width &&
    ax + aw > b.x &&
    ay < b.y + b.height &&
    ay + ah > b.y
  );
}

function hitsObstacle(stage: Stage, w: World): boolean {
  for (const o of stage.obstacles) {
    if (aabbOverlap(w.cartX, w.cartY, w.cartW, w.cartH, o)) return true;
  }
  return false;
}

/** Fresh simulation state for a stage, in the "ready" (pre-start) status. */
export function createWorld(stage: Stage): World {
  const groundTop = groundTopAt(stage, stage.startX + CART_W / 2) ?? BASE_GROUND_Y;
  return {
    stageId: stage.id,
    status: "ready",
    cartX: stage.startX,
    cartY: groundTop - CART_H,
    cartW: CART_W,
    cartH: CART_H,
    vy: 0,
    onGround: true,
    elapsed: 0,
    coyote: COYOTE_TIME,
    jumpBuffer: 0,
    wheelAngle: 0,
  };
}

function doJump(w: World): void {
  w.vy = -JUMP_VELOCITY;
  w.onGround = false;
  w.coyote = 0;
}

const noEvents = (): StepEvents => ({
  jumped: false,
  landed: false,
  died: false,
  cleared: false,
});

/**
 * Advance the world by one fixed timestep. `jumpPressed` is the jump edge for
 * THIS step (the driver passes true on at most one fixed step per real press).
 * Mutates `world` and returns the discrete events that occurred.
 */
export function stepFixed(
  world: World,
  stage: Stage,
  dt: number,
  jumpPressed: boolean,
): StepEvents {
  const events = noEvents();
  if (world.status !== "running") return events;

  // --- jump input (coyote + buffer for fairness) ---
  if (jumpPressed) {
    if (world.onGround || world.coyote > 0) {
      doJump(world);
      events.jumped = true;
    } else {
      world.jumpBuffer = JUMP_BUFFER;
    }
  }

  // --- horizontal advance ---
  world.cartX += stage.speed * dt;
  world.elapsed += dt;
  world.wheelAngle += (stage.speed * dt) / WHEEL_RADIUS;

  // --- vertical integration (frame-rate independent) ---
  world.vy += GRAVITY * dt;
  world.cartY += world.vy * dt;

  // --- ground resolution ---
  const centerX = world.cartX + world.cartW / 2;
  const groundTop = groundTopAt(stage, centerX);
  const feet = world.cartY + world.cartH;
  if (groundTop !== null && world.vy >= 0 && feet >= groundTop) {
    const wasAirborne = !world.onGround;
    world.cartY = groundTop - world.cartH;
    world.vy = 0;
    world.onGround = true;
    world.coyote = COYOTE_TIME;
    if (wasAirborne) events.landed = true;
    // honour a buffered jump the instant we touch down
    if (world.jumpBuffer > 0) {
      doJump(world);
      world.jumpBuffer = 0;
      events.jumped = true;
    }
  } else {
    world.onGround = false;
    world.coyote = Math.max(0, world.coyote - dt);
    world.jumpBuffer = Math.max(0, world.jumpBuffer - dt);
  }

  // --- death: fell into a pit ---
  if (world.cartY + world.cartH > stage.baseGroundY + FALL_KILL_BELOW) {
    world.status = "dead";
    events.died = true;
    return events;
  }

  // --- death: hit a hazard ---
  if (hitsObstacle(stage, world)) {
    world.status = "dead";
    events.died = true;
    return events;
  }

  // --- clear ---
  if (centerX >= stage.goalX) {
    world.status = "cleared";
    events.cleared = true;
    return events;
  }

  return events;
}
