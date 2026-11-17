"use client";

import { useRef } from "react";
import type { GameInput } from "./three/GameScene";

/**
 * Touch controls: a left virtual stick for movement and right-side action buttons.
 * They write straight into the shared {@link GameInput} ref the scene reads each
 * frame, so there is no per-touch React re-render. `touch-action: none` on the
 * stick stops the page from scrolling under a thumb.
 */
export default function MobileControls({
  input,
  isSeeker,
  onPoseCycle,
}: {
  input: React.MutableRefObject<GameInput>;
  isSeeker: boolean;
  onPoseCycle: () => void;
}) {
  const baseRef = useRef<HTMLDivElement>(null);
  const activeId = useRef<number | null>(null);

  const updateStick = (clientX: number, clientY: number) => {
    const base = baseRef.current;
    if (!base) return;
    const r = base.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    let dx = (clientX - cx) / (r.width / 2);
    let dy = (clientY - cy) / (r.height / 2);
    const len = Math.hypot(dx, dy);
    if (len > 1) {
      dx /= len;
      dy /= len;
    }
    input.current.move.x = dx;
    input.current.move.y = -dy; // screen-up = forward
  };

  const resetStick = () => {
    input.current.move.x = 0;
    input.current.move.y = 0;
    activeId.current = null;
  };

  return (
    <>
      {/* Movement stick (bottom-left) */}
      <div
        ref={baseRef}
        onPointerDown={(e) => {
          activeId.current = e.pointerId;
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          updateStick(e.clientX, e.clientY);
        }}
        onPointerMove={(e) => {
          if (activeId.current === e.pointerId) updateStick(e.clientX, e.clientY);
        }}
        onPointerUp={resetStick}
        onPointerCancel={resetStick}
        className="absolute bottom-6 left-6 h-28 w-28 rounded-full border border-white/20 bg-white/5"
        style={{ touchAction: "none" }}
        aria-label="移動スティック"
      >
        <div className="absolute left-1/2 top-1/2 h-10 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/25" />
      </div>

      {/* Action buttons (bottom-right) */}
      <div className="absolute bottom-6 right-6 flex flex-col items-end gap-2" style={{ touchAction: "none" }}>
        {isSeeker ? (
          <button
            type="button"
            onPointerDown={() => {
              input.current.catchReq = true;
            }}
            className="h-16 w-16 rounded-full bg-amber-500 text-sm font-bold text-black"
          >
            捕まえる
          </button>
        ) : (
          <button
            type="button"
            onPointerDown={() => onPoseCycle()}
            className="h-14 w-14 rounded-full bg-white/15 text-xs font-semibold text-white"
          >
            ポーズ
          </button>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onPointerDown={() => {
              input.current.running = true;
            }}
            onPointerUp={() => {
              input.current.running = false;
            }}
            onPointerCancel={() => {
              input.current.running = false;
            }}
            className="h-12 w-12 rounded-full bg-white/15 text-xs font-semibold text-white"
          >
            走る
          </button>
          {isSeeker ? (
            <button
              type="button"
              onPointerDown={() => onPoseCycle()}
              className="h-12 w-12 rounded-full bg-white/15 text-xs font-semibold text-white"
            >
              ポーズ
            </button>
          ) : null}
        </div>
      </div>
    </>
  );
}
