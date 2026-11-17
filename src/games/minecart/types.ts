/**
 * Shared types for the Minecart action game. Everything here is framework- and
 * canvas-agnostic so the simulation can be unit tested in isolation.
 *
 * Coordinate system: world units (pixels at the design resolution), x increases
 * to the right, **y increases downward**. The cart auto-runs in +x; a camera
 * follows it. Physics run in world units and never depend on the display size.
 */

export type Difficulty = "easy" | "normal" | "hard";

export type GameStatus =
  | "ready" // stage loaded, waiting for the player to start
  | "running"
  | "paused"
  | "dead"
  | "cleared";

/** A solid, flat ground segment (a stretch of rail). Top surface sits at `y`. */
export interface Platform {
  x: number;
  width: number;
  y: number;
}

export type ObstacleKind =
  /** Ground hazards sitting on the rail — jump OVER them. */
  | "rock"
  | "crate"
  | "spike"
  /** Overhead hazard floating above solid ground — pass UNDER it (don't jump). */
  | "bat";

/** An axis-aligned hazard box. (x,y) is the top-left corner. */
export interface Obstacle {
  kind: ObstacleKind;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Stage {
  id: string;
  name: string;
  difficulty: Difficulty;
  /** Horizontal run speed in world px/s. */
  speed: number;
  /** Cart's starting left-edge x. */
  startX: number;
  /** Clearing the stage once the cart's center reaches this x. */
  goalX: number;
  /** Base ground top (the default rail height); falling well below this = death. */
  baseGroundY: number;
  platforms: Platform[];
  obstacles: Obstacle[];
}

/** The mutable simulation state for one play attempt. */
export interface World {
  stageId: string;
  status: GameStatus;
  /** Cart axis-aligned box: (x,y) top-left, in world units. */
  cartX: number;
  cartY: number;
  cartW: number;
  cartH: number;
  /** Vertical velocity (px/s), positive = downward. */
  vy: number;
  onGround: boolean;
  /** Seconds since the cart started running (the clear time). */
  elapsed: number;
  /** Remaining coyote-time / jump-buffer windows (seconds). */
  coyote: number;
  jumpBuffer: number;
  /** Accumulated wheel rotation (radians) for rendering. */
  wheelAngle: number;
}

/** Discrete events produced by a single fixed simulation step. */
export interface StepEvents {
  jumped: boolean;
  landed: boolean;
  died: boolean;
  cleared: boolean;
}

/** Persisted progress (localStorage). */
export interface MinecartProgress {
  version: number;
  /** Number of unlocked stages (by linear order); stage[i] unlocked if i < unlocked. */
  unlocked: number;
  /** Stage ids the player has cleared. */
  cleared: string[];
  /** Best clear time per stage id, in milliseconds. */
  bestMs: Record<string, number>;
  /** Sound on/off. */
  sound: boolean;
}
