import type { KvStore, VersionedRecord } from "@/lib/store";
import {
  MAX_PLAYERS,
  PAINT_COMMIT_MIN_INTERVAL_MS,
  ROOM_TTL_SECONDS,
} from "./constants";
import { validatePaintPayload } from "./paint";

/**
 * COLOR HIDE — paint storage (separate KV namespace).
 *
 * Confirmed character textures are kept OUT of the room record so lobby polling
 * stays tiny; they live under their own key (`color-hide:paint:<roomId>`) and are
 * fetched once when a round starts (and on reconnect). Size, format, count, and
 * commit frequency are all bounded here — never an unbounded blob store.
 */

export const COLOR_HIDE_PAINT_PREFIX = "color-hide:paint:";
const MAX_CAS_RETRIES = 6;

interface PaintEntry {
  dataUrl: string;
  mime: string;
  bytes: number;
  updatedAt: number;
}

export interface PaintRecord extends VersionedRecord {
  roomId: string;
  /** playerId → their confirmed paint. At most MAX_PLAYERS entries. */
  paints: Record<string, PaintEntry>;
  createdAt: number;
  updatedAt: number;
}

export type PaintStore = KvStore<PaintRecord>;

export type PaintError = "invalid_paint" | "rate_limited" | "version_conflict";

export type PaintResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: PaintError; message: string };

/** All confirmed paints for a room as a plain playerId → dataURL map. */
export async function getPaints(
  store: PaintStore,
  roomId: string,
): Promise<Record<string, string>> {
  const rec = await store.get(roomId);
  if (!rec) return {};
  const out: Record<string, string> = {};
  for (const [id, entry] of Object.entries(rec.paints)) {
    out[id] = entry.dataUrl;
  }
  return out;
}

/**
 * Commits one player's paint. Validates the envelope (PNG/WebP, byte cap),
 * enforces a per-player minimum interval, and caps the number of stored entries.
 */
export async function commitPaint(
  store: PaintStore,
  roomId: string,
  playerId: string,
  payload: unknown,
  now: number = Date.now(),
): Promise<PaintResult<{ bytes: number }>> {
  const validation = validatePaintPayload(payload);
  if (!validation.ok) {
    return { ok: false, error: "invalid_paint", message: validation.reason };
  }
  const entry: PaintEntry = {
    dataUrl: payload as string,
    mime: validation.mime,
    bytes: validation.bytes,
    updatedAt: now,
  };

  for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
    const existing = await store.get(roomId);

    if (!existing) {
      const rec: PaintRecord = {
        roomId,
        paints: { [playerId]: entry },
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      const created = await store.create(roomId, rec, ROOM_TTL_SECONDS);
      if (created) return { ok: true, value: { bytes: entry.bytes } };
      continue; // someone created it first → fall through to CAS path
    }

    const prev = existing.paints[playerId];
    if (prev && now - prev.updatedAt < PAINT_COMMIT_MIN_INTERVAL_MS) {
      return {
        ok: false,
        error: "rate_limited",
        message: "You are committing paint too quickly. Please wait a moment.",
      };
    }
    // Enforce the entry cap (ignore brand-new ids once full; existing ids update).
    if (!prev && Object.keys(existing.paints).length >= MAX_PLAYERS) {
      return {
        ok: false,
        error: "invalid_paint",
        message: "This room already has the maximum number of paints.",
      };
    }

    const next: PaintRecord = {
      ...existing,
      paints: { ...existing.paints, [playerId]: entry },
      version: existing.version + 1,
      updatedAt: now,
    };
    const cas = await store.compareAndSwap(roomId, existing.version, next, ROOM_TTL_SECONDS);
    if (cas === "ok") return { ok: true, value: { bytes: entry.bytes } };
    // conflict / not_found → retry.
  }

  return {
    ok: false,
    error: "version_conflict",
    message: "Paint is being updated too quickly. Please try again.",
  };
}
