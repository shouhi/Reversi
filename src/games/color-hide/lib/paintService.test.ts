import { describe, it, expect, beforeEach } from "vitest";
import { createMemoryStore, __resetMemoryStore } from "@/lib/store/memory";
import {
  COLOR_HIDE_PAINT_PREFIX,
  commitPaint,
  getPaints,
  type PaintStore,
} from "./paintService";
import type { PaintRecord } from "./paintService";
import {
  MAX_PAINT_BYTES,
  MAX_PLAYERS,
  PAINT_COMMIT_MIN_INTERVAL_MS,
} from "./constants";

function freshStore(): PaintStore {
  return createMemoryStore<PaintRecord>(COLOR_HIDE_PAINT_PREFIX);
}

/** A syntactically valid PNG data URL whose decoded body is ~`bytes` long. */
function pngDataUrl(bytes: number): string {
  const chars = Math.ceil(bytes / 3) * 4;
  return `data:image/png;base64,${"A".repeat(chars)}`;
}

beforeEach(() => __resetMemoryStore());

describe("commitPaint — save path", () => {
  it("stores a valid paint and exposes it via getPaints (other clients read the same store)", async () => {
    const store = freshStore();
    const res = await commitPaint(store, "room1", "p1", pngDataUrl(2048), 1000);
    expect(res.ok).toBe(true);

    // A different client reading the room gets the same paint back (sync).
    const paints = await getPaints(store, "room1");
    expect(Object.keys(paints)).toEqual(["p1"]);
    expect(paints.p1.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("rejects an over-cap payload without storing it", async () => {
    const store = freshStore();
    const res = await commitPaint(store, "room1", "p1", pngDataUrl(MAX_PAINT_BYTES + 8192), 1000);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("invalid_paint");
    expect(await getPaints(store, "room1")).toEqual({});
  });

  it("rematch: a later commit overwrites the carried-over paint (latest-wins, per-commit)", async () => {
    // Paint is per-room (not per-round), so a prior round's design carries over as
    // the editing start point. A fresh commit in the next round must replace it —
    // the previous save never silently becomes the new round's confirmed paint.
    const store = freshStore();
    const prev = pngDataUrl(512);
    const next = pngDataUrl(4096); // different body length → distinguishable
    expect((await commitPaint(store, "room1", "p1", prev, 1000)).ok).toBe(true);
    expect((await getPaints(store, "room1")).p1).toBe(prev);
    // A rematch happens; the player repaints and re-commits (well past the rate gate).
    const re = await commitPaint(store, "room1", "p1", next, 1000 + PAINT_COMMIT_MIN_INTERVAL_MS + 60_000);
    expect(re.ok).toBe(true);
    const after = await getPaints(store, "room1");
    expect(after.p1).toBe(next); // new round's save wins
    expect(after.p1).not.toBe(prev);
  });

  it("rejects a disallowed format (svg can carry script)", async () => {
    const store = freshStore();
    const res = await commitPaint(store, "room1", "p1", "data:image/svg+xml;base64,QUJD", 1000);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("invalid_paint");
  });

  it("rejects a non-string / non-data-URL payload", async () => {
    const store = freshStore();
    expect((await commitPaint(store, "room1", "p1", 42, 1000)).ok).toBe(false);
    expect((await commitPaint(store, "room1", "p1", "https://evil/x.png", 1000)).ok).toBe(false);
  });

  it("rate-limits rapid re-commits from the same player", async () => {
    const store = freshStore();
    expect((await commitPaint(store, "room1", "p1", pngDataUrl(1024), 1000)).ok).toBe(true);
    // Too soon → rejected.
    const tooSoon = await commitPaint(store, "room1", "p1", pngDataUrl(1024), 1000 + PAINT_COMMIT_MIN_INTERVAL_MS - 1);
    expect(tooSoon.ok).toBe(false);
    if (!tooSoon.ok) expect(tooSoon.error).toBe("rate_limited");
    // After the interval → allowed (re-send / redraw works).
    const later = await commitPaint(store, "room1", "p1", pngDataUrl(1024), 1000 + PAINT_COMMIT_MIN_INTERVAL_MS);
    expect(later.ok).toBe(true);
  });

  it("lets an existing player update their paint even when the room is full", async () => {
    const store = freshStore();
    let t = 1000;
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const r = await commitPaint(store, "room1", `p${i}`, pngDataUrl(512), t);
      expect(r.ok).toBe(true);
      t += PAINT_COMMIT_MIN_INTERVAL_MS;
    }
    // A brand-new player beyond the cap is rejected...
    const overflow = await commitPaint(store, "room1", "pNEW", pngDataUrl(512), t);
    expect(overflow.ok).toBe(false);
    // ...but an existing player can still redraw.
    const update = await commitPaint(store, "room1", "p0", pngDataUrl(512), t + PAINT_COMMIT_MIN_INTERVAL_MS);
    expect(update.ok).toBe(true);
    expect(Object.keys(await getPaints(store, "room1")).length).toBe(MAX_PLAYERS);
  });

  it("keeps each player's paint isolated (per-room, per-player)", async () => {
    const store = freshStore();
    await commitPaint(store, "roomA", "p1", pngDataUrl(512), 1000);
    await commitPaint(store, "roomB", "p1", pngDataUrl(512), 1000);
    expect(Object.keys(await getPaints(store, "roomA"))).toEqual(["p1"]);
    expect(await getPaints(store, "roomB")).toHaveProperty("p1");
    // Rooms don't bleed into each other.
    expect(Object.keys(await getPaints(store, "roomA")).length).toBe(1);
  });
});
