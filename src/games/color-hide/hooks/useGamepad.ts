"use client";

import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_GAMEPAD_SETTINGS,
  isStandardMapping,
  loadGamepadSettings,
  saveGamepadSettings,
  type GamepadSettings,
} from "../lib/gamepad";

/**
 * COLOR HIDE — gamepad connection status + persisted settings (Phase 10).
 *
 * Status drives the on-screen connection badge; settings (deadzone / look
 * sensitivity / invert-Y) persist in localStorage. Both start from stable,
 * SSR-safe defaults (disconnected / DEFAULTS) and only diverge after mount, so the
 * server markup and the first client render match (no hydration mismatch). The
 * actual per-frame polling lives in GameScene; this hook is just status + config.
 */

export type GamepadConnection =
  | { state: "none" }
  | { state: "connected"; id: string; standard: boolean }
  | { state: "disconnected" };

export interface UseGamepadResult {
  connection: GamepadConnection;
  settings: GamepadSettings;
  setSettings: (next: GamepadSettings) => void;
}

export function useGamepad(): UseGamepadResult {
  // Stable defaults for SSR + first client render.
  const [connection, setConnection] = useState<GamepadConnection>({ state: "none" });
  const [settings, setSettingsState] = useState<GamepadSettings>(DEFAULT_GAMEPAD_SETTINGS);

  // Load persisted settings after mount (client-only → no hydration mismatch).
  useEffect(() => {
    setSettingsState(loadGamepadSettings());
  }, []);

  // Track connect / disconnect. On an event we re-scan getGamepads() to pick the
  // first live pad and report whether its mapping is the standard one we support.
  useEffect(() => {
    if (typeof navigator === "undefined" || !("getGamepads" in navigator)) return;

    const rescan = () => {
      const pads = Array.from(navigator.getGamepads?.() ?? []);
      const live = pads.find((p): p is Gamepad => !!p && p.connected);
      if (live) {
        setConnection({ state: "connected", id: live.id, standard: isStandardMapping(live) });
      } else {
        setConnection((prev) => (prev.state === "connected" ? { state: "disconnected" } : prev));
      }
    };

    const onConnect = () => rescan();
    const onDisconnect = () => rescan();
    window.addEventListener("gamepadconnected", onConnect);
    window.addEventListener("gamepaddisconnected", onDisconnect);
    // A pad may already be held at mount (page reloaded) — but the browser only
    // surfaces it via an event after the first input, so rescan once anyway.
    rescan();
    return () => {
      window.removeEventListener("gamepadconnected", onConnect);
      window.removeEventListener("gamepaddisconnected", onDisconnect);
    };
  }, []);

  const setSettings = useCallback((next: GamepadSettings) => {
    setSettingsState(next);
    saveGamepadSettings(next);
  }, []);

  return { connection, settings, setSettings };
}
