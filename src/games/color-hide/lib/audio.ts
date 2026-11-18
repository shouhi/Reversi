/**
 * COLOR HIDE — lightweight synthesized sound effects (Web Audio, no assets).
 *
 * All sounds are generated at runtime from oscillators + gain envelopes — there
 * are NO sampled/third-party audio files. The engine is a thin wrapper around one
 * shared AudioContext with a master gain; callers request named cues (`play`).
 *
 * SECURITY (hide-and-seek fairness): this module NEVER derives a sound from the
 * roster or from hidden state. Positional/footstep cues must be gated BY THE
 * CALLER on the server-filtered snapshot (only players the recipient may see).
 * There is no server "discovery" event, so there is deliberately no "spotted"
 * cue (see the SFX catalog note). A successful-catch cue is played only when the
 * server broadcasts `caught`.
 *
 * The pure helpers (prefs, throttle, gain) are exported and unit-tested; the
 * actual Web Audio calls no-op gracefully when AudioContext is unavailable (SSR
 * / tests / unsupported browsers).
 */

export const AUDIO_PREFS_KEY = "color-hide:audio";

export interface AudioPrefs {
  muted: boolean;
  /** Master volume 0..1. */
  volume: number;
}

export const DEFAULT_AUDIO_PREFS: AudioPrefs = { muted: false, volume: 0.6 };

/** Clamps a volume into [0, 1]; non-finite → default. */
export function clampVolume(v: number): number {
  if (!Number.isFinite(v)) return DEFAULT_AUDIO_PREFS.volume;
  return Math.min(1, Math.max(0, v));
}

export function loadAudioPrefs(): AudioPrefs {
  if (typeof window === "undefined") return { ...DEFAULT_AUDIO_PREFS };
  try {
    const raw = window.localStorage.getItem(AUDIO_PREFS_KEY);
    if (!raw) return { ...DEFAULT_AUDIO_PREFS };
    const parsed = JSON.parse(raw) as Partial<AudioPrefs>;
    return {
      muted: typeof parsed.muted === "boolean" ? parsed.muted : DEFAULT_AUDIO_PREFS.muted,
      volume: clampVolume(typeof parsed.volume === "number" ? parsed.volume : DEFAULT_AUDIO_PREFS.volume),
    };
  } catch {
    return { ...DEFAULT_AUDIO_PREFS };
  }
}

export function saveAudioPrefs(p: AudioPrefs): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(AUDIO_PREFS_KEY, JSON.stringify({ muted: p.muted, volume: clampVolume(p.volume) }));
  } catch {
    /* storage unavailable — audio still works for the session */
  }
}

/** Effective linear gain for a cue; 0 when muted (so nothing is ever audible). */
export function resolveGain(volume: number, muted: boolean, base: number): number {
  if (muted) return 0;
  return clampVolume(volume) * Math.max(0, base);
}

/**
 * Per-cue rate limiter so a rapidly-repeating trigger (footsteps, paint dabs,
 * the countdown) can't stack into a buzz. `allow` records the time only when it
 * returns true. `now`/`minMs` are injected so it is deterministic in tests.
 */
export class SfxThrottle {
  private last = new Map<string, number>();
  constructor(private readonly defaultMinMs = 60) {}

  allow(name: string, now: number, minMs?: number): boolean {
    const gap = minMs ?? this.defaultMinMs;
    const prev = this.last.get(name);
    if (prev !== undefined && now - prev < gap) return false;
    this.last.set(name, now);
    return true;
  }

  reset(): void {
    this.last.clear();
  }
}

// ---------------------------------------------------------------------------
// SFX catalog (synth recipes)
// ---------------------------------------------------------------------------

export type SfxName =
  | "ui"
  | "paintStroke"
  | "paintCommit"
  | "gameStart"
  | "phase"
  | "footstepWalk"
  | "footstepRun"
  | "catchSuccess"
  | "caught"
  | "timeWarning"
  | "win"
  | "lose";
// NOTE: there is intentionally no "spotted"/"discovery" cue — the protocol has no
// independent server discovery event, and inventing one client-side could reveal
// a hider the server did not authorize. See the module header.

