/**
 * The 24 hand-designed stages (EASY/NORMAL/HARD/EXPERT × 6), authored with a
 * compact segment DSL. Difficulty comes from timing precision, short landings,
 * composite hazard sequences, elevation changes (via gaps between platforms of
 * different height), overhead "stay-grounded" beams, and a few deterministic
 * moving hazards — NOT from unfair speed or hitboxes.
 *
 * Every stage's clearability is proven by stages.test.ts via the BFS solver,
 * which also measures each stage's tightest jump window so the difficulty curve
 * is verified, not assumed.
 */

import type {
  Difficulty,
  MoveSpec,
  Obstacle,
  Platform,
  Stage,
} from "../types";
import { BASE_GROUND_Y, CART_H } from "./constants";

type GroundItem = {
  t: "rock" | "crate" | "spike";
  at: number;
  w?: number;
  h?: number;
  move?: MoveSpec;
};
type BatItem = {
  t: "bat";
  at: number;
  w?: number;
  h?: number;
  clearance?: number;
  move?: MoveSpec;
};
type BeamItem = { t: "beam"; at: number; w: number; h?: number; clearance?: number };
type Item = GroundItem | BatItem | BeamItem;

type Segment =
  | { run: number; lift?: number; items?: Item[] }
  | { gap: number };

interface StageConfig {
  id: string;
  name: string;
  difficulty: Difficulty;
  speed: number;
  startX?: number;
  endPad?: number;
  segments: Segment[];
}

const DEF = {
  rock: { w: 40, h: 54 },
  crate: { w: 42, h: 56 },
  spike: { w: 34, h: 64 },
  bat: { w: 48, h: 28 },
};

function buildStage(cfg: StageConfig): Stage {
  const startX = cfg.startX ?? 150;
  const base = BASE_GROUND_Y;
  const platforms: Platform[] = [];
  const obstacles: Obstacle[] = [];
  let cursor = startX;

  for (const seg of cfg.segments) {
    if ("gap" in seg) {
      cursor += seg.gap;
      continue;
    }
    const y = base - (seg.lift ?? 0);
    platforms.push({ x: cursor, width: seg.run, y });
    for (const it of seg.items ?? []) {
      const ax = cursor + it.at;
      if (it.t === "beam") {
        const h = it.h ?? 18;
        const bottom = y - CART_H - (it.clearance ?? 16);
        obstacles.push({ kind: "beam", x: ax, y: bottom - h, width: it.w, height: h });
      } else if (it.t === "bat") {
        const w = it.w ?? DEF.bat.w;
        const h = it.h ?? DEF.bat.h;
        const bottom = y - CART_H - (it.clearance ?? 16);
        obstacles.push({
          kind: "bat",
          x: ax,
          y: bottom - h,
          width: w,
          height: h,
          move: it.move,
        });
      } else {
        const d = DEF[it.t];
        const w = it.w ?? d.w;
        const h = it.h ?? d.h;
        obstacles.push({
          kind: it.t,
          x: ax,
          y: y - h,
          width: w,
          height: h,
          move: it.move,
        });
      }
    }
    cursor += seg.run;
  }

  return {
    id: cfg.id,
    name: cfg.name,
    difficulty: cfg.difficulty,
    speed: cfg.speed,
    startX,
    goalX: cursor - (cfg.endPad ?? 70),
    baseGroundY: base,
    platforms,
    obstacles,
  };
}

