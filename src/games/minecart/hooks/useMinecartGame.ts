"use client";

import { useEffect, useRef, type RefObject } from "react";
import type { GameStatus, Stage, World } from "../types";
import { createWorld, stepFixed } from "../lib/engine";
import { FIXED_DT, MAX_FRAME_DT } from "../lib/constants";
import { render, type Particle } from "../lib/renderer";
import type { SoundEngine } from "../lib/sound";

export interface MinecartControls {
  start: () => void;
  retry: () => void;
  jump: () => void;
  togglePause: () => void;
}

interface Opts {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  timeRef: RefObject<HTMLElement | null>;
  progressRef: RefObject<HTMLElement | null>;
  stage: Stage;
  sound: SoundEngine;
  onStatus: (s: GameStatus, meta?: { timeMs?: number }) => void;
}

interface GameRef {
  world: World;
  particles: Particle[];
  shakeX: number;
  shakeY: number;
  shakeMag: number;
  jumpQueued: boolean;
  acc: number;
  last: number;
  tSec: number;
  rafId: number;
  alive: boolean;
}

function spawn(
  particles: Particle[],
  x: number,
  y: number,
  n: number,
  colors: string[],
  spread: number,
  up: number,
): void {
  for (let i = 0; i < n; i++) {
    particles.push({
      x,
      y,
      vx: (Math.random() - 0.5) * spread,
      vy: -Math.random() * up - 40,
      life: 0.5 + Math.random() * 0.4,
      maxLife: 0.9,
      size: 2 + Math.random() * 4,
      color: colors[(Math.random() * colors.length) | 0],
    });
  }
}

