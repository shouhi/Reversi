/**
 * Headless clearability solver and difficulty analyzer.
 *
 * `solveStage` runs a breadth-first search over per-step reachable states using
 * the REAL engine (stepFixed) — so moving obstacles, overhead beams, and
 * elevation are all handled correctly, because every transition checks real
 * collisions. It returns a concrete jump-input sequence (the steps at which to
 * press jump). `replaySteps` re-runs that sequence through the engine to prove
 * reproducibility, and `computeMetrics` derives difficulty indicators including
 * the tightest jump's success window (the key timing-precision metric).
 *
 * Because the cart's horizontal position advances a fixed amount per step
 * regardless of jumps, step index and elapsed time are in lockstep — so the only
 * decisions are *which steps* to press jump, which makes the BFS tractable.
 */

import type { Stage } from "../types";
import { cloneWorld, createWorld, groundTopAt, stepFixed } from "./engine";
import { CART_W, FIXED_DT, flatJumpDistance } from "./constants";

const MAX_NODES = 500_000;

interface Node {
  w: ReturnType<typeof createWorld>;
  parent: number;
  jumped: boolean; // did the transition that created this node press jump?
  depth: number; // == step index; the depth-th stepFixed call produced it
}

function signature(w: Node["w"], depth: number): string {
  return (
    depth +
    ":" +
    Math.round(w.cartY) +
    ":" +
    Math.round(w.vy / 12) +
    ":" +
    (w.onGround ? 1 : 0) +
    ":" +
    Math.round(w.coyote * 120) +
    ":" +
    Math.round(w.jumpBuffer * 120)
  );
}

export interface SolveResult {
  cleared: boolean;
  /** Step indices (1-based stepFixed call numbers) at which to press jump. */
  jumpSteps: number[];
  timeMs: number;
  exploredNodes: number;
  reason?: "cleared" | "dead-out" | "timeout" | "node-cap";
}

export function solveStage(stage: Stage, maxSeconds = 70): SolveResult {
  const maxDepth = Math.ceil(maxSeconds / FIXED_DT);
  const start = createWorld(stage);
  start.status = "running";

  const nodes: Node[] = [{ w: start, parent: -1, jumped: false, depth: 0 }];
  let frontier = [0];
  const visited = new Set<string>([signature(start, 0)]);

  const reconstruct = (parentIdx: number, lastJumpDepth: number | null): number[] => {
    const steps: number[] = [];
    if (lastJumpDepth !== null) steps.push(lastJumpDepth);
    let i = parentIdx;
    while (i >= 0) {
      const n = nodes[i];
      if (n.jumped) steps.push(n.depth);
      i = n.parent;
    }
    return steps.sort((a, b) => a - b);
  };

  for (let depth = 0; depth < maxDepth; depth++) {
    const next: number[] = [];
    for (const idx of frontier) {
      const node = nodes[idx];
      const canJump = node.w.onGround || node.w.coyote > 0;
      const options = canJump ? [false, true] : [false];
      for (const doJump of options) {
        const child = cloneWorld(node.w);
        const ev = stepFixed(child, stage, FIXED_DT, doJump);
        if (ev.cleared) {
          return {
            cleared: true,
            jumpSteps: reconstruct(idx, doJump ? depth + 1 : null),
            timeMs: Math.round(child.elapsed * 1000),
            exploredNodes: nodes.length,
            reason: "cleared",
          };
        }
        if (ev.died) continue;
        const sig = signature(child, depth + 1);
        if (visited.has(sig)) continue;
        visited.add(sig);
        nodes.push({ w: child, parent: idx, jumped: doJump, depth: depth + 1 });
        next.push(nodes.length - 1);
        if (nodes.length > MAX_NODES) {
          return {
            cleared: false,
            jumpSteps: [],
            timeMs: 0,
            exploredNodes: nodes.length,
            reason: "node-cap",
          };
        }
      }
    }
    if (next.length === 0) {
      return {
        cleared: false,
        jumpSteps: [],
        timeMs: 0,
        exploredNodes: nodes.length,
        reason: "dead-out",
      };
    }
    frontier = next;
  }
  return {
    cleared: false,
    jumpSteps: [],
    timeMs: 0,
    exploredNodes: nodes.length,
    reason: "timeout",
  };
}

export interface ReplayResult {
  cleared: boolean;
  timeMs: number;
  endX: number;
}

/** Re-run a jump-step sequence through the real engine (reproducibility check). */
export function replaySteps(
  stage: Stage,
  jumpSteps: number[],
  maxSeconds = 70,
): ReplayResult {
  const set = new Set(jumpSteps);
  const w = createWorld(stage);
  w.status = "running";
  const maxDepth = Math.ceil(maxSeconds / FIXED_DT);
  for (let call = 1; call <= maxDepth; call++) {
    const ev = stepFixed(w, stage, FIXED_DT, set.has(call));
    if (ev.cleared) return { cleared: true, timeMs: Math.round(w.elapsed * 1000), endX: w.cartX };
    if (ev.died) return { cleared: false, timeMs: Math.round(w.elapsed * 1000), endX: w.cartX };
  }
  return { cleared: false, timeMs: 0, endX: w.cartX };
}

function sortedPlatforms(stage: Stage) {
  return [...stage.platforms].sort((a, b) => a.x - b.x);
}

