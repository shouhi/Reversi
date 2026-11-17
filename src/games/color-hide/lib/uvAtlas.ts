/**
 * COLOR HIDE — character UV atlas.
 *
 * The character is built from a few primitives (head, torso, arms, legs) that all
 * share ONE paint texture. To stop painting the head from also painting the body,
 * each part's geometry UVs are remapped into a distinct rectangle of the texture.
 * Raycast hits then return a UV already inside the part's region, so the brush
 * lands only on the surface you clicked. Pure + DOM-free → unit-tested, and reused
 * by the three.js geometry builder.
 *
 * Layout (a 2×2 atlas; the two arms share one region and the two legs another,
 * which reads as a tidy symmetric paint job):
 *
 *   (0,1)┌──────────┬──────────┐(1,1)
 *        │   head   │  torso   │
 *        ├──────────┼──────────┤
 *        │   arms   │   legs   │
 *   (0,0)└──────────┴──────────┘(1,0)
 */

export interface AtlasRegion {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export type CharacterPart = "head" | "torso" | "arms" | "legs";

export const CHARACTER_ATLAS: Record<CharacterPart, AtlasRegion> = {
  head: { x0: 0, y0: 0.5, x1: 0.5, y1: 1 },
  torso: { x0: 0.5, y0: 0.5, x1: 1, y1: 1 },
  arms: { x0: 0, y0: 0, x1: 0.5, y1: 0.5 },
  legs: { x0: 0.5, y0: 0, x1: 1, y1: 0.5 },
};

/** Maps a unit UV (0..1) into the given atlas region. */
export function remapUv(
  u: number,
  v: number,
  region: AtlasRegion,
): { u: number; v: number } {
  return {
    u: region.x0 + u * (region.x1 - region.x0),
    v: region.y0 + v * (region.y1 - region.y0),
  };
}

/**
 * Remaps a flat UV buffer (…, u, v, u, v, …) in place into a region. Returns the
 * same array for chaining. Used on each primitive's geometry before rendering.
 */
export function remapUvBuffer(uvs: Float32Array, region: AtlasRegion): Float32Array {
  for (let i = 0; i + 1 < uvs.length; i += 2) {
    const { u, v } = remapUv(uvs[i], uvs[i + 1], region);
    uvs[i] = u;
    uvs[i + 1] = v;
  }
  return uvs;
}
