import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  AUDIO_PREFS_KEY,
  AudioEngine,
  DEFAULT_AUDIO_PREFS,
  SFX_NAMES,
  SfxThrottle,
  clampVolume,
  loadAudioPrefs,
  resolveGain,
  saveAudioPrefs,
} from "./audio";

// Minimal in-memory localStorage + window so the prefs round-trip is testable
// without jsdom. Removed after each test so it can't leak into other suites.
function installFakeWindow() {
  const store = new Map<string, string>();
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
  };
  return store;
}

describe("clampVolume", () => {
  it("clamps to [0,1] and rejects non-finite", () => {
    expect(clampVolume(-1)).toBe(0);
    expect(clampVolume(2)).toBe(1);
    expect(clampVolume(0.42)).toBe(0.42);
    expect(clampVolume(NaN)).toBe(DEFAULT_AUDIO_PREFS.volume);
  });
});

describe("resolveGain", () => {
  it("is 0 when muted, else volume × base", () => {
    expect(resolveGain(0.5, true, 0.4)).toBe(0);
    expect(resolveGain(0.5, false, 0.4)).toBeCloseTo(0.2);
    expect(resolveGain(2, false, 1)).toBe(1); // volume clamped
  });
});

describe("audio prefs persistence", () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("returns defaults with no window (SSR) and no stored value", () => {
    delete (globalThis as { window?: unknown }).window;
    expect(loadAudioPrefs()).toEqual(DEFAULT_AUDIO_PREFS);
  });

  it("round-trips muted + volume through storage", () => {
    const store = installFakeWindow();
    saveAudioPrefs({ muted: true, volume: 0.3 });
    expect(store.get(AUDIO_PREFS_KEY)).toContain('"muted":true');
    expect(loadAudioPrefs()).toEqual({ muted: true, volume: 0.3 });
  });

  it("sanitizes a corrupt stored value", () => {
    const store = installFakeWindow();
    store.set(AUDIO_PREFS_KEY, '{"muted":"nope","volume":999}');
    const p = loadAudioPrefs();
    expect(p.muted).toBe(false); // bad type → default
    expect(p.volume).toBe(1); // clamped
  });
});

describe("SfxThrottle", () => {
  it("blocks repeats inside the window, allows after it", () => {
    const t = new SfxThrottle(100);
    expect(t.allow("step", 0)).toBe(true);
    expect(t.allow("step", 50)).toBe(false); // too soon
    expect(t.allow("step", 100)).toBe(true); // window elapsed
  });

  it("tracks cues independently", () => {
    const t = new SfxThrottle(100);
    expect(t.allow("a", 0)).toBe(true);
    expect(t.allow("b", 10)).toBe(true); // different cue, not blocked by "a"
  });

  it("honors a per-call override interval", () => {
    const t = new SfxThrottle(100);
    expect(t.allow("x", 0, 20)).toBe(true);
    expect(t.allow("x", 25, 20)).toBe(true);
  });
});

describe("SFX catalog — fairness / security", () => {
  it("has NO discovery/spotted/reveal cue (no independent server discovery event)", () => {
    for (const n of SFX_NAMES) {
      expect(n.toLowerCase()).not.toMatch(/spot|discover|reveal|detect|found/);
    }
  });

  it("includes the required server-authoritative catch cues", () => {
    expect(SFX_NAMES).toContain("catchSuccess");
    expect(SFX_NAMES).toContain("caught");
  });
});

describe("AudioEngine (no AudioContext available)", () => {
  beforeEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("constructs and no-ops safely without Web Audio (SSR/tests)", () => {
    const e = new AudioEngine({ muted: false, volume: 0.5 });
    expect(() => e.play("ui")).not.toThrow();
    expect(() => e.resume()).not.toThrow();
    expect(() => e.dispose()).not.toThrow();
  });

  it("play() is a no-op when muted (never reaches synthesis)", () => {
    const e = new AudioEngine({ muted: true, volume: 1 });
    expect(() => e.play("win")).not.toThrow();
    expect(e.getPrefs().muted).toBe(true);
  });
});
