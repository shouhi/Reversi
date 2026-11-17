import { describe, it, expect } from "vitest";
import {
  CHARACTER_ATLAS,
  remapUv,
  remapUvBuffer,
} from "./uvAtlas";

describe("character UV atlas", () => {
  it("covers the whole texture with four non-overlapping quadrants", () => {
    const regions = Object.values(CHARACTER_ATLAS);
    // Each is a quarter of the texture.
    for (const r of regions) {
      expect(r.x1 - r.x0).toBeCloseTo(0.5);
      expect(r.y1 - r.y0).toBeCloseTo(0.5);
    }
    // Distinct origins → no two parts share a quadrant.
    const origins = regions.map((r) => `${r.x0},${r.y0}`);
    expect(new Set(origins).size).toBe(4);
  });

  it("remaps unit UVs into the part's region corners", () => {
    const head = CHARACTER_ATLAS.head; // {0,0.5,0.5,1}
    expect(remapUv(0, 0, head)).toEqual({ u: 0, v: 0.5 });
    expect(remapUv(1, 1, head)).toEqual({ u: 0.5, v: 1 });
    expect(remapUv(0.5, 0.5, head)).toEqual({ u: 0.25, v: 0.75 });
  });

  it("head and torso UVs never collide after remap (no cross-bleed)", () => {
    const h = remapUv(0.5, 0.5, CHARACTER_ATLAS.head);
    const t = remapUv(0.5, 0.5, CHARACTER_ATLAS.torso);
    expect(h).not.toEqual(t);
  });

  it("remapUvBuffer rewrites a flat uv array in place", () => {
    const uvs = new Float32Array([0, 0, 1, 1]);
    remapUvBuffer(uvs, CHARACTER_ATLAS.legs); // {0.5,0,1,0.5}
    expect(Array.from(uvs)).toEqual([0.5, 0, 1, 0.5]);
  });
});
