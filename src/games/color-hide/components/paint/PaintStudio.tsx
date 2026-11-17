"use client";

import { useEffect, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, ContactShadows } from "@react-three/drei";
import Character from "../three/Character";
import { PaintEngine } from "./PaintEngine";

/**
 * The character paint studio. Rotate the body and paint directly on its surface
 * (raycast → UV → brush). Left / one-finger paints; the ◀▶ buttons or "回す" mode
 * spin the model so you can reach the back, arms, and legs. All drawing happens on
 * a shared CanvasTexture — there is no "pick a preset skin", you actually draw.
 */

const PALETTE = [
  "#f4f4f5", "#111827", "#ef4444", "#f97316", "#f59e0b", "#eab308",
  "#84cc16", "#22c55e", "#15803d", "#06b6d4", "#3b82f6", "#8b5cf6",
  "#ec4899", "#78350f",
];

export interface PaintStudioProps {
  /** Load an existing paint (e.g. the player's last one) to keep editing. */
  initialDataUrl?: string | null;
  /** Called when the player confirms their design. */
  onCommit?: (dataUrl: string) => void;
  /** Disables the commit button while a commit is in flight. */
  committing?: boolean;
  /** Label for the confirm button. */
  commitLabel?: string;
  /** Optional countdown (ms) shown in the corner during the painting phase. */
  remainingMs?: number | null;
}

