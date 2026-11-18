import { describe, it, expect } from "vitest";
import {
  CHARACTER_ATLAS,
  atlasRegionPixels,
  partForUv,
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

describe("partForUv (brush clipping / anti-bleed)", () => {
  it("maps each quadrant centre to its part", () => {
    expect(partForUv(0.25, 0.75)).toBe("head"); // top-left
    expect(partForUv(0.75, 0.75)).toBe("torso"); // top-right
    expect(partForUv(0.25, 0.25)).toBe("arms"); // bottom-left
    expect(partForUv(0.75, 0.25)).toBe("legs"); // bottom-right
  });

  it("resolves a point just inside the head↔torso seam to the correct single part", () => {
    // A brush hit near the internal boundary must belong to exactly ONE part so
    // it can be clipped there — reproduces the cross-part bleed bug.
    expect(partForUv(0.49, 0.75)).toBe("head");
    expect(partForUv(0.51, 0.75)).toBe("torso");
  });

  it("gives different parts across a seam so a drag never connects across it", () => {
    // The engine only draws a connecting line when both dabs share a part;
    // these differ, so a fast head→torso drag cannot streak the atlas.
    expect(partForUv(0.49, 0.75)).not.toBe(partForUv(0.51, 0.75));
    expect(partForUv(0.25, 0.49)).not.toBe(partForUv(0.25, 0.51)); // arms↔head
  });
});

describe("atlasRegionPixels (clip rectangles)", () => {
  it("places each part in its own canvas quadrant (Y flipped), non-overlapping", () => {
    const S = 256;
    expect(atlasRegionPixels(CHARACTER_ATLAS.head, S)).toEqual({ x: 0, y: 0, w: 128, h: 128 });
    expect(atlasRegionPixels(CHARACTER_ATLAS.torso, S)).toEqual({ x: 128, y: 0, w: 128, h: 128 });
    expect(atlasRegionPixels(CHARACTER_ATLAS.arms, S)).toEqual({ x: 0, y: 128, w: 128, h: 128 });
    expect(atlasRegionPixels(CHARACTER_ATLAS.legs, S)).toEqual({ x: 128, y: 128, w: 128, h: 128 });
  });

  it("the head clip rect excludes the torso's pixel column (no bleed right)", () => {
    const head = atlasRegionPixels(CHARACTER_ATLAS.head, 256);
    const torso = atlasRegionPixels(CHARACTER_ATLAS.torso, 256);
    // A brush clipped to the head can't reach any torso pixel.
    expect(head.x + head.w).toBeLessThanOrEqual(torso.x);
  });
});
