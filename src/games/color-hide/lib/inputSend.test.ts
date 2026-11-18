import { describe, it, expect } from "vitest";
import {
  angleDelta,
  DEFAULT_SEND_CONFIG,
  legacyPlanInputSend,
  planInputSend,
  type InputSample,
  type SendPlanConfig,
} from "./inputSend";

const C: SendPlanConfig = DEFAULT_SEND_CONFIG;

const sample = (over: Partial<InputSample> = {}): InputSample => ({
  x: 0,
  z: 0,
  yaw: 0,
  moving: false,
  running: false,
  pose: "stand",
  ...over,
});

// ---------------------------------------------------------------------------
// Decision logic
// ---------------------------------------------------------------------------

describe("planInputSend — first send + heartbeat", () => {
  it("always sends the very first sample", () => {
    expect(planInputSend(null, sample(), Infinity, C)).toBe("initial");
  });

  it("sends a heartbeat when idle and the keepalive interval elapsed", () => {
    const p = sample();
    expect(planInputSend(p, sample(), C.heartbeatMs, C)).toBe("heartbeat");
  });

  it("stays silent when idle and nothing changed within the heartbeat window", () => {
    const p = sample();
    expect(planInputSend(p, sample(), C.heartbeatMs - 1, C)).toBe("none");
  });
});

describe("planInputSend — event-driven (state changes)", () => {
  const prev = sample({ moving: false });

  it("sends immediately on move START (once the floor elapsed)", () => {
    expect(planInputSend(prev, sample({ moving: true }), C.eventMinIntervalMs, C)).toBe("event");
  });

  it("sends immediately on move STOP — the latency-critical case", () => {
    const moving = sample({ moving: true, x: 1 });
    expect(planInputSend(moving, sample({ moving: false, x: 1 }), C.eventMinIntervalMs, C)).toBe(
      "event",
    );
  });

  it("sends on run toggle and on crouch/pose change", () => {
    expect(planInputSend(prev, sample({ running: true }), C.eventMinIntervalMs, C)).toBe("event");
    expect(planInputSend(prev, sample({ pose: "crouch" }), C.eventMinIntervalMs, C)).toBe("event");
  });

  it("floors event bursts: a change within the floor is held (not flooded)", () => {
    // A rapid toggle before the floor elapsed does not send yet.
    expect(planInputSend(prev, sample({ moving: true }), C.eventMinIntervalMs - 1, C)).toBe("none");
  });

  it("a STOP still beats steady-move priority when both apply", () => {
    const moving = sample({ moving: true, x: 0 });
    // Position also drifted, but the discrete STOP is what we report.
    const r = planInputSend(moving, sample({ moving: false, x: 5 }), C.moveIntervalMs, C);
    expect(r).toBe("event");
  });
});

describe("planInputSend — steady movement + dead-zone", () => {
  const prev = sample({ moving: true });

  it("sends at the moving rate once drift exceeds the position dead-zone", () => {
    const moved = sample({ moving: true, x: C.posEpsilon + 0.01 });
    expect(planInputSend(prev, moved, C.moveIntervalMs, C)).toBe("move");
    // Before the moving interval elapses, it holds.
    expect(planInputSend(prev, moved, C.moveIntervalMs - 1, C)).toBe("none");
  });

  it("sends on a look (yaw) change past the yaw dead-zone", () => {
    const looked = sample({ moving: true, yaw: C.yawEpsilon + 0.01 });
    expect(planInputSend(prev, looked, C.moveIntervalMs, C)).toBe("move");
  });

  it("suppresses sub-epsilon analog jitter (no send)", () => {
    const jitterPos = sample({ moving: true, x: C.posEpsilon - 0.005 });
    expect(planInputSend(prev, jitterPos, C.moveIntervalMs, C)).toBe("none");
    const jitterYaw = sample({ moving: true, yaw: C.yawEpsilon - 0.005 });
    expect(planInputSend(prev, jitterYaw, C.moveIntervalMs, C)).toBe("none");
  });
});