export const STAGES: Stage[] = [
  // ============================== EASY ==============================
  buildStage({
    id: "e1",
    name: "初めてのジャンプ",
    difficulty: "easy",
    speed: 300,
    segments: [{ run: 600 }, { gap: 130 }, { run: 620 }],
  }),
  buildStage({
    id: "e2",
    name: "大きな裂け目",
    difficulty: "easy",
    speed: 305,
    segments: [{ run: 560 }, { gap: 160 }, { run: 640 }],
  }),
  buildStage({
    id: "e3",
    name: "岩だらけの線路",
    difficulty: "easy",
    speed: 310,
    segments: [
      {
        run: 1180,
        items: [
          { t: "rock", at: 420 },
          { t: "crate", at: 800 },
        ],
      },
      { gap: 130 },
      { run: 420 },
    ],
  }),
  buildStage({
    id: "e4",
    name: "連続ジャンプ",
    difficulty: "easy",
    speed: 320,
    segments: [
      { run: 520 },
      { gap: 140 },
      { run: 300 },
      { gap: 145 },
      { run: 300 },
      { gap: 150 },
      { run: 480 },
    ],
  }),
  buildStage({
    id: "e5",
    name: "高低差の練習",
    difficulty: "easy",
    speed: 320,
    segments: [
      { run: 520 },
      { gap: 140 },
      { run: 420, lift: 70 },
      { gap: 150 },
      { run: 480 },
    ],
  }),
  buildStage({
    id: "e6",
    name: "最初の試練",
    difficulty: "easy",
    speed: 335,
    segments: [
      { run: 480 },
      { gap: 150 },
      { run: 360, items: [{ t: "rock", at: 210 }] },
      { gap: 150 },
      { run: 360, lift: 60 },
      { gap: 150 },
      { run: 460 },
    ],
  }),

  // ============================== NORMAL ==============================
  buildStage({
    id: "n1",
    name: "短い足場",
    difficulty: "normal",
    speed: 360,
    segments: [
      { run: 520 },
      { gap: 165 },
      { run: 190 },
      { gap: 170 },
      { run: 190 },
      { gap: 170 },
      { run: 480 },
    ],
  }),
  buildStage({
    id: "n2",
    name: "岩と穴の連続",
    difficulty: "normal",
    speed: 375,
    segments: [
      { run: 520 },
      { gap: 175 },
      { run: 420, items: [{ t: "rock", at: 250 }] },
      { gap: 180 },
      { run: 420, items: [{ t: "crate", at: 250 }] },
      { gap: 180 },
      { run: 460 },
    ],
  }),
  buildStage({
    id: "n3",
    name: "コウモリの洞窟",
    difficulty: "normal",
    speed: 385,
    segments: [
      { run: 600, items: [{ t: "beam", at: 340, w: 160 }] },
      { gap: 175 },
      { run: 640, items: [{ t: "spike", at: 300 }] },
      { gap: 180 },
      { run: 560, items: [{ t: "bat", at: 300 }] },
      { gap: 180 },
      { run: 480 },
    ],
  }),
  buildStage({
    id: "n4",
    name: "上下する線路",
    difficulty: "normal",
    speed: 390,
    segments: [
      { run: 480 },
      { gap: 175 },
      { run: 340, lift: 85 },
      { gap: 180 },
      { run: 340, lift: -40 },
      { gap: 180 },
      { run: 340, lift: 70 },
      { gap: 180 },
      { run: 460 },
    ],
  }),
  buildStage({
    id: "n5",
    name: "精密ジャンプ",
    difficulty: "normal",
    speed: 405,
    segments: [
      { run: 520 },
      { gap: 195 },
      { run: 170 },
      { gap: 200 },
      { run: 170 },
      { gap: 200 },
      { run: 170 },
      { gap: 200 },
      { run: 460 },
    ],
  }),
  buildStage({
    id: "n6",
    name: "崩れた坑道",
    difficulty: "normal",
    speed: 415,
    segments: [
      { run: 480 },
      { gap: 190 },
      { run: 360, items: [{ t: "rock", at: 230 }] },
      { gap: 195 },
      { run: 300, lift: 70 },
      { gap: 195 },
      { run: 420, items: [{ t: "beam", at: 150, w: 150 }] },
      { gap: 195 },
      { run: 460 },
    ],
  }),

  // ============================== HARD ==============================
  buildStage({
    id: "h1",
    name: "高速トロッコ",
    difficulty: "hard",
    speed: 450,
    segments: [
      { run: 600 },
      { gap: 220 },
      { run: 240 },
      { gap: 225 },
      { run: 240 },
      { gap: 230 },
      { run: 240 },
      { gap: 235 },
      { run: 520 },
    ],
  }),
  buildStage({
    id: "h2",
    name: "連続する足場",
    difficulty: "hard",
    speed: 460,
    segments: [
      { run: 560 },
      { gap: 215 },
      { run: 150 },
      { gap: 220 },
      { run: 150 },
      { gap: 220 },
      { run: 150 },
      { gap: 220 },
      { run: 150 },
      { gap: 220 },
      { run: 500 },
    ],
  }),
  buildStage({
    id: "h3",
    name: "複合トラップ",
    difficulty: "hard",
    speed: 470,
    segments: [
      { run: 560 },
      { gap: 210 },
      { run: 560, items: [{ t: "rock", at: 270 }] },
      { gap: 215 },
      { run: 520, items: [{ t: "spike", at: 240 }] },
      { gap: 220 },
      { run: 560, items: [{ t: "crate", at: 270 }] },
      { gap: 220 },
      { run: 500 },
    ],
  }),
  buildStage({
    id: "h4",
    name: "天井と深淵",
    difficulty: "hard",
    speed: 475,
    segments: [
      { run: 560, items: [{ t: "beam", at: 320, w: 180 }] },
      { gap: 225 },
      { run: 480, items: [{ t: "beam", at: 250, w: 160 }] },
      { gap: 225 },
      { run: 360, lift: 80 },
      { gap: 220 },
      { run: 560, items: [{ t: "rock", at: 270 }] },
      { gap: 220 },
      { run: 520 },
    ],
  }),
  buildStage({
    id: "h5",
    name: "極限の着地",
    difficulty: "hard",
    speed: 485,
    segments: [
      { run: 560 },
      { gap: 225 },
      { run: 140 },
      { gap: 230 },
      { run: 140, lift: 60 },
      { gap: 230 },
      { run: 140 },
      { gap: 230 },
      { run: 140 },
      { gap: 230 },
      { run: 520 },
    ],
  }),
  buildStage({
    id: "h6",
    name: "地下迷宮",
    difficulty: "hard",
    speed: 495,
    segments: [
      { run: 520 },
      { gap: 225 },
      { run: 560, lift: 80, items: [{ t: "rock", at: 270 }] },
      { gap: 230 },
      { run: 440, items: [{ t: "beam", at: 190, w: 150 }] },
      { gap: 230 },
      { run: 260 },
      { gap: 230 },
      { run: 560, lift: -50, items: [{ t: "spike", at: 270 }] },
      { gap: 225 },
      { run: 520 },
    ],
  }),

  // ============================== EXPERT ==============================
  buildStage({
    id: "x1",
    name: "一瞬の踏切",
    difficulty: "expert",
    speed: 515,
    segments: [
      { run: 600 },
      { gap: 250 },
      { run: 130 },
      { gap: 255 },
      { run: 130 },
      { gap: 258 },
      { run: 130 },
      { gap: 260 },
      { run: 520 },
    ],
  }),
  buildStage({
    id: "x2",
    name: "動く障害物",
    difficulty: "expert",
    speed: 520,
    segments: [
      { run: 560 },
      { gap: 235 },
      // Dipping hazards: when low you must jump over, when high you pass under —
      // deterministic phase, so the pattern is learnable (solver-verified).
      {
        run: 720,
        items: [
          { t: "bat", at: 360, w: 46, h: 38, clearance: 0, move: { axis: "y", amplitude: 78, period: 1.5, phase: 0 } },
        ],
      },
      { gap: 240 },
      {
        run: 720,
        items: [
          { t: "bat", at: 360, w: 46, h: 38, clearance: 0, move: { axis: "y", amplitude: 78, period: 1.3, phase: 2.0 } },
        ],
      },
      { gap: 240 },
      { run: 520 },
    ],
  }),
  buildStage({
    id: "x3",
    name: "精密連続ジャンプ",
    difficulty: "expert",
    speed: 530,
    segments: [
      { run: 560 },
      { gap: 230 },
      { run: 120 },
      { gap: 235 },
      { run: 120 },
      { gap: 238 },
      { run: 120 },
      { gap: 238 },
      { run: 120 },
      { gap: 240 },
      { run: 520 },
    ],
  }),
  buildStage({
    id: "x4",
    name: "上下する坑道",
    difficulty: "expert",
    speed: 535,
    segments: [
      { run: 520 },
      { gap: 235 },
      { run: 220, lift: 95 },
      { gap: 240 },
      { run: 220, lift: -40 },
      { gap: 240 },
      { run: 220, lift: 90 },
      { gap: 240 },
      { run: 220, lift: 0 },
      { gap: 240 },
      { run: 520 },
    ],
  }),
  buildStage({
    id: "x5",
    name: "地獄のトロッコ",
    difficulty: "expert",
    speed: 545,
    segments: [
      { run: 560, items: [{ t: "beam", at: 330, w: 180 }] },
      { gap: 245 },
      { run: 600, items: [{ t: "rock", at: 300 }] },
      { gap: 248 },
      { run: 200 },
      { gap: 250 },
      { run: 620, lift: 85, items: [{ t: "spike", at: 310 }] },
      { gap: 245 },
      { run: 520 },
    ],
  }),
  buildStage({
    id: "x6",
    name: "最終試練",
    difficulty: "expert",
    speed: 555,
    segments: [
      { run: 560 },
      { gap: 245 },
      { run: 150 },
      { gap: 250 },
      { run: 620, items: [{ t: "rock", at: 300 }] },
      { gap: 250 },
      { run: 320, lift: 90 },
      { gap: 250 },
      {
        run: 720,
        items: [
          { t: "bat", at: 360, w: 46, h: 38, clearance: 0, move: { axis: "y", amplitude: 76, period: 1.35, phase: 0.6 } },
        ],
      },
      { gap: 248 },
      { run: 150 },
      { gap: 250 },
      { run: 520 },
    ],
  }),
];

export const STAGE_BY_ID: Record<string, Stage> = Object.fromEntries(
  STAGES.map((s) => [s.id, s]),
);

export function stageIndexById(id: string): number {
  return STAGES.findIndex((s) => s.id === id);
}
