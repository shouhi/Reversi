import { describe, it, expect } from "vitest";
import {
  advancePhase,
  hidersCanMove,
  paintWindowOpen,
  phaseDurationMs,
  phaseEndsAt,
  remainingMs,
  seekerCanSeek,
} from "./phases";
import {
  PREPARING_MS,
  PAINTING_MS,
  HIDING_MS,
  SEEKING_MS,
} from "./constants";

describe("phase durations", () => {
  it("lobby is untimed; timed phases report their constants", () => {
    expect(phaseDurationMs("lobby")).toBeNull();
    expect(phaseDurationMs("preparing")).toBe(PREPARING_MS);
    expect(phaseDurationMs("painting")).toBe(PAINTING_MS);
    expect(phaseDurationMs("hiding")).toBe(HIDING_MS);
    expect(phaseDurationMs("seeking")).toBe(SEEKING_MS);
  });

  it("phaseEndsAt / remainingMs are null for lobby and clamped to >= 0", () => {
    expect(phaseEndsAt(1000, "lobby")).toBeNull();
    expect(remainingMs(1000, "lobby", 5000)).toBeNull();
    expect(remainingMs(1000, "painting", 1000)).toBe(PAINTING_MS);
    // Past the end → clamped to 0, never negative.
    expect(remainingMs(1000, "painting", 1000 + PAINTING_MS + 5000)).toBe(0);
  });
});

describe("advancePhase", () => {
  it("does not advance before the phase elapses", () => {
    const now = 10_000;
    const pos = { phase: "painting" as const, phaseStartedAt: now };
    expect(advancePhase(pos, now + PAINTING_MS - 1)).toEqual(pos);
  });

  it("advances exactly one phase at the boundary, anchored to the boundary", () => {
    const start = 10_000;
    const next = advancePhase(
      { phase: "painting", phaseStartedAt: start },
      start + PAINTING_MS,
    );
    expect(next.phase).toBe("hiding");
    // Starts when painting ended, not at `now`, so no drift accumulates.
    expect(next.phaseStartedAt).toBe(start + PAINTING_MS);
  });

  it("Phase 10: preparing advances straight to hiding (painting is skipped)", () => {
    const start = 5_000;
    const next = advancePhase(
      { phase: "preparing", phaseStartedAt: start },
      start + PREPARING_MS,
    );
    expect(next.phase).toBe("hiding");
    expect(next.phaseStartedAt).toBe(start + PREPARING_MS);
  });

  it("rolls forward through multiple elapsed phases when the server was idle", () => {
    const start = 0;
    // Phase 10 forward path is preparing → hiding → seeking (no painting). Jump
    // past both preparing and hiding.
    const now = PREPARING_MS + HIDING_MS + 10;
    const res = advancePhase({ phase: "preparing", phaseStartedAt: start }, now);
    expect(res.phase).toBe("seeking");
    expect(res.phaseStartedAt).toBe(PREPARING_MS + HIDING_MS);
  });

  it("seeking elapses into result (round ends by time)", () => {
    const start = 1_000;
    const res = advancePhase(
      { phase: "seeking", phaseStartedAt: start },
      start + SEEKING_MS,
    );
    expect(res.phase).toBe("result");
  });

  it("lobby is a fixed point regardless of elapsed time", () => {
    const pos = { phase: "lobby" as const, phaseStartedAt: 0 };
    expect(advancePhase(pos, 10 ** 12)).toEqual(pos);
  });
});

describe("movement gating", () => {
  it("hiders move during hiding and seeking only", () => {
    expect(hidersCanMove("hiding")).toBe(true);
    expect(hidersCanMove("seeking")).toBe(true);
    expect(hidersCanMove("painting")).toBe(false);
    expect(hidersCanMove("preparing")).toBe(false);
    expect(hidersCanMove("lobby")).toBe(false);
  });

  it("seeker may only seek during the seeking phase", () => {
    expect(seekerCanSeek("seeking")).toBe(true);
    expect(seekerCanSeek("hiding")).toBe(false);
  });
});

describe("paintWindowOpen (Phase 10 server-authoritative save window)", () => {
  it("accepts paint commits in every pre-hunt phase (lobby…hiding)", () => {
    expect(paintWindowOpen("lobby")).toBe(true);
    expect(paintWindowOpen("preparing")).toBe(true);
    expect(paintWindowOpen("painting")).toBe(true); // legacy
    expect(paintWindowOpen("hiding")).toBe(true);
  });
  it("rejects commits once the hunt begins or the round is over", () => {
    expect(paintWindowOpen("seeking")).toBe(false);
    expect(paintWindowOpen("result")).toBe(false);
  });
});