interface Tone {
  type: OscillatorType;
  /** Start frequency (Hz). */
  freq: number;
  /** Optional end frequency for a linear sweep. */
  to?: number;
  /** Seconds from trigger before this tone starts. */
  at?: number;
  /** Tone length (s). */
  dur: number;
  /** Peak gain for this tone (multiplied by master + cue base). */
  gain?: number;
}

interface Recipe {
  /** Base loudness for the whole cue (0..1), before master volume. */
  base: number;
  /** Minimum ms between repeats of this cue (anti-buzz). */
  minMs: number;
  tones: Tone[];
}

const RECIPES: Record<SfxName, Recipe> = {
  ui: { base: 0.25, minMs: 40, tones: [{ type: "sine", freq: 520, dur: 0.05, gain: 0.8 }] },
  paintStroke: { base: 0.12, minMs: 90, tones: [{ type: "triangle", freq: 320, to: 360, dur: 0.05, gain: 0.6 }] },
  paintCommit: {
    base: 0.3, minMs: 200,
    tones: [
      { type: "sine", freq: 523, dur: 0.1, gain: 0.8 },
      { type: "sine", freq: 784, at: 0.08, dur: 0.14, gain: 0.8 },
    ],
  },
  gameStart: {
    base: 0.35, minMs: 500,
    tones: [
      { type: "triangle", freq: 392, dur: 0.12, gain: 0.8 },
      { type: "triangle", freq: 523, at: 0.1, dur: 0.12, gain: 0.8 },
      { type: "triangle", freq: 659, at: 0.2, dur: 0.18, gain: 0.8 },
    ],
  },
  phase: {
    base: 0.3, minMs: 300,
    tones: [
      { type: "sine", freq: 440, dur: 0.1, gain: 0.7 },
      { type: "sine", freq: 660, at: 0.09, dur: 0.14, gain: 0.7 },
    ],
  },
  footstepWalk: { base: 0.1, minMs: 180, tones: [{ type: "sine", freq: 150, to: 90, dur: 0.06, gain: 0.7 }] },
  footstepRun: { base: 0.14, minMs: 120, tones: [{ type: "sine", freq: 180, to: 100, dur: 0.05, gain: 0.8 }] },
  catchSuccess: {
    base: 0.4, minMs: 250,
    tones: [
      { type: "square", freq: 660, dur: 0.07, gain: 0.5 },
      { type: "square", freq: 990, at: 0.06, dur: 0.12, gain: 0.5 },
    ],
  },
  caught: {
    base: 0.4, minMs: 250,
    tones: [
      { type: "sawtooth", freq: 400, to: 160, dur: 0.22, gain: 0.5 },
    ],
  },
  timeWarning: { base: 0.3, minMs: 500, tones: [{ type: "square", freq: 880, dur: 0.1, gain: 0.45 }] },
  win: {
    base: 0.4, minMs: 800,
    tones: [
      { type: "triangle", freq: 523, dur: 0.12, gain: 0.8 },
      { type: "triangle", freq: 659, at: 0.1, dur: 0.12, gain: 0.8 },
      { type: "triangle", freq: 784, at: 0.2, dur: 0.12, gain: 0.8 },
      { type: "triangle", freq: 1047, at: 0.3, dur: 0.24, gain: 0.8 },
    ],
  },
  lose: {
    base: 0.38, minMs: 800,
    tones: [
      { type: "triangle", freq: 440, dur: 0.16, gain: 0.8 },
      { type: "triangle", freq: 349, at: 0.14, dur: 0.16, gain: 0.8 },
      { type: "triangle", freq: 262, at: 0.28, dur: 0.3, gain: 0.8 },
    ],
  },
};

/** The list of cue names (handy for tests / settings previews). */
export const SFX_NAMES = Object.keys(RECIPES) as SfxName[];

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

type Ctor = typeof AudioContext;

