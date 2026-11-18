"use client";

import { useState } from "react";
import { sharedAudio, loadAudioPrefs } from "../lib/audio";

/**
 * Compact mute toggle + volume slider for the SFX engine. Persists to
 * localStorage (via the engine) and unlocks/plays a tick on unmute so the player
 * hears it working. State is local but reads the shared engine, so the value is
 * consistent wherever this is mounted.
 */
export default function AudioSettings({ className = "" }: { className?: string }) {
  const [prefs, setPrefs] = useState(loadAudioPrefs);
  const engine = sharedAudio();

  const toggleMute = () => {
    const next = !prefs.muted;
    engine.setMuted(next);
    setPrefs(engine.getPrefs());
    if (!next) {
      engine.resume();
      engine.play("ui");
    }
  };

  const changeVolume = (v: number) => {
    engine.setVolume(v);
    setPrefs(engine.getPrefs());
  };

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <button
        type="button"
        onClick={toggleMute}
        aria-pressed={prefs.muted}
        aria-label={prefs.muted ? "音を消しています" : "音を鳴らしています"}
        title={prefs.muted ? "ミュート中" : "音あり"}
        className="rounded-md bg-raised px-2 py-1 text-sm text-ink ring-1 ring-line"
      >
        {prefs.muted ? "🔇" : "🔊"}
      </button>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={prefs.volume}
        disabled={prefs.muted}
        aria-label="音量"
        onChange={(e) => changeVolume(Number(e.target.value))}
        onPointerUp={() => engine.play("ui")}
        className="h-1 w-20 accent-[var(--color-accent)] disabled:opacity-40"
      />
    </div>
  );
}