export function useMinecartGame(opts: Opts): MinecartControls {
  const { canvasRef, timeRef, progressRef, stage, sound, onStatus } = opts;
  // Keep the latest onStatus without restarting the loop.
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;
  const soundRef = useRef(sound);
  soundRef.current = sound;

  const g = useRef<GameRef | null>(null);

  // Imperative controls are stable; they read the live game ref.
  const controls = useRef<MinecartControls>({
    start: () => {},
    retry: () => {},
    jump: () => {},
    togglePause: () => {},
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const game: GameRef = {
      world: createWorld(stage),
      particles: [],
      shakeX: 0,
      shakeY: 0,
      shakeMag: 0,
      jumpQueued: false,
      acc: 0,
      last: performance.now(),
      tSec: 0,
      rafId: 0,
      alive: true,
    };
    g.current = game;
    onStatusRef.current("ready");

    const beginRun = () => {
      game.world = createWorld(stage);
      game.world.status = "running";
      game.particles = [];
      game.shakeMag = 0;
      game.jumpQueued = false;
      game.acc = 0;
      onStatusRef.current("running");
    };

    controls.current = {
      start: () => {
        soundRef.current.unlock();
        if (game.world.status === "ready" || game.world.status === "dead" || game.world.status === "cleared") {
          beginRun();
        }
      },
      retry: () => {
        soundRef.current.unlock();
        beginRun();
      },
      jump: () => {
        soundRef.current.unlock();
        const st = game.world.status;
        if (st === "ready") {
          beginRun();
        } else if (st === "running") {
          game.jumpQueued = true;
        }
      },
      togglePause: () => {
        if (game.world.status === "running") {
          game.world.status = "paused";
          onStatusRef.current("paused");
        } else if (game.world.status === "paused") {
          game.world.status = "running";
          game.last = performance.now();
          onStatusRef.current("running");
        }
      },
    };

    const ensureSize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(canvas.clientWidth));
      const h = Math.max(1, Math.round(canvas.clientHeight));
      const bw = Math.round(w * dpr);
      const bh = Math.round(h * dpr);
      if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw;
        canvas.height = bh;
      }
      return { w, h, dpr };
    };

    const frame = (now: number) => {
      if (!game.alive) return;
      let dt = (now - game.last) / 1000;
      game.last = now;
      if (dt > MAX_FRAME_DT) dt = MAX_FRAME_DT;
      if (dt < 0) dt = 0;
      game.tSec += dt;

      const w = game.world;
      if (w.status === "running") {
        game.acc += dt;
        let firstStepOfFrame = true;
        while (game.acc >= FIXED_DT) {
          const jump = firstStepOfFrame && game.jumpQueued;
          if (jump) game.jumpQueued = false;
          firstStepOfFrame = false;
          const ev = stepFixed(w, stage, FIXED_DT, jump);
          if (ev.jumped) soundRef.current.play("jump");
          if (ev.landed) {
            soundRef.current.play("land");
            spawn(game.particles, w.cartX + w.cartW * 0.3, w.cartY + w.cartH, 6, ["#b9a06a", "#8a6f3e"], 120, 120);
          }
          if (ev.died) {
            const fell = w.cartY + w.cartH > stage.baseGroundY + 120;
            soundRef.current.play(fell ? "fall" : "crash");
            game.shakeMag = fell ? 6 : 14;
            spawn(game.particles, w.cartX + w.cartW / 2, w.cartY + w.cartH / 2, 22, ["#caa15a", "#8a5a2c", "#e06a5a"], 360, 320);
            onStatusRef.current("dead", { timeMs: Math.round(w.elapsed * 1000) });
            break;
          }
          if (ev.cleared) {
            soundRef.current.play("clear");
            spawn(game.particles, w.cartX + w.cartW / 2, w.cartY, 30, ["#34d399", "#f6b24a", "#ffffff"], 420, 420);
            onStatusRef.current("cleared", { timeMs: Math.round(w.elapsed * 1000) });
            break;
          }
          game.acc -= FIXED_DT;
        }
      }

      // particles update
      for (const p of game.particles) {
        p.vy += 900 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.life -= dt;
      }
      game.particles = game.particles.filter((p) => p.life > 0);

      // shake decay
      game.shakeMag *= Math.pow(0.001, dt);
      if (game.shakeMag < 0.3) game.shakeMag = 0;
      game.shakeX = (Math.random() - 0.5) * game.shakeMag;
      game.shakeY = (Math.random() - 0.5) * game.shakeMag;

      const { w: cw, h: ch, dpr } = ensureSize();
      render(ctx, cw, ch, dpr, {
        world: w,
        stage,
        particles: game.particles,
        tSec: game.tSec,
        shakeX: game.shakeX,
        shakeY: game.shakeY,
      });

      // HUD (no React render)
      if (timeRef.current) {
        const ms = Math.round(w.elapsed * 1000);
        timeRef.current.textContent = (ms / 1000).toFixed(2);
      }
      if (progressRef.current) {
        const frac = Math.max(
          0,
          Math.min(1, (w.cartX - stage.startX) / (stage.goalX - stage.startX)),
        );
        progressRef.current.style.width = `${(frac * 100).toFixed(1)}%`;
      }

      game.rafId = requestAnimationFrame(frame);
    };

    game.rafId = requestAnimationFrame(frame);

    // --- input ---
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.code === "Space" || e.code === "ArrowUp" || e.code === "KeyW") {
        e.preventDefault();
        controls.current.jump();
      } else if (e.code === "KeyR") {
        controls.current.retry();
      } else if (e.code === "Escape") {
        controls.current.togglePause();
      }
    };
    const onPointer = (e: PointerEvent) => {
      e.preventDefault();
      controls.current.jump();
    };
    const onVisibility = () => {
      if (document.hidden && game.world.status === "running") {
        controls.current.togglePause();
      }
    };
    window.addEventListener("keydown", onKey);
    canvas.addEventListener("pointerdown", onPointer);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      game.alive = false;
      cancelAnimationFrame(game.rafId);
      window.removeEventListener("keydown", onKey);
      canvas.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // Re-initialise the whole loop when the stage changes.
  }, [stage, canvasRef, timeRef, progressRef]);

  // Stable wrapper so callers get consistent function identities.
  const stable = useRef<MinecartControls>({
    start: () => controls.current.start(),
    retry: () => controls.current.retry(),
    jump: () => controls.current.jump(),
    togglePause: () => controls.current.togglePause(),
  });
  return stable.current;
}
