"use client";

import { useRef } from "react";
import type { GameInput } from "./three/GameScene";
import { knobOffset, stickVector } from "../lib/touchInput";

/**
 * Touch controls: a left virtual stick for movement and right-side action buttons.
 * They write straight into the shared {@link GameInput} ref the scene reads each
 * frame (no per-touch React re-render), and `stopPropagation` so a thumb on a
 * control never also drives the camera look-drag. `touch-action: none` stops the
 * page scrolling under a thumb.
 */
export default function MobileControls({
  input,
  isSeeker,
  onPoseCycle,
  onCrouch,
}: {
  input: React.MutableRefObject<GameInput>;
  isSeeker: boolean;
  onPoseCycle: () => void;
  onCrouch: () => void;
}) {
  const baseRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const activeId = useRef<number | null>(null);
  const RADIUS = 46;

  // setPointerCapture throws if the pointer isn't currently active (edge races /
  // non-real pointers); capturing is a best-effort nicety, so never let it throw.
  const capture = (e: React.PointerEvent) => {
    try {
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    } catch {
      /* pointer already released — capture is optional */
    }
  };

  const updateStick = (clientX: number, clientY: number) => {
    const base = baseRef.current;
    if (!base) return;
    const v = stickVector(clientX, clientY, base.getBoundingClientRect());
    input.current.move.x = v.x;
    input.current.move.y = v.y;
    if (knobRef.current) {
      const o = knobOffset(v, RADIUS);
      knobRef.current.style.transform = `translate(calc(-50% + ${o.x}px), calc(-50% + ${o.y}px))`;
    }
  };

  const resetStick = (e: React.PointerEvent) => {
    // Only the finger that owns the stick may release it (multi-touch safety).
    if (activeId.current !== null && e.pointerId !== activeId.current) return;
    input.current.move.x = 0;
    input.current.move.y = 0;
    activeId.current = null;
    if (knobRef.current) knobRef.current.style.transform = "translate(-50%, -50%)";
  };

  // Common handler set for action buttons: never let a tap also rotate the camera,
  // and CAPTURE the pointer so a finger that slides off the button still fires
  // pointerup on it — otherwise a held "run"/"crouch" could get stuck on (Phase 11).
  const hold = (on: () => void, off?: () => void) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.stopPropagation();
      capture(e);
      on();
    },
    onPointerUp: off
      ? (e: React.PointerEvent) => {
          e.stopPropagation();
          off();
        }
      : undefined,
    onPointerCancel: off
      ? (e: React.PointerEvent) => {
          e.stopPropagation();
          off();
        }
      : undefined,
    onLostPointerCapture: off
      ? () => {
          off();
        }
      : undefined,
  });

  const btn =
    "flex items-center justify-center rounded-full bg-white/15 font-semibold text-white ring-1 ring-white/20 active:bg-white/30 select-none";

  return (
    <>
      {/* Movement stick (bottom-left) */}
      <div
        ref={baseRef}
        onPointerDown={(e) => {
          e.stopPropagation();
          if (activeId.current !== null) return; // one finger owns the stick at a time
          activeId.current = e.pointerId;
          capture(e);
          updateStick(e.clientX, e.clientY);
        }}
        onPointerMove={(e) => {
          if (activeId.current === e.pointerId) updateStick(e.clientX, e.clientY);
        }}
        onPointerUp={resetStick}
        onPointerCancel={resetStick}
        className="absolute bottom-6 left-6 h-32 w-32 rounded-full border border-white/20 bg-white/5"
        style={{ touchAction: "none" }}
        aria-label="移動スティック"
      >
        <div
          ref={knobRef}
          className="pointer-events-none absolute left-1/2 top-1/2 h-12 w-12 rounded-full bg-white/30"
          style={{ transform: "translate(-50%, -50%)" }}
        />
      </div>

      {/* Action buttons (bottom-right) */}
      <div
        className="absolute bottom-6 right-6 flex flex-col items-end gap-3"
        style={{ touchAction: "none" }}
      >
        {isSeeker ? (
          <button
            type="button"
            {...hold(() => {
              input.current.catchReq = true;
            })}
            className={`${btn} h-20 w-20 bg-amber-500 text-sm text-black ring-amber-300`}
          >
            捕まえる
          </button>
        ) : (
          <div className="flex gap-3">
            <button type="button" {...hold(onCrouch)} className={`${btn} h-14 w-14 text-xs`}>
              しゃがむ
            </button>
            <button type="button" {...hold(onPoseCycle)} className={`${btn} h-14 w-14 text-xs`}>
              ポーズ
            </button>
          </div>
        )}
        <button
          type="button"
          {...hold(
            () => {
              input.current.running = true;
            },
            () => {
              input.current.running = false;
            },
          )}
          className={`${btn} h-14 w-14 text-xs`}
        >
          走る
        </button>
      </div>
    </>
  );
}