function getAudioContextCtor(): Ctor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { AudioContext?: Ctor; webkitAudioContext?: Ctor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/**
 * Minimal SFX engine. One AudioContext + master gain; cues are synthesized on
 * demand. The context starts suspended until {@link resume} is called from a user
 * gesture (browsers block autoplay) — `play` also attempts a resume opportunistically.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private prefs: AudioPrefs;
  private readonly throttle = new SfxThrottle();
  private disposed = false;

  constructor(prefs: AudioPrefs = loadAudioPrefs()) {
    this.prefs = { muted: prefs.muted, volume: clampVolume(prefs.volume) };
  }

  /** Lazily create the context (safe to call repeatedly). Returns false if unsupported. */
  private ensure(): boolean {
    if (this.disposed) return false;
    if (this.ctx && this.master) return true;
    const Ctor = getAudioContextCtor();
    if (!Ctor) return false;
    try {
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 1;
      this.master.connect(this.ctx.destination);
      return true;
    } catch {
      this.ctx = null;
      this.master = null;
      return false;
    }
  }

  /** Call from the first user gesture so the browser lets audio start. */
  resume(): void {
    if (!this.ensure() || !this.ctx) return;
    if (this.ctx.state === "suspended") void this.ctx.resume().catch(() => {});
  }

  getPrefs(): AudioPrefs {
    return { ...this.prefs };
  }

  setMuted(muted: boolean): void {
    this.prefs = { ...this.prefs, muted };
    saveAudioPrefs(this.prefs);
  }

  setVolume(volume: number): void {
    this.prefs = { ...this.prefs, volume: clampVolume(volume) };
    saveAudioPrefs(this.prefs);
  }

  /**
   * Play a cue. No-ops when muted, throttled, disposed, or unsupported. `now` is
   * injectable for tests; defaults to the audio clock.
   */
  play(name: SfxName, now?: number): void {
    if (this.prefs.muted || this.disposed) return;
    const recipe = RECIPES[name];
    if (!recipe) return;
    if (!this.ensure() || !this.ctx || !this.master) return;
    if (this.ctx.state === "suspended") this.resume();

    const t = now ?? this.ctx.currentTime * 1000;
    if (!this.throttle.allow(name, t, recipe.minMs)) return;

    const cueGain = resolveGain(this.prefs.volume, this.prefs.muted, recipe.base);
    if (cueGain <= 0) return;

    const start = this.ctx.currentTime;
    for (const tone of recipe.tones) {
      this.schedule(tone, start, cueGain);
    }
  }

  private schedule(tone: Tone, start: number, cueGain: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    const peak = cueGain * (tone.gain ?? 1);
    const at = start + (tone.at ?? 0);
    const end = at + tone.dur;

    osc.type = tone.type;
    osc.frequency.setValueAtTime(tone.freq, at);
    if (tone.to !== undefined) osc.frequency.linearRampToValueAtTime(tone.to, end);

    // Short attack + exponential-ish decay to avoid clicks and sudden jumps.
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(peak, at + Math.min(0.012, tone.dur * 0.4));
    g.gain.linearRampToValueAtTime(0.0001, end);

    osc.connect(g);
    g.connect(this.master!);
    osc.start(at);
    osc.stop(end + 0.02);
    // Let the nodes be GC'd when done.
    osc.onended = () => {
      try {
        osc.disconnect();
        g.disconnect();
      } catch {
        /* already gone */
      }
    };
  }

  /** Suspend output (e.g. tab hidden / round left) without tearing down. */
  suspend(): void {
    if (this.ctx && this.ctx.state === "running") void this.ctx.suspend().catch(() => {});
  }

  /** Stop everything and release the context (call on round/page teardown). */
  dispose(): void {
    this.disposed = true;
    this.throttle.reset();
    try {
      this.master?.disconnect();
    } catch {
      /* ignore */
    }
    const ctx = this.ctx;
    this.ctx = null;
    this.master = null;
    if (ctx && ctx.state !== "closed") void ctx.close().catch(() => {});
  }
}

/**
 * Process-wide singleton used by the game UI. One AudioContext per page is both
 * sufficient and friendlier to the browser's autoplay policy than many. Lives for
 * the session (short cues never linger); call {@link AudioEngine.resume} from a
 * user gesture to unlock it.
 */
let shared: AudioEngine | null = null;
export function sharedAudio(): AudioEngine {
  if (!shared) shared = new AudioEngine();
  return shared;
}
