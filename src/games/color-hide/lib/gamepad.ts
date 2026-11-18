/**
 * COLOR HIDE — gamepad input (Phase 10 controller support).
 *
 * PURE helpers that turn a `navigator.getGamepads()` snapshot into the SAME
 * normalized input the keyboard and touch controls produce (moveX/moveY, lookX/
 * lookY, run, crouch, and edge-triggered actions). Kept free of the DOM/React so
 * it unit-tests with a plain mock gamepad object.
 *
 * We read by the W3C "standard" mapping (by button INDEX/position, never by a
 * controller id). Nintendo pads (Pro Controller, Joy-Con) expose a standard
 * mapping in Chromium, but their PHYSICAL A/B/X/Y labels are swapped vs the
 * position indices — so we map by FUNCTION (south = confirm, east = cancel, …) and
 * leave physical-label verification to real hardware. Non-standard mappings are
 * reported as unsupported rather than guessed.
 */

/** W3C standard-mapping button indices (by position, not by printed label). */
export const BTN = {
  SOUTH: 0, // bottom face button — confirm / draw
  EAST: 1, // right face button — cancel / back
  WEST: 2, // left face button — open paint
  NORTH: 3, // top face button — pose cycle
  L1: 4,
  R1: 5,
  L2: 6, // ZL — crouch
  R2: 7, // ZR — run
  SELECT: 8,
  START: 9,
  L3: 10,
  R3: 11,
  DUP: 12,
  DDOWN: 13,
  DLEFT: 14,
  DRIGHT: 15,
} as const;

export interface GamepadSettings {
  /** Radial stick deadzone (0..0.6). Defaults high enough for Joy-Con drift. */
  deadzone: number;
  /** Camera look rate multiplier. */
  lookSensitivity: number;
  /** Invert the vertical camera axis. */
  invertY: boolean;
}

export const DEFAULT_GAMEPAD_SETTINGS: GamepadSettings = {
  deadzone: 0.2,
  lookSensitivity: 1,
  invertY: false,
};

const SETTINGS_KEY = "color-hide:gamepad-settings";
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Load persisted settings (client-only). Returns DEFAULTS on SSR / bad data. */
export function loadGamepadSettings(): GamepadSettings {
  if (typeof window === "undefined") return { ...DEFAULT_GAMEPAD_SETTINGS };
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_GAMEPAD_SETTINGS };
    const p = JSON.parse(raw) as Partial<GamepadSettings>;
    return {
      deadzone: clamp(typeof p.deadzone === "number" ? p.deadzone : DEFAULT_GAMEPAD_SETTINGS.deadzone, 0, 0.6),
      lookSensitivity: clamp(
        typeof p.lookSensitivity === "number" ? p.lookSensitivity : DEFAULT_GAMEPAD_SETTINGS.lookSensitivity,
        0.2,
        3,
      ),
      invertY: !!p.invertY,
    };
  } catch {
    return { ...DEFAULT_GAMEPAD_SETTINGS };
  }
}

export function saveGamepadSettings(s: GamepadSettings): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable — settings just won't persist */
  }
}

/**
 * Radial deadzone with re-scaling: inputs within `dz` of center read as zero, and
 * the remaining range is rescaled to 0..1 so control is smooth right past the
 * threshold (no sudden jump). Operates on the (x,y) pair so diagonal magnitude is
 * what the deadzone tests — the correct behaviour for a thumbstick.
 */
export function applyRadialDeadzone(x: number, y: number, dz: number): { x: number; y: number } {
  const mag = Math.hypot(x, y);
  if (mag <= dz || mag === 0) return { x: 0, y: 0 };
  const scaled = Math.min(1, (mag - dz) / (1 - dz));
  const k = scaled / mag;
  return { x: x * k, y: y * k };
}

/** The minimal shape we need from a Gamepad (so tests can pass a plain object). */
export interface GamepadSnapshot {
  mapping: string;
  axes: readonly number[];
  buttons: readonly { pressed: boolean; value: number }[];
}

export interface GamepadReading {
  /** Left stick / d-pad, deadzoned + normalized. moveY: +1 = forward. */
  moveX: number;
  moveY: number;
  /** Right stick, deadzoned (rate for the camera). lookY already invert-applied. */
  lookX: number;
  lookY: number;
  run: boolean;
  crouch: boolean;
  /** Current pressed state of the action buttons (caller does edge detection). */
  buttons: {
    openPaint: boolean; // WEST
    cancel: boolean; // EAST
    confirm: boolean; // SOUTH
    pose: boolean; // NORTH
    l1: boolean;
    r1: boolean;
  };
  dpad: { up: boolean; down: boolean; left: boolean; right: boolean };
}

export function isStandardMapping(gp: { mapping: string } | null | undefined): boolean {
  return !!gp && gp.mapping === "standard";
}

const pressed = (gp: GamepadSnapshot, i: number): boolean => !!gp.buttons[i]?.pressed;
const axis = (gp: GamepadSnapshot, i: number): number => gp.axes[i] ?? 0;

/**
 * Turn a standard-mapping gamepad snapshot into a normalized reading. D-pad adds
 * to the left stick (so either works), and diagonal movement is clamped to unit
 * length so a stick + d-pad combo can't exceed the single-axis speed the server
 * caps. Returns null for a non-standard mapping (we don't guess the layout).
 */
export function readStandardGamepad(
  gp: GamepadSnapshot,
  s: GamepadSettings = DEFAULT_GAMEPAD_SETTINGS,
): GamepadReading | null {
  if (!isStandardMapping(gp)) return null;

  const left = applyRadialDeadzone(axis(gp, 0), axis(gp, 1), s.deadzone);
  const right = applyRadialDeadzone(axis(gp, 2), axis(gp, 3), s.deadzone);

  const dpad = {
    up: pressed(gp, BTN.DUP),
    down: pressed(gp, BTN.DDOWN),
    left: pressed(gp, BTN.DLEFT),
    right: pressed(gp, BTN.DRIGHT),
  };

  // Combine stick + d-pad, then clamp to the unit circle (diagonal normalization).
  let moveX = left.x + (dpad.right ? 1 : 0) - (dpad.left ? 1 : 0);
  let moveY = -left.y + (dpad.up ? 1 : 0) - (dpad.down ? 1 : 0); // stick up = -axis
  const mag = Math.hypot(moveX, moveY);
  if (mag > 1) {
    moveX /= mag;
    moveY /= mag;
  }

  return {
    moveX,
    moveY,
    lookX: right.x * s.lookSensitivity,
    lookY: right.y * s.lookSensitivity * (s.invertY ? -1 : 1),
    run: pressed(gp, BTN.R2) || pressed(gp, BTN.R1),
    crouch: pressed(gp, BTN.L2) || pressed(gp, BTN.L1),
    buttons: {
      openPaint: pressed(gp, BTN.WEST),
      cancel: pressed(gp, BTN.EAST),
      confirm: pressed(gp, BTN.SOUTH),
      pose: pressed(gp, BTN.NORTH),
      l1: pressed(gp, BTN.L1),
      r1: pressed(gp, BTN.R1),
    },
    dpad,
  };
}

/**
 * Rising-edge detector for a boolean signal across polls (debounces a held button
 * so one press fires one action). Call `fire(current)` each frame; it returns true
 * only on a false→true transition.
 */
export class EdgeDetector {
  private prev = false;
  fire(current: boolean): boolean {
    const rose = current && !this.prev;
    this.prev = current;
    return rose;
  }
  reset(): void {
    this.prev = false;
  }
}
