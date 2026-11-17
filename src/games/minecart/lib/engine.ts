/**
 * Pure, deterministic Minecart simulation. No canvas/DOM/React — unit tested and
 * used headlessly by the clearability solver. Drive it with a fixed timestep
 * (FIXED_DT): a small step keeps physics frame-rate independent and tunnel-free.
 *
 * Supports flat platforms at varying heights (elevation via gaps), ground
 * hazards (jump over), overhead hazards / beams (stay low — jumping into them is
 * fatal), and deterministic periodic moving obstacles (position is a pure
 * function of elapsed time, so runs are fully reproducible).
 */

import type {
  DeathCause,
  Obstacle,
  ObstacleKind,
  Stage,
  StepEvents,
  World,
} from "../types";
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

/** The obstacle's current AABB at time `elapsed`, applying any periodic motion. */
export function obstacleRect(
  o: Obstacle,
  elapsed: number,
): { x: number; y: number; w: number; h: number } {
  let x = o.x;
  let y = o.y;
  if (o.move) {
    const d =
      o.move.amplitude *
      Math.sin((2 * Math.PI * elapsed) / o.move.period + (o.move.phase ?? 0));
    if (o.move.axis === "x") x += d;
    else y += d;
  }
  return { x, y, w: o.width, h: o.height };
}

function overlaps(
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  bx: number,
  by: number,
  bw: number,
  bh: number,
): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

const CAUSE_BY_KIND: Record<ObstacleKind, DeathCause> = {
  rock: "crash",
  crate: "crash",
  spike: "crash",
  bat: "overhead",
  beam: "overhead",
};

function obstacleHitCause(stage: Stage, w: World): DeathCause | null {
  for (const o of stage.obstacles) {
    const r = obstacleRect(o, w.elapsed);
    if (overlaps(w.cartX, w.cartY, w.cartW, w.cartH, r.x, r.y, r.w, r.h)) {
      return CAUSE_BY_KIND[o.kind];
    }
  }
  return null;
}

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
    deathCause: null,
  };
}

/** Cheap structural clone (all primitive fields) — used by the solver. */
export function cloneWorld(w: World): World {
  return { ...w };
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
 * THIS step. Mutates `world`; returns the discrete events that occurred.
 */
export function stepFixed(
  world: World,
  stage: Stage,
  dt: number,
  jumpPressed: boolean,
): StepEvents {
  const events = noEvents();
  if (world.status !== "running") return events;

  if (jumpPressed) {
    if (world.onGround || world.coyote > 0) {
      doJump(world);
      events.jumped = true;
    } else {
      world.jumpBuffer = JUMP_BUFFER;
    }
  }

  // horizontal advance (constant; independent of jumps)
  world.cartX += stage.speed * dt;
  world.elapsed += dt;
  world.wheelAngle += (stage.speed * dt) / WHEEL_RADIUS;

  // vertical integration
  const feetPrev = world.cartY + world.cartH;
  world.vy += GRAVITY * dt;
  world.cartY += world.vy * dt;

  // ground resolution — only land when crossing a surface from above (prevents
  // teleporting up into the side of a higher platform).
  const centerX = world.cartX + world.cartW / 2;
  const groundTop = groundTopAt(stage, centerX);
  const feet = world.cartY + world.cartH;
  if (
    groundTop !== null &&
    world.vy >= 0 &&
    feet >= groundTop &&
    feetPrev <= groundTop + 1
  ) {
    const wasAirborne = !world.onGround;
    world.cartY = groundTop - world.cartH;
    world.vy = 0;
    world.onGround = true;
    world.coyote = COYOTE_TIME;
    if (wasAirborne) events.landed = true;
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

  // death: fell into a pit
  if (world.cartY + world.cartH > stage.baseGroundY + FALL_KILL_BELOW) {
    world.status = "dead";
    world.deathCause = "fall";
    events.died = true;
    return events;
  }

  // death: hit a hazard (uses each obstacle's current moved position)
  const cause = obstacleHitCause(stage, world);
  if (cause) {
    world.status = "dead";
    world.deathCause = cause;
    events.died = true;
    return events;
  }

  // clear
  if (centerX >= stage.goalX) {
    world.status = "cleared";
    events.cleared = true;
    return events;
  }

  return events;
}
