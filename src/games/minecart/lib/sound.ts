/**
 * Tiny WebAudio sound engine. All effects are synthesized at runtime with
 * oscillators and noise — there are NO external audio assets, so there is
 * nothing to license. The AudioContext is created lazily and resumed on the
 * first user gesture to satisfy browser autoplay policies. Fully no-op on the
 * server and when muted.
 */

export type Sfx = "jump" | "land" | "crash" | "fall" | "clear" | "ui";

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private muted = false;

  constructor(muted = false) {
    this.muted = muted;
  }

  /** Call from a user-gesture handler to create/resume the context. */
  unlock(): void {
    if (typeof window === "undefined") return;
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.6;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 0.6;
  }

  isMuted(): boolean {
    return this.muted;
  }

  dispose(): void {
    try {
      void this.ctx?.close();
    } catch {
      /* ignore */
    }
    this.ctx = null;
    this.master = null;
  }

  private tone(
    freq: number,
    dur: number,
    type: OscillatorType,
    gain: number,
    freqEnd?: number,
  ): void {
    if (!this.ctx || !this.master || this.muted) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (freqEnd !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t + dur);
    }
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private noise(dur: number, gain: number): void {
    if (!this.ctx || !this.master || this.muted) return;
    const t = this.ctx.currentTime;
    const frames = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, frames, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    // deterministic-ish noise; randomness here is cosmetic (SFX only)
    let seed = 1234;
    for (let i = 0; i < frames; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      data[i] = ((seed / 0x3fffffff) - 1) * (1 - i / frames);
    }
    const src = this.ctx.createBufferSource();
    const g = this.ctx.createGain();
    src.buffer = buf;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(g);
    g.connect(this.master);
    src.start(t);
  }

  play(sfx: Sfx): void {
    if (this.muted || !this.ctx) return;
    switch (sfx) {
      case "jump":
        this.tone(420, 0.16, "square", 0.25, 760);
        break;
      case "land":
        this.tone(200, 0.09, "sine", 0.22, 120);
        break;
      case "crash":
        this.noise(0.3, 0.5);
        this.tone(140, 0.3, "sawtooth", 0.2, 50);
        break;
      case "fall":
        this.tone(500, 0.5, "sine", 0.22, 90);
        break;
      case "clear":
        this.tone(523, 0.12, "triangle", 0.25);
        setTimeout(() => this.tone(659, 0.12, "triangle", 0.25), 110);
        setTimeout(() => this.tone(784, 0.2, "triangle", 0.25), 220);
        break;
      case "ui":
        this.tone(330, 0.06, "square", 0.15);
        break;
    }
  }
}
