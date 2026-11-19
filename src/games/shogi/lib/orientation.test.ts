import { describe, it, expect } from "vitest";
import { toLogicCoord, viewerFlipped } from "./orientation";

describe("shogi orientation — P0-1 per-viewer board flip", () => {
  it("flips only for the gote viewer", () => {
    expect(viewerFlipped("sente")).toBe(false);
    expect(viewerFlipped("gote")).toBe(true);
  });

  it("sente view is the identity (display coord == logic coord)", () => {
    for (const r of [0, 4, 8]) {
      for (const c of [0, 4, 8]) {
        expect(toLogicCoord(r, c, false)).toEqual({ row: r, col: c });
      }
    }
  });

  it("gote view mirrors both axes (display 0,0 = logic 8,8; center invariant)", () => {
    expect(toLogicCoord(0, 0, true)).toEqual({ row: 8, col: 8 });
    expect(toLogicCoord(8, 8, true)).toEqual({ row: 0, col: 0 });
    expect(toLogicCoord(4, 4, true)).toEqual({ row: 4, col: 4 });
    expect(toLogicCoord(0, 8, true)).toEqual({ row: 8, col: 0 });
  });

  it("is its own inverse (display→logic→display round-trips)", () => {
    for (const r of [0, 1, 4, 7, 8]) {
      for (const c of [0, 2, 5, 8]) {
        const logic = toLogicCoord(r, c, true);
        const back = toLogicCoord(logic.row, logic.col, true);
        expect(back).toEqual({ row: r, col: c });
      }
    }
  });

  it("gote's own back-rank (logic rows 0-2) renders at the BOTTOM for the gote viewer", () => {
    // Gote pieces live in canonical rows 0-2 (the top in sente's view). In the gote
    // view they must appear at display rows 6-8 (the bottom). For each logic row in
    // 0..2 there is a display slot in 6..8 that maps to it.
    for (const logicRow of [0, 1, 2]) {
      const displayRow = 8 - logicRow; // inverse mapping
      expect(displayRow).toBeGreaterThanOrEqual(6);
      expect(toLogicCoord(displayRow, 0, true).row).toBe(logicRow);
    }
    // And sente's back-rank (logic rows 6-8) renders at the TOP (display rows 0-2).
    for (const logicRow of [6, 7, 8]) {
      const displayRow = 8 - logicRow;
      expect(displayRow).toBeLessThanOrEqual(2);
    }
  });
});