describe("angleDelta", () => {
  it("is symmetric and wraps across ±π", () => {
    expect(angleDelta(0, 0)).toBeCloseTo(0);
    expect(angleDelta(0.1, -0.1)).toBeCloseTo(0.2);
    // 0.1 rad past +π wraps to a small delta, not ~2π.
    expect(angleDelta(Math.PI - 0.05, -Math.PI + 0.05)).toBeCloseTo(0.1);
  });
});

// ---------------------------------------------------------------------------
// Before/After message-count measurement (deterministic frame replay @60fps).
// Inbound messages to the DO == client sends, so these ARE the inbound counts.
// ---------------------------------------------------------------------------

function simulate(
  durationMs: number,
  gen: (t: number) => InputSample,
  fps = 60,
): { sends: number; reasons: Record<string, number> } {
  const frameMs = 1000 / fps;
  let prev: InputSample | null = null;
  let lastSentAt = 0;
  let sends = 0;
  const reasons: Record<string, number> = {};
  for (let t = 0; t <= durationMs + 1e-6; t += frameMs) {
    const cur = gen(t);
    const dtSince = prev ? t - lastSentAt : Infinity;
    const r = planInputSend(prev, cur, dtSince, C);
    if (r !== "none") {
      sends += 1;
      reasons[r] = (reasons[r] ?? 0) + 1;
      lastSentAt = t;
      prev = cur;
    }
  }
  return { sends, reasons };
}

// Mirrors the OLD client exactly: a per-frame accumulator reset to 0 on each send
// (see the pre-9-E GameScene). At 60 fps a nominal-18 Hz interval (55.6 ms) only
// fires every 4th frame (66.7 ms) → an effective ~15 Hz. legacyPlanInputSend models
// the same fixed-interval gate; we assert both agree on the baseline.
function legacySends(durationMs: number, fps = 60): number {
  const frameMs = 1000 / fps;
  const interval = 1000 / 18;
  let acc = 0;
  let sends = 0;
  for (let t = 0; t <= durationMs + 1e-6; t += frameMs) {
    acc += frameMs;
    if (legacyPlanInputSend(acc, interval) !== "none") {
      sends += 1;
      acc = 0;
    }
  }
  return sends;
}

describe("message-count reduction (measured by replay)", () => {
  it("BASELINE: the old fixed-rate client sends ~15 Hz at 60fps regardless of input", () => {
    // Establishes the pre-9-E behaviour we are optimising against (the nominal 18 Hz
    // interval rounds down to ~15 Hz once gated to 60 fps frames with a zero-reset).
    expect(legacySends(1000)).toBeGreaterThanOrEqual(14);
    expect(legacySends(1000)).toBeLessThanOrEqual(18);
    expect(legacySends(5000)).toBeGreaterThanOrEqual(70); // ~75
  });

  it("STOPPED player collapses to ~1 Hz (heartbeat) — the big win", () => {
    const { sends, reasons } = simulate(5000, () => sample()); // never moves
    expect(sends).toBeLessThanOrEqual(8); // ~1 initial + ~5 heartbeats
    expect(reasons.heartbeat ?? 0).toBeGreaterThanOrEqual(4);
    // vs ~90 for the old client → ≥90% fewer inbound messages while hiding.
    expect(sends).toBeLessThan(legacySends(5000) / 5);
  });

  it("STEADY straight-line movement caps at the ~10 Hz moving rate", () => {
    // Walk in +x at 3 u/s: position drifts past the dead-zone every frame.
    const { sends } = simulate(5000, (t) => sample({ moving: true, x: 0.003 * t }));
    expect(sends).toBeGreaterThanOrEqual(45); // ~50 (10 Hz)
    expect(sends).toBeLessThanOrEqual(56);
    expect(sends).toBeLessThan(legacySends(5000)); // fewer than 18 Hz
  });

  it("MIXED (2s move, 3s still) is far below the fixed-rate baseline", () => {
    const { sends } = simulate(5000, (t) =>
      t < 2000 ? sample({ moving: true, x: 0.003 * t }) : sample({ moving: false, x: 6 }),
    );
    // ~20 (move) + 1 stop event + ~3 heartbeats ≈ 24, vs ~90 legacy.
    expect(sends).toBeLessThan(legacySends(5000) / 2);
  });
});
