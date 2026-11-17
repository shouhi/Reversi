/**
 * The 12 hand-designed stages, authored with a small segment DSL so the geometry
 * stays readable and tunable. `buildStage` turns a sequence of runs/gaps (with
 * obstacles attached at offsets within a run) into absolute world coordinates.
 *
 * Clearability of every stage is asserted automatically by stages.test.ts via
 * the headless solver — levels are fair by construction, not by hope.
 *
 * Difficulty curve: EASY teaches one idea at a time; NORMAL combines ideas and
 * raises speed; HARD tightens spacing, shortens landings, and layers hazards.
 */

import type { Difficulty, Obstacle, Platform, Stage } from "../types";
import { BASE_GROUND_Y, CART_H } from "./constants";

type GroundItem =
  | { kind: "rock" | "crate" | "spike"; at: number; w?: number; h?: number }
  | { kind: "bat"; at: number; w?: number; h?: number; clearance?: number };

type Segment = { run: number; y?: number; items?: GroundItem[] } | { gap: number };

interface StageConfig {
  id: string;
  name: string;
  difficulty: Difficulty;
  speed: number;
  startX?: number;
  baseGroundY?: number;
  endPad?: number;
  segments: Segment[];
}

function buildStage(cfg: StageConfig): Stage {
  const startX = cfg.startX ?? 140;
  const baseGroundY = cfg.baseGroundY ?? BASE_GROUND_Y;
  const platforms: Platform[] = [];
  const obstacles: Obstacle[] = [];
  let cursor = startX;

  for (const seg of cfg.segments) {
    if ("gap" in seg) {
      cursor += seg.gap;
      continue;
    }
    const y = seg.y ?? baseGroundY;
    platforms.push({ x: cursor, width: seg.run, y });
    for (const it of seg.items ?? []) {
      const ax = cursor + it.at;
      if (it.kind === "bat") {
        const w = it.w ?? 50;
        const h = it.h ?? 30;
        const cartTop = y - CART_H;
        const bottom = cartTop - (it.clearance ?? 14);
        obstacles.push({ kind: "bat", x: ax, y: bottom - h, width: w, height: h });
      } else {
        const w = it.w ?? 40;
        const h = it.h ?? 58;
        obstacles.push({ kind: it.kind, x: ax, y: y - h, width: w, height: h });
      }
    }
    cursor += seg.run;
  }

  const goalX = cursor - (cfg.endPad ?? 70);
  return {
    id: cfg.id,
    name: cfg.name,
    difficulty: cfg.difficulty,
    speed: cfg.speed,
    startX,
    goalX,
    baseGroundY,
    platforms,
    obstacles,
  };
}

export const STAGES: Stage[] = [
  // ---------------------------------------------------------------- EASY ----
  buildStage({
    id: "easy-1",
    name: "はじめの一歩",
    difficulty: "easy",
    speed: 300,
    segments: [{ run: 640 }, { gap: 120 }, { run: 640 }],
  }),
  buildStage({
    id: "easy-2",
    name: "線路の切れ目",
    difficulty: "easy",
    speed: 300,
    segments: [
      { run: 560 },
      { gap: 125 },
      { run: 360 },
      { gap: 135 },
      { run: 560 },
    ],
  }),
  buildStage({
    id: "easy-3",
    name: "岩を飛び越えて",
    difficulty: "easy",
    speed: 305,
    segments: [
      { run: 1040, items: [{ kind: "rock", at: 470, w: 42, h: 60 }] },
      { gap: 120 },
      { run: 520 },
    ],
  }),
  buildStage({
    id: "easy-4",
    name: "跳んで、また跳んで",
    difficulty: "easy",
    speed: 315,
    segments: [
      { run: 560 },
      { gap: 125 },
      { run: 560, items: [{ kind: "crate", at: 300, w: 42, h: 56 }] },
      { gap: 130 },
      { run: 560 },
    ],
  }),

  // -------------------------------------------------------------- NORMAL ----
  buildStage({
    id: "normal-1",
    name: "連なる切れ目",
    difficulty: "normal",
    speed: 370,
    segments: [
      { run: 560 },
      { gap: 165 },
      { run: 360 },
      { gap: 170 },
      { run: 360 },
      { gap: 175 },
      { run: 560 },
    ],
  }),
  buildStage({
    id: "normal-2",
    name: "岩場の裂け目",
    difficulty: "normal",
    speed: 385,
    segments: [
      { run: 560 },
      { gap: 160 },
      { run: 640, items: [{ kind: "rock", at: 320, w: 42, h: 66 }] },
      { gap: 165 },
      { run: 560 },
    ],
  }),
  buildStage({
    id: "normal-3",
    name: "コウモリの洞",
    difficulty: "normal",
    speed: 400,
    segments: [
      { run: 620, items: [{ kind: "bat", at: 380 }] },
      { gap: 165 },
      { run: 680, items: [{ kind: "spike", at: 360, w: 36, h: 70 }] },
      { gap: 170 },
      { run: 560 },
    ],
  }),
  buildStage({
    id: "normal-4",
    name: "加速する坑道",
    difficulty: "normal",
    speed: 430,
    segments: [
      { run: 640 },
      { gap: 200 },
      { run: 400 },
      { gap: 205 },
      { run: 620 },
    ],
  }),

  // ---------------------------------------------------------------- HARD ----
  buildStage({
    id: "hard-1",
    name: "疾走の連続跳躍",
    difficulty: "hard",
    speed: 480,
    segments: [
      { run: 680 },
      { gap: 215 },
      { run: 360 },
      { gap: 220 },
      { run: 360 },
      { gap: 225 },
      { run: 360 },
      { gap: 230 },
      { run: 600 },
    ],
  }),
  buildStage({
    id: "hard-2",
    name: "点のような足場",
    difficulty: "hard",
    speed: 490,
    segments: [
      { run: 700 },
      { gap: 215 },
      { run: 250 },
      { gap: 215 },
      { run: 250 },
      { gap: 215 },
      { run: 600 },
    ],
  }),
  buildStage({
    id: "hard-3",
    name: "罠だらけの深部",
    difficulty: "hard",
    speed: 510,
    segments: [
      { run: 700, items: [{ kind: "bat", at: 430 }] },
      { gap: 220 },
      { run: 760, items: [{ kind: "rock", at: 360, w: 42, h: 76 }] },
      { gap: 225 },
      { run: 760, items: [{ kind: "spike", at: 360, w: 34, h: 84 }] },
      { gap: 220 },
      { run: 620 },
    ],
  }),
  buildStage({
    id: "hard-4",
    name: "最奥への挑戦",
    difficulty: "hard",
    speed: 540,
    segments: [
      { run: 720, items: [{ kind: "bat", at: 440 }] },
      { gap: 235 },
      { run: 760, items: [{ kind: "crate", at: 380, w: 42, h: 74 }] },
      { gap: 240 },
      { run: 420 },
      { gap: 240 },
      { run: 780, items: [{ kind: "spike", at: 400, w: 34, h: 86 }] },
      { gap: 235 },
      { run: 640 },
    ],
  }),
];

export const STAGE_BY_ID: Record<string, Stage> = Object.fromEntries(
  STAGES.map((s) => [s.id, s]),
);

export function stageIndexById(id: string): number {
  return STAGES.findIndex((s) => s.id === id);
}
