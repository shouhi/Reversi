/**
 * COLOR HIDE — render quality tier.
 *
 * PC hits the display's vsync cap (120 FPS measured on all three maps), but
 * low-end / mobile devices can't be profiled here, so we degrade gracefully: a
 * "low" tier caps device-pixel-ratio and drops real-time shadows (the dominant
 * GPU cost in a flat-shaded box scene). Tier is auto-detected from coarse device
 * hints and can be forced via `localStorage["color-hide:quality"]` = "high"|"low"
 * (handy for testing on a real phone). Pure heuristic — no network, SSR-safe.
 */

export type Quality = "high" | "low";
/** User preference: "auto" lets the heuristic decide; "high"/"low" force a tier. */
export type QualityPref = Quality | "auto";

const QUALITY_KEY = "color-hide:quality";

/** The stored preference (defaults to "auto"). */
export function getQualityPref(): QualityPref {
  if (typeof window === "undefined") return "auto";
  try {
    const o = window.localStorage.getItem(QUALITY_KEY);
    return o === "high" || o === "low" ? o : "auto";
  } catch {
    return "auto";
  }
}

/** Persists the preference ("auto" clears the override so the heuristic runs). */
export function setQualityPref(p: QualityPref): void {
  if (typeof window === "undefined") return;
  try {
    if (p === "auto") window.localStorage.removeItem(QUALITY_KEY);
    else window.localStorage.setItem(QUALITY_KEY, p);
  } catch {
    /* ignore */
  }
}

export function detectQuality(): Quality {
  if (typeof window === "undefined") return "high";
  try {
    const override = window.localStorage.getItem(QUALITY_KEY);
    if (override === "high" || override === "low") return override;
  } catch {
    /* localStorage unavailable → fall through to heuristic */
  }
  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  const cores = nav?.hardwareConcurrency ?? 8;
  // navigator.deviceMemory is Chromium-only; treat missing as "plenty".
  const mem = (nav as unknown as { deviceMemory?: number })?.deviceMemory ?? 8;
  const touch = typeof window !== "undefined" && "ontouchstart" in window;
  return cores <= 4 || mem <= 4 || touch ? "low" : "high";
}

/** Device-pixel-ratio clamp for a tier (passed to R3F <Canvas dpr>). */
export function dprFor(q: Quality): [number, number] {
  return q === "low" ? [1, 1.25] : [1, 2];
}

/** Whether real-time shadows should render for a tier. */
export function shadowsFor(q: Quality): boolean {
  return q === "high";
}
