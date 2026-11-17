/**
 * Shared types for the Minecart action game. Framework/canvas-agnostic so the
 * simulation can be unit tested and driven headlessly by the clearability solver.
 *
 * Coordinates: world units (design-resolution px), x right, **y down**. The cart
 * auto-runs in +x at a constant speed; a camera follows it. Physics run in world
 * units and never depend on display size.
 */

export type Difficulty = "easy" | "normal" | "hard" | "expert";

export type GameStatus = "ready" | "running" | "paused" | "dead" | "cleared";

/** A solid, flat ground segment (a stretch of rail). Top surface sits at `y`. */
export interface Platform {
  x: number;
  width: number;
  y: number;
}

export type ObstacleKind =
  /** Ground hazards on the rail — jump OVER them. */
  | "rock"
  | "crate"
  | "spike"
  /** Overhead floating hazard — do NOT jump into it (stay low / pass under). */
  | "bat"
  /** Wide overhead beam — a "stay grounded" zone; jumping under it is fatal. */
  | "beam";

/** Deterministic periodic motion for an obstacle (predictable, replayable). */
export interface MoveSpec {
  axis: "x" | "y";
  /** Peak displacement from the base position (world px). */
  amplitude: number;
  /** Seconds for one full oscillation. */
  period: number;
  /** Phase offset in radians (default 0) — fixes the starting position. */
  phase?: number;
}

/** An axis-aligned hazard box. (x,y) is the top-left corner (base position). */
export interface Obstacle {
  kind: ObstacleKind;
  x: number;
  y: number;
  width: number;
  height: number;
  /** When present, the obstacle oscillates deterministically from (x,y). */
  move?: MoveSpec;
}

export interface Stage {
  id: string;
  name: string;
  difficulty: Difficulty;
  /** Horizontal run speed in world px/s. */
  speed: number;
  startX: number;
  /** Clearing the stage once the cart's center reaches this x. */
  goalX: number;
  /** Base ground top; falling well below this = death. */
  baseGroundY: number;
  platforms: Platform[];
  obstacles: Obstacle[];
}

export type DeathCause = "fall" | "crash" | "overhead";

/** The mutable simulation state for one play attempt. */
export interface World {
  stageId: string;
  status: GameStatus;
  cartX: number;
  cartY: number;
  cartW: number;
  cartH: number;
  vy: number;
  onGround: boolean;
  elapsed: number;
  coyote: number;
  jumpBuffer: number;
  wheelAngle: number;
  /** Why the run ended (set on death), else null. */
  deathCause: DeathCause | null;
}

export interface StepEvents {
  jumped: boolean;
  landed: boolean;
  died: boolean;
  cleared: boolean;
}

/** Persisted progress (localStorage). v2 adds EXPERT + furthest-reach tracking. */
export interface MinecartProgress {
  version: number;
  /** Number of unlocked stages (by linear order); stage[i] unlocked if i < unlocked. */
  unlocked: number;
  cleared: string[];
  /** Best clear time per stage id (ms). */
  bestMs: Record<string, number>;
  /** Furthest progress fraction (0..1) reached per stage id. */
  bestReach: Record<string, number>;
  sound: boolean;
}