export default function PaintStudio({
  initialDataUrl,
  onCommit,
  committing = false,
  commitLabel = "この絵で準備完了",
  remainingMs,
}: PaintStudioProps) {
  const [engine, setEngine] = useState<PaintEngine | null>(null);
  const [color, setColor] = useState("#22c55e");
  const [radius, setRadius] = useState(10);
  const [erase, setErase] = useState(false);
  const [mode, setMode] = useState<"paint" | "rotate">("paint");
  const [spin, setSpin] = useState(0);
  const [, setUndoTick] = useState(0);
  const painting = useRef(false);

  // Create the paint engine only on the client (it touches `document`).
  useEffect(() => {
    const e = new PaintEngine();
    setEngine(e);
    return () => e.dispose();
  }, []);

  // Load an existing paint once the engine exists.
  useEffect(() => {
    if (engine && initialDataUrl) engine.loadDataURL(initialDataUrl).catch(() => {});
  }, [engine, initialDataUrl]);

  // End the stroke even if the pointer is released off the model.
  useEffect(() => {
    const end = () => {
      if (engine && painting.current) {
        engine.endStroke();
        painting.current = false;
      }
    };
    window.addEventListener("pointerup", end);
    return () => window.removeEventListener("pointerup", end);
  }, [engine]);

  const bump = () => setUndoTick((n) => n + 1);

  if (!engine) {
    return (
      <div className="flex h-[60vh] items-center justify-center text-muted">
        3Dスタジオを準備中…
      </div>
    );
  }

  const paintDown = (uv: { x: number; y: number }) => {
    engine.beginStroke();
    engine.paintAt(uv.x, uv.y, { color, radius, erase });
    painting.current = true;
    bump();
  };
  const paintMove = (uv: { x: number; y: number }) => {
    if (painting.current) engine.paintAt(uv.x, uv.y, { color, radius, erase });
  };
  const paintUp = () => {
    engine.endStroke();
    painting.current = false;
  };

  const seconds = remainingMs != null ? Math.ceil(remainingMs / 1000) : null;

  return (
    <div className="flex flex-col gap-3 lg:flex-row">
      {/* 3D viewport */}
      <div
        className="relative aspect-square w-full overflow-hidden rounded-xl border border-line bg-surface lg:flex-1"
        style={{ touchAction: "none" }}
      >
        {seconds != null && (
          <div className="absolute left-3 top-3 z-10 rounded-md bg-bg/70 px-2 py-1 text-sm font-semibold tabular-nums text-ink">
            残り {seconds}s
          </div>
        )}
        <div className="absolute right-3 top-3 z-10 flex gap-1">
          <button
            type="button"
            onClick={() => setMode(mode === "paint" ? "rotate" : "paint")}
            className="rounded-md bg-raised px-2 py-1 text-xs font-medium text-ink ring-1 ring-line"
          >
            {mode === "paint" ? "🖌 塗る" : "🔄 回す"}
          </button>
        </div>
        <Canvas shadows camera={{ position: [0, 1.4, 4], fov: 40 }} dpr={[1, 2]}>
          <color attach="background" args={["#0e1013"]} />
          <ambientLight intensity={0.7} />
          <directionalLight position={[3, 6, 4]} intensity={1.1} castShadow />
          <directionalLight position={[-4, 3, -2]} intensity={0.3} />
          <group rotation-y={spin} position={[0, -0.9, 0]}>
            <Character
              texture={engine.texture}
              interactive={mode === "paint"}
              onPaintDown={paintDown}
              onPaintMove={paintMove}
              onPaintUp={paintUp}
            />
          </group>
          <ContactShadows position={[0, -0.9, 0]} opacity={0.4} scale={6} blur={2.5} far={3} />
          <OrbitControls
            enablePan={false}
            enableRotate={mode === "rotate"}
            minDistance={2.4}
            maxDistance={6}
            target={[0, 0.1, 0]}
          />
        </Canvas>
      </div>

      {/* Tools */}
      <div className="flex w-full flex-col gap-4 lg:w-72">
        <div>
          <div className="mb-1.5 text-xs font-medium text-muted">カラー</div>
          <div className="grid grid-cols-7 gap-1.5">
            {PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`color ${c}`}
                onClick={() => {
                  setColor(c);
                  setErase(false);
                }}
                className="h-7 w-full rounded-md ring-1 ring-line"
                style={{
                  backgroundColor: c,
                  outline: !erase && color === c ? "2px solid var(--color-accent)" : "none",
                  outlineOffset: "1px",
                }}
              />
            ))}
          </div>
          <label className="mt-2 flex items-center gap-2 text-xs text-muted">
            自由な色
            <input
              type="color"
              value={color}
              onChange={(e) => {
                setColor(e.target.value);
                setErase(false);
              }}
              className="h-7 w-10 rounded border border-line bg-transparent"
            />
          </label>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between text-xs font-medium text-muted">
            <span>ブラシの太さ</span>
            <span className="tabular-nums text-ink">{radius}px</span>
          </div>
          <input
            type="range"
            min={2}
            max={40}
            value={radius}
            onChange={(e) => setRadius(Number(e.target.value))}
            className="w-full accent-[var(--color-accent)]"
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setErase((v) => !v)}
            className={`rounded-md px-3 py-2 text-sm font-medium ring-1 ring-line ${
              erase ? "bg-accent text-bg" : "bg-raised text-ink"
            }`}
          >
            🧽 消しゴム
          </button>
          <button
            type="button"
            onClick={() => {
              engine.fill(color);
              bump();
            }}
            className="rounded-md bg-raised px-3 py-2 text-sm font-medium text-ink ring-1 ring-line"
          >
            🪣 全体塗り
          </button>
          <button
            type="button"
            onClick={() => {
              engine.undo();
              bump();
            }}
            disabled={!engine.canUndo}
            className="rounded-md bg-raised px-3 py-2 text-sm font-medium text-ink ring-1 ring-line disabled:opacity-40"
          >
            ↩︎ 元に戻す
          </button>
          <button
            type="button"
            onClick={() => {
              engine.clear();
              bump();
            }}
            className="rounded-md bg-raised px-3 py-2 text-sm font-medium text-ink ring-1 ring-line"
          >
            🗑 全消去
          </button>
        </div>

        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => setSpin((s) => s + Math.PI / 4)}
            className="rounded-md bg-raised px-4 py-2 text-ink ring-1 ring-line"
            aria-label="左に回す"
          >
            ◀
          </button>
          <span className="text-xs text-muted">回転</span>
          <button
            type="button"
            onClick={() => setSpin((s) => s - Math.PI / 4)}
            className="rounded-md bg-raised px-4 py-2 text-ink ring-1 ring-line"
            aria-label="右に回す"
          >
            ▶
          </button>
        </div>

        {onCommit && (
          <button
            type="button"
            disabled={committing}
            onClick={() => onCommit(engine.toDataURL())}
            className="mt-1 rounded-lg bg-accent px-4 py-3 text-base font-semibold text-bg disabled:opacity-50"
          >
            {committing ? "送信中…" : commitLabel}
          </button>
        )}
      </div>
    </div>
  );
}
