import { describe, it, expect } from "vitest";
import { STAGES, STAGE_BY_ID } from "./stages";
import { solveStage } from "./solver";
import { groundTopAt } from "./engine";
import { CART_H, flatJumpDistance, jumpApex } from "./constants";
import type { Stage } from "../types";

function gapsOf(stage: Stage): number[] {
  const plats = [...stage.platforms].sort((a, b) => a.x - b.x);
  const gaps: number[] = [];
  for (let i = 0; i < plats.length - 1; i++) {
    const edge = plats[i].x + plats[i].width;
    const w = plats[i + 1].x - edge;
    if (w > 1) gaps.push(w);
  }
  return gaps;
}

describe("stage catalog", () => {
  it("has exactly 12 stages: 4 easy, 4 normal, 4 hard", () => {
    expect(STAGES).toHaveLength(12);
    const count = (d: string) => STAGES.filter((s) => s.difficulty === d).length;
    expect(count("easy")).toBe(4);
    expect(count("normal")).toBe(4);
    expect(count("hard")).toBe(4);
  });

  it("has unique ids and non-decreasing speed within the ordered list", () => {
    const ids = new Set(STAGES.map((s) => s.id));
    expect(ids.size).toBe(12);
    for (let i = 1; i < STAGES.length; i++) {
      expect(STAGES[i].speed).toBeGreaterThanOrEqual(STAGES[i - 1].speed - 1);
    }
  });
});

describe("stage fairness (structural)", () => {
  for (const stage of STAGES) {
    describe(stage.id, () => {
      it("starts and ends on solid ground", () => {
        expect(groundTopAt(stage, stage.startX + 33)).not.toBeNull();
        expect(groundTopAt(stage, stage.goalX)).not.toBeNull();
      });

      it("has no gap wider than the cart can jump (with margin)", () => {
        const max = flatJumpDistance(stage.speed) * 0.82;
        for (const g of gapsOf(stage)) {
          expect(g).toBeLessThanOrEqual(max);
        }
      });

      it("has no ground obstacle taller than the cart can clear", () => {
        const max = jumpApex() * 0.8;
        for (const o of stage.obstacles) {
          if (o.kind !== "bat") expect(o.height).toBeLessThanOrEqual(max);
        }
      });

      it("keeps overhead hazards above a grounded cart (passable underneath)", () => {
        for (const o of stage.obstacles) {
          if (o.kind !== "bat") continue;
          const groundTop = groundTopAt(stage, o.x + o.width / 2);
          expect(groundTop).not.toBeNull();
          const cartTop = (groundTop as number) - CART_H;
          // bat bottom sits above the grounded cart's top
          expect(o.y + o.height).toBeLessThanOrEqual(cartTop);
        }
      });
    });
  }
});

describe("stage clearability (simulated success pattern)", () => {
  for (const stage of STAGES) {
    it(`${stage.id} is clearable by the solver`, () => {
      const r = solveStage(stage);
      expect(
        r.cleared,
        `${stage.id} not cleared (${r.reason} near x=${Math.round(
          r.endX,
        )}, goalX=${stage.goalX})`,
      ).toBe(true);
      // sanity: a plausible clear time
      expect(r.timeMs).toBeGreaterThan(0);
      expect(r.timeMs).toBeLessThan(60000);
    });
  }
});

describe("STAGE_BY_ID", () => {
  it("indexes every stage", () => {
    expect(Object.keys(STAGE_BY_ID)).toHaveLength(12);
    expect(STAGE_BY_ID["easy-1"].difficulty).toBe("easy");
  });
});
