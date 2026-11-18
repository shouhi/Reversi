import { describe, it, expect } from "vitest";
import {
  applyRadialDeadzone,
  BTN,
  DEFAULT_GAMEPAD_SETTINGS,
  EdgeDetector,
  isStandardMapping,
  loadGamepadSettings,
  readStandardGamepad,
  type GamepadSnapshot,
} from "./gamepad";

/** Build a standard-mapping snapshot with chosen axes + pressed button indices. */
function mockPad(opts: {
  axes?: number[];
  pressed?: number[];
  mapping?: string;
}): GamepadSnapshot {
  const axes = opts.axes ?? [0, 0, 0, 0];
  const pressedSet = new Set(opts.pressed ?? []);
  const buttons = Array.from({ length: 17 }, (_, i) => ({
    pressed: pressedSet.has(i),
    value: pressedSet.has(i) ? 1 : 0,
  }));
  return { mapping: opts.mapping ?? "standard", axes, buttons };
}

describe("applyRadialDeadzone", () => {
  it("zeroes inputs inside the deadzone", () => {
    expect(applyRadialDeadzone(0.1, 0.1, 0.2)).toEqual({ x: 0, y: 0 });
    expect(applyRadialDeadzone(0, 0, 0.2)).toEqual({ x: 0, y: 0 });
  });
  it("rescales just past the deadzone (smooth, starts near 0)", () => {
    const r = applyRadialDeadzone(0.3, 0, 0.2);
    expect(r.y).toBe(0);
    expect(r.x).toBeGreaterThan(0);
    expect(r.x).toBeLessThan(0.2); // (0.3-0.2)/(1-0.2) = 0.125
  });
  it("passes a full-deflection input through at magnitude ~1", () => {
    const r = applyRadialDeadzone(1, 0, 0.2);
    expect(r.x).toBeCloseTo(1);
  });
});

describe("isStandardMapping", () => {
  it("accepts standard, rejects others/null", () => {
    expect(isStandardMapping({ mapping: "standard" })).toBe(true);
    expect(isStandardMapping({ mapping: "" })).toBe(false);
    expect(isStandardMapping(null)).toBe(false);
  });
});

describe("readStandardGamepad", () => {
  it("returns null for a non-standard mapping (never guessed)", () => {
    expect(readStandardGamepad(mockPad({ mapping: "" }))).toBeNull();
  });

  it("maps the left stick to move, with stick-up = forward (+Y)", () => {
    const r = readStandardGamepad(mockPad({ axes: [0, -1, 0, 0] }))!; // push up
    expect(r.moveY).toBeCloseTo(1);
    expect(r.moveX).toBeCloseTo(0);
    const right = readStandardGamepad(mockPad({ axes: [1, 0, 0, 0] }))!;
    expect(right.moveX).toBeCloseTo(1);
  });

  it("normalizes diagonal movement to unit length (no speed boost)", () => {
    // Full up-right stick + no d-pad: magnitude must be ≤ 1.
    const r = readStandardGamepad(mockPad({ axes: [0.9, -0.9, 0, 0] }))!;
    expect(Math.hypot(r.moveX, r.moveY)).toBeLessThanOrEqual(1.0001);
    // Stick + d-pad combo must also clamp to 1 (can't exceed single-axis speed).
    const combo = readStandardGamepad(
      mockPad({ axes: [1, -1, 0, 0], pressed: [BTN.DRIGHT, BTN.DUP] }),
    )!;
    expect(Math.hypot(combo.moveX, combo.moveY)).toBeLessThanOrEqual(1.0001);
  });

  it("reads the d-pad as movement too", () => {
    const r = readStandardGamepad(mockPad({ pressed: [BTN.DUP] }))!;
    expect(r.moveY).toBeCloseTo(1);
  });

  it("maps ZR→run and ZL→crouch", () => {
    expect(readStandardGamepad(mockPad({ pressed: [BTN.R2] }))!.run).toBe(true);
    expect(readStandardGamepad(mockPad({ pressed: [BTN.L2] }))!.crouch).toBe(true);
  });

  it("exposes action buttons by function/position (not physical label)", () => {
    const r = readStandardGamepad(mockPad({ pressed: [BTN.WEST, BTN.SOUTH] }))!;
    expect(r.buttons.openPaint).toBe(true); // WEST
    expect(r.buttons.confirm).toBe(true); // SOUTH
    expect(r.buttons.cancel).toBe(false); // EAST not pressed
  });

  it("applies the camera look sensitivity (linear) and invert-Y setting", () => {
    const s1 = readStandardGamepad(mockPad({ axes: [0, 0, 1, 1] }), {
      ...DEFAULT_GAMEPAD_SETTINGS,
      lookSensitivity: 1,
      invertY: false,
    })!;
    const s2 = readStandardGamepad(mockPad({ axes: [0, 0, 1, 1] }), {
      ...DEFAULT_GAMEPAD_SETTINGS,
      lookSensitivity: 2,
      invertY: false,
    })!;
    expect(s1.lookX).toBeGreaterThan(0);
    expect(s1.lookY).toBeGreaterThan(0);
    expect(s2.lookX).toBeCloseTo(s1.lookX * 2, 5); // sensitivity scales linearly
    const inv = readStandardGamepad(mockPad({ axes: [0, 0, 1, 1] }), {
      ...DEFAULT_GAMEPAD_SETTINGS,
      invertY: true,
    })!;
    expect(Math.sign(inv.lookY)).toBe(-1);
  });

  it("respects the deadzone (small drift reads as no movement)", () => {
    const r = readStandardGamepad(mockPad({ axes: [0.1, 0.1, 0, 0] }), {
      ...DEFAULT_GAMEPAD_SETTINGS,
      deadzone: 0.2,
    })!;
    expect(r.moveX).toBe(0);
    expect(r.moveY).toBe(0);
  });
});

describe("EdgeDetector", () => {
  it("fires once on a false→true transition, not while held", () => {
    const e = new EdgeDetector();
    expect(e.fire(false)).toBe(false);
    expect(e.fire(true)).toBe(true); // rising edge
    expect(e.fire(true)).toBe(false); // held — no repeat
    expect(e.fire(false)).toBe(false);
    expect(e.fire(true)).toBe(true); // pressed again
  });
  it("reset() clears the remembered state", () => {
    const e = new EdgeDetector();
    e.fire(true);
    e.reset();
    expect(e.fire(true)).toBe(true); // treated as a fresh press after reset
  });
});

describe("loadGamepadSettings", () => {
  it("returns safe defaults under SSR (no window)", () => {
    // In the vitest node environment there is no window → defaults.
    expect(loadGamepadSettings()).toEqual(DEFAULT_GAMEPAD_SETTINGS);
  });
});
