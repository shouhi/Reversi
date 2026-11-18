"use client";

import { useState } from "react";
import type { GamepadConnection } from "../hooks/useGamepad";
import type { GamepadSettings } from "../lib/gamepad";

/**
 * COLOR HIDE — gamepad connection badge + settings (Phase 10).
 *
 * Shows whether a controller is connected / unsupported / disconnected and, when a
 * standard-mapping pad is present, a compact settings popover (deadzone / look
 * sensitivity / invert-Y, persisted via the parent). Keeps keyboard+mouse the
 * implicit default — the badge only calls attention to a pad when one is present.
 */
export default function GamepadHud({
  connection,
  settings,
  setSettings,
}: {
  connection: GamepadConnection;
  settings: GamepadSettings;
  setSettings: (s: GamepadSettings) => void;
}) {
  const [open, setOpen] = useState(false);

  const badge =
    connection.state === "connected"
      ? connection.standard
        ? { text: "🎮 コントローラー接続済み", cls: "text-emerald-300" }
        : { text: "🎮 非対応マッピング", cls: "text-amber-300" }
      : connection.state === "disconnected"
        ? { text: "🎮 切断されました", cls: "text-red-300" }
        : null; // "none" → keyboard/mouse: no badge

  if (!badge) return null;
  const standard = connection.state === "connected" && connection.standard;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => standard && setOpen((v) => !v)}
        className={`flex items-center gap-1.5 rounded px-2 py-0.5 text-xs ring-1 ring-line ${badge.cls} ${standard ? "cursor-pointer" : "cursor-default"}`}
        title={connection.state === "connected" ? connection.id : undefined}
      >
        {badge.text}
        {standard && <span className="opacity-70">⚙︎</span>}
      </button>

      {open && standard && (
        <div className="absolute right-0 z-40 mt-1 w-64 rounded-lg border border-line bg-surface p-3 text-xs shadow-xl">
          <div className="mb-2 font-semibold text-ink">コントローラー設定</div>

          <label className="mb-2 block text-muted">
            デッドゾーン：<span className="tabular-nums text-ink">{settings.deadzone.toFixed(2)}</span>
            <input
              type="range"
              min={0}
              max={0.6}
              step={0.01}
              value={settings.deadzone}
              onChange={(e) => setSettings({ ...settings, deadzone: Number(e.target.value) })}
              className="mt-1 w-full accent-[var(--color-accent)]"
            />
          </label>

          <label className="mb-2 block text-muted">
            カメラ感度：<span className="tabular-nums text-ink">{settings.lookSensitivity.toFixed(1)}×</span>
            <input
              type="range"
              min={0.2}
              max={3}
              step={0.1}
              value={settings.lookSensitivity}
              onChange={(e) => setSettings({ ...settings, lookSensitivity: Number(e.target.value) })}
              className="mt-1 w-full accent-[var(--color-accent)]"
            />
          </label>

          <label className="flex items-center gap-2 text-muted">
            <input
              type="checkbox"
              checked={settings.invertY}
              onChange={(e) => setSettings({ ...settings, invertY: e.target.checked })}
            />
            カメラ上下反転
          </label>

          <div className="mt-2 border-t border-line pt-2 text-[11px] leading-relaxed text-muted">
            左スティック：移動 / 右スティック：カメラ / ZR：走る / ZL：しゃがむ / X：ペイント / Y：ポーズ / A：捕まえる（鬼）/ B：閉じる
            <div className="mt-1 opacity-80">
              ※ボタン配置は標準マッピング準拠。機種により表記が異なる場合があります。
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