function gapWidths(stage: Stage): number[] {
  const plats = sortedPlatforms(stage);
  const gaps: number[] = [];
  for (let i = 0; i < plats.length - 1; i++) {
    const w = plats[i + 1].x - (plats[i].x + plats[i].width);
    if (w > 1) gaps.push(w);
  }
  return gaps;
}

export interface StageMetrics {
  id: string;
  difficulty: string;
  speed: number;
  length: number;
  gapCount: number;
  maxGap: number;
  minPlatform: number;
  obstacleCount: number;
  movingCount: number;
  beamCount: number;
  jumpDistance: number;
  jumpCount: number;
  clearable: boolean;
  minClearMs: number;
  /** Tightest single-jump success window across the stage (ms). */
  tightestWindowMs: number;
  /** Count of hazards closely spaced into composite sequences. */
  compositeCount: number;
  /** Composite difficulty score (higher = harder), combining all factors. */
  score: number;
}

/**
 * A multi-factor difficulty score. Difficulty is NOT just speed or obstacle
 * count — it weighs timing precision (tight windows), short landings, the number
 * of consecutive jumps, composite hazard sequences, moving hazards, and beams.
 */
export function difficultyScore(m: Omit<StageMetrics, "score">): number {
  const windowPenalty = Math.max(0, 260 - m.tightestWindowMs) / 30;
  const shortPlat = Math.max(0, 280 - m.minPlatform) / 45;
  const raw =
    (m.speed - 280) / 40 +
    m.jumpCount * 0.5 +
    m.compositeCount * 1.0 +
    m.movingCount * 1.5 +
    m.beamCount * 0.8 +
    windowPenalty +
    shortPlat;
  return Math.round(raw * 10) / 10;
}

/**
 * For the solved stage, measure how far each jump can be shifted in time and
 * still clear (holding the other jumps fixed); the smallest such window is the
 * stage's timing-precision metric.
 */
function measureTightestWindow(stage: Stage, jumpSteps: number[]): number {
  if (jumpSteps.length === 0) return Infinity;
  const CAP = 160; // steps (~1.3s) search bound each side
  let tightest = Infinity;
  for (let k = 0; k < jumpSteps.length; k++) {
    const base = jumpSteps[k];
    const others = jumpSteps.filter((_, i) => i !== k);
    const clearsWith = (shift: number) =>
      replaySteps(stage, [...others, base + shift].filter((s) => s >= 1)).cleared;
    if (!clearsWith(0)) continue; // shouldn't happen, but be safe
    let lo = 0;
    while (lo > -CAP && clearsWith(lo - 1)) lo--;
    let hi = 0;
    while (hi < CAP && clearsWith(hi + 1)) hi++;
    const windowMs = (hi - lo + 1) * FIXED_DT * 1000;
    tightest = Math.min(tightest, windowMs);
  }
  return tightest;
}

export function computeMetrics(stage: Stage): StageMetrics {
  const plats = sortedPlatforms(stage);
  const gaps = gapWidths(stage);
  const jumpDistance = flatJumpDistance(stage.speed);
  const solve = solveStage(stage);

  // composite: adjacent hazards (gaps + ground obstacles) spaced within one jump
  const hazardXs: number[] = [];
  for (let i = 0; i < plats.length - 1; i++) {
    const edge = plats[i].x + plats[i].width;
    if (plats[i + 1].x - edge > 1) hazardXs.push(edge);
  }
  for (const o of stage.obstacles) if (o.kind !== "bat" && o.kind !== "beam") hazardXs.push(o.x);
  hazardXs.sort((a, b) => a - b);
  let compositeCount = 0;
  for (let i = 1; i < hazardXs.length; i++) {
    if (hazardXs[i] - hazardXs[i - 1] < jumpDistance * 1.1) compositeCount++;
  }

  const partial = {
    id: stage.id,
    difficulty: stage.difficulty,
    speed: stage.speed,
    length: Math.round(stage.goalX - stage.startX),
    gapCount: gaps.length,
    maxGap: gaps.length ? Math.max(...gaps) : 0,
    minPlatform: plats.length ? Math.min(...plats.map((p) => p.width)) : 0,
    obstacleCount: stage.obstacles.length,
    movingCount: stage.obstacles.filter((o) => o.move).length,
    beamCount: stage.obstacles.filter((o) => o.kind === "beam").length,
    jumpDistance: Math.round(jumpDistance),
    jumpCount: solve.jumpSteps.length,
    clearable: solve.cleared,
    minClearMs: solve.timeMs,
    tightestWindowMs: solve.cleared
      ? Math.round(measureTightestWindow(stage, solve.jumpSteps))
      : 0,
    compositeCount,
  };
  return { ...partial, score: difficultyScore(partial) };
}

/** Lightweight guard used by stage tests to flag obviously-unfair geometry. */
export function overheadIsGroundPassable(stage: Stage): boolean {
  // Every overhead hazard (bat/beam) base must sit above a grounded cart so a
  // grounded cart can pass under it somewhere in its x-span.
  for (const o of stage.obstacles) {
    if (o.kind !== "bat" && o.kind !== "beam") continue;
    if (o.move) continue; // moving hazards are timing-based; the solver verifies them
    const groundTop = groundTopAt(stage, o.x + o.width / 2);
    if (groundTop === null) return false; // static overhead over a gap is unfair
    const cartTop = groundTop - 46; // CART_H
    if (o.y + o.height > cartTop + 1) return false;
  }
  return true;
}

export { CART_W };
