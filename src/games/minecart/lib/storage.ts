/**
 * Progress persistence (localStorage). SSR-safe (guards `window`), versioned, and
 * self-healing: any corruption or version mismatch resets to a safe default
 * rather than throwing.
 */

import type { MinecartProgress } from "../types";
import { STAGES } from "./stages";

const KEY = "minecart:progress";
const VERSION = 1;

export function defaultProgress(): MinecartProgress {
  return { version: VERSION, unlocked: 1, cleared: [], bestMs: {}, sound: true };
}

function isValid(p: unknown): p is MinecartProgress {
  if (!p || typeof p !== "object") return false;
  const o = p as Record<string, unknown>;
  return (
    o.version === VERSION &&
    typeof o.unlocked === "number" &&
    Array.isArray(o.cleared) &&
    typeof o.bestMs === "object" &&
    o.bestMs !== null &&
    typeof o.sound === "boolean"
  );
}

export function loadProgress(): MinecartProgress {
  if (typeof window === "undefined") return defaultProgress();
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return defaultProgress();
    const parsed = JSON.parse(raw);
    if (!isValid(parsed)) return defaultProgress();
    // Clamp unlocked into range in case the stage list changed.
    return {
      ...parsed,
      unlocked: Math.max(1, Math.min(parsed.unlocked, STAGES.length)),
    };
  } catch {
    return defaultProgress();
  }
}

export function saveProgress(p: MinecartProgress): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable (private mode / quota) — progress is best-effort */
  }
}

/**
 * Records a stage clear: marks it cleared, unlocks the next stage, and keeps the
 * best (lowest) time. Returns the updated progress (also persisted).
 */
export function recordClear(
  prev: MinecartProgress,
  stageId: string,
  timeMs: number,
): MinecartProgress {
  const idx = STAGES.findIndex((s) => s.id === stageId);
  const cleared = prev.cleared.includes(stageId)
    ? prev.cleared
    : [...prev.cleared, stageId];
  const prevBest = prev.bestMs[stageId];
  const bestMs = {
    ...prev.bestMs,
    [stageId]: prevBest === undefined ? timeMs : Math.min(prevBest, timeMs),
  };
  const unlocked =
    idx >= 0 ? Math.min(Math.max(prev.unlocked, idx + 2), STAGES.length) : prev.unlocked;
  const next: MinecartProgress = { ...prev, cleared, bestMs, unlocked };
  saveProgress(next);
  return next;
}

export function setSound(
  prev: MinecartProgress,
  sound: boolean,
): MinecartProgress {
  const next = { ...prev, sound };
  saveProgress(next);
  return next;
}
