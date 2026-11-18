/**
 * COLOR HIDE — prefers-reduced-motion helper.
 *
 * Animations, camera easing, flashes, and banner transitions all consult this so
 * players who ask the OS to reduce motion get a calm, still experience. SSR-safe.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}
