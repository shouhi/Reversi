import * as THREE from "three";

/**
 * Small texture cache for players' committed paints. A character's paint arrives
 * as a data URL; we turn it into a shared THREE.Texture once and reuse it, so
 * rendering six opponents costs six materials, not six decodes per frame.
 */

const cache = new Map<string, THREE.Texture>();
let blank: THREE.Texture | null = null;

/** A plain off-white texture for players who haven't painted yet. */
export function blankTexture(): THREE.Texture {
  if (blank) return blank;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 8;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#e5e7eb";
    ctx.fillRect(0, 0, 8, 8);
  }
  blank = new THREE.CanvasTexture(canvas);
  blank.colorSpace = THREE.SRGBColorSpace;
  return blank;
}

/** Returns a cached texture for a paint data URL (loads asynchronously). */
export function textureForPaint(dataUrl: string | undefined): THREE.Texture {
  if (!dataUrl) return blankTexture();
  const existing = cache.get(dataUrl);
  if (existing) return existing;
  const tex = new THREE.TextureLoader().load(dataUrl);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  cache.set(dataUrl, tex);
  return tex;
}

/**
 * Disposes + clears all cached paint textures. Call when leaving a round so GPU
 * texture memory doesn't grow unbounded across many rooms in one session (the
 * shared `blank` texture is kept).
 */
export function clearTextureCache(): void {
  for (const tex of cache.values()) tex.dispose();
  cache.clear();
}
