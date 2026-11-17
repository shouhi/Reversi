import { describe, it, expect } from "vitest";
import { STAGES, STAGE_BY_ID } from "./stages";
import {
  solveStage,
  replaySteps,
  computeMetrics,
  overheadIsGroundPassable,
} from "./solver";
import { groundTopAt } from "./engine";
import type { Stage } from "../types";

describe("stage catalog", () => {
  it("has 24 stages: 6 each of easy/normal/hard/expert", () => {
    expect(STAGES).toHaveLength(24);
    const count = (d: string) => STAGES.filter((s) => s.difficulty === d).length;
    expect(count("easy")).toBe(6);
    expect(count("normal")).toBe(6);
    expect(count("hard")).toBe(6);
    expect(count("expert")).toBe(6);
  });

  it("has unique ids and non-decreasing speed", () => {
    expect(new Set(STAGES.map((s) => s.id)).size).toBe(24);
    for (let i = 1; i < STAGES.length; i++) {
      expect(STAGES[i].speed).toBeGreaterThanOrEqual(STAGES[i - 1].speed - 1);
    }
  });
});

describe("stage structural fairness", () => {
  for (const stage of STAGES) {
    it(`${stage.id} starts/ends on ground and overhead hazards are passable`, () => {
      expect(groundTopAt(stage, stage.startX + 33)).not.toBeNull();
      expect(groundTopAt(stage, stage.goalX)).not.toBeNull();
      expect(overheadIsGroundPassable(stage)).toBe(true);
    });
  }
});

describe("stage clearability (BFS solver) + replay reproducibility", () => {
  for (const stage of STAGES) {
    it(`${stage.id} is clearable and the solution replays identically`, () => {
      const r = solveStage(stage);
      expect(
        r.cleared,
        `${stage.id} NOT clearable (${r.reason}, nodes=${r.exploredNodes})`,
      ).toBe(true);
      // The recorded input sequence reproduces the clear through the real engine.
      const replay = replaySteps(stage, r.jumpSteps);
      expect(replay.cleared, `${stage.id} replay failed`).toBe(true);
      expect(Math.abs(replay.timeMs - r.timeMs)).toBeLessThanOrEqual(20);
    });
  }
});

/** Informational: prints the difficulty table and checks the curve is sane. */
describe("difficulty metrics", () => {
  const metrics = STAGES.map((s) => computeMetrics(s));

  it("logs the full metrics table", () => {
    const rows = metrics.map((m) => ({
      id: m.id,
      diff: m.difficulty,
      spd: m.speed,
      len: m.length,
      gaps: m.gapCount,
      maxGap: m.maxGap,
      minPlat: m.minPlatform,
      obs: m.obstacleCount,
      mov: m.movingCount,
      beam: m.beamCount,
      jumps: m.jumpCount,
      clearMs: m.minClearMs,
      windowMs: m.tightestWindowMs,
      comp: m.compositeCount,
      score: m.score,
    }));
    console.table(rows);
    expect(rows).toHaveLength(24);
  });

  it("all stages are clearable per the metrics", () => {
    for (const m of metrics) {
      expect(m.clearable, `${m.id} not clearable`).toBe(true);
    }
  });

  it("the composite difficulty score rises across tiers (tier means)", () => {
    const mean = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
    const byTier = (d: string) =>
      mean(metrics.filter((m) => m.difficulty === d).map((m) => m.score));
    const easy = byTier("easy");
    const normal = byTier("normal");
    const hard = byTier("hard");
    const expert = byTier("expert");
    expect(normal).toBeGreaterThan(easy);
    expect(hard).toBeGreaterThan(normal);
    expect(expert).toBeGreaterThan(hard);
  });

  it("every stage stays humanly fair (no sub-60ms jump window)", () => {
    for (const m of metrics) {
      expect(
        m.tightestWindowMs,
        `${m.id} window too tight (${m.tightestWindowMs}ms)`,
      ).toBeGreaterThanOrEqual(60);
    }
  });

  it("difficulty is harder than the original game (median window < 250ms)", () => {
    const windows = metrics.map((m) => m.tightestWindowMs).sort((a, b) => a - b);
    const median = windows[Math.floor(windows.length / 2)];
    expect(median).toBeLessThan(250);
  });
});

describe("STAGE_BY_ID", () => {
  it("indexes every stage", () => {
    expect(Object.keys(STAGE_BY_ID)).toHaveLength(24);
  });
});

/** Guard against degenerate authoring: no absurd gaps relative to jump reach. */
describe("no impossible gaps", () => {
  const JUMP = (s: Stage) => (s.speed * 2 * 900) / 2600; // flat jump distance
  for (const stage of STAGES) {
    it(`${stage.id} gaps are within reach`, () => {
      const plats = [...stage.platforms].sort((a, b) => a.x - b.x);
      for (let i = 0; i < plats.length - 1; i++) {
        const w = plats[i + 1].x - (plats[i].x + plats[i].width);
        if (w > 1) expect(w).toBeLessThanOrEqual(JUMP(stage) * 0.95);
      }
    });
  }
});
