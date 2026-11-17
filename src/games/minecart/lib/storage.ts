/**
 * Progress persistence (localStorage). SSR-safe, versioned, self-healing.
 *
 * v2 adds EXPERT stages and furthest-reach tracking. Because every stage was
 * redesigned (new ids, new layouts), old v1 clear times are not comparable, so we
 * do NOT carry them forward — but we never destroy the old record: the v1 blob is
 * archived under a separate key, and the sound preference is carried over.
 */

import type { MinecartProgress } from "../types";
import { STAGES } from "./stages";

const KEY = "minecart:progress";
const ARCHIVE_KEY = "minecart:progress:v1";
const VERSION = 2;

export function defaultProgress(): MinecartProgress {
  return {
    version: VERSION,
    unlocked: 1,
    cleared: [],
    bestMs: {},
    bestReach: {},
    sound: true,
  };
}

function isValidV2(p: unknown): p is MinecartProgress {
  if (!p || typeof p !== "object") return false;
  const o = p as Record<string, unknown>;
  return (
    o.version === VERSION &&
    typeof o.unlocked === "number" &&
    Array.isArray(o.cleared) &&
    o.bestMs !== null &&
    typeof o.bestMs === "object" &&
    o.bestReach !== null &&
    typeof o.bestReach === "object" &&
    typeof o.sound === "boolean"
  );
}

export function loadProgress(): MinecartProgress {
  if (typeof window === "undefined") return defaultProgress();
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return defaultProgress();
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (isValidV2(parsed)) {
      return {
        ...(parsed as unknown as MinecartProgress),
        unlocked: Math.max(1, Math.min(Number(parsed.unlocked), STAGES.length)),
      };
    }
    // Migrate an older record: archive it (never destroy), carry sound only.
    if (parsed && parsed.version === 1) {
      try {
        if (!window.localStorage.getItem(ARCHIVE_KEY)) {
          window.localStorage.setItem(ARCHIVE_KEY, raw);
        }
      } catch {
        /* ignore archive failures */
      }
      const migrated = defaultProgress();
      if (typeof parsed.sound === "boolean") migrated.sound = parsed.sound;
      saveProgress(migrated);
      return migrated;
    }
    return defaultProgress();
  } catch {
    return defaultProgress();
  }
}

export function saveProgress(p: MinecartProgress): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable (private mode / quota) — best-effort */
  }
}

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
    idx >= 0
      ? Math.min(Math.max(prev.unlocked, idx + 2), STAGES.length)
      : prev.unlocked;
  const bestReach = { ...prev.bestReach, [stageId]: 1 };
  const next: MinecartProgress = { ...prev, cleared, bestMs, bestReach, unlocked };
  saveProgress(next);
  return next;
}

export function recordReach(
  prev: MinecartProgress,
  stageId: string,
  reach: number,
): MinecartProgress {
  const clamped = Math.max(0, Math.min(1, reach));
  const prevReach = prev.bestReach[stageId] ?? 0;
  if (clamped <= prevReach) return prev;
  const next = { ...prev, bestReach: { ...prev.bestReach, [stageId]: clamped } };
  saveProgress(next);
  return next;
}

export function setSound(prev: MinecartProgress, sound: boolean): MinecartProgress {
  const next = { ...prev, sound };
  saveProgress(next);
  return next;
}
