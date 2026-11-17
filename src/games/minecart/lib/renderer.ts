/**
 * Canvas 2D renderer for the Minecart game. Everything is drawn procedurally
 * (shapes + gradients) — no external images — so it loads instantly and scales
 * crisply. Physics live in world units; this module maps world → device pixels.
 *
 * Draw order: screen-space parallax cave background, then a world-space transform
 * for rails/supports/obstacles/goal/cart/particles, then screen-space vignette.
 */

import type { Obstacle, Stage, World } from "../types";
import { BASE_GROUND_Y, CAMERA_LEAD, FALL_KILL_BELOW, VIEW_H } from "./constants";

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
}

export interface RenderState {
  world: World;
  stage: Stage;
  particles: Particle[];
  tSec: number;
  shakeX: number;
  shakeY: number;
}

const C = {
  bgTop: "#0e1a16",
  bgBottom: "#06100d",
  rockFar: "#13211c",
  rockMid: "#1b2d26",
  pillar: "#17241f",
  wood: "#6a4526",
  woodLight: "#8a5d32",
  woodDark: "#4a2f18",
  rail: "#7c8a84",
  railDark: "#4b5751",
  tie: "#5a3c22",
  cartBody: "#8a5a2c",
  cartBodyDark: "#5f3c1b",
  cartRim: "#d4a860",
  wheel: "#2d2824",
  wheelRim: "#b9833f",
  rock: "#394a43",
  rockEdge: "#263531",
  crate: "#7a5330",
  crateDark: "#4f351d",
  spike: "#9aa6a1",
  spikeDark: "#5d6763",
  bat: "#2b2440",
  batEye: "#f06a6a",
  lantern: "#f6b24a",
  accent: "#34d399",
};

export function cameraXFor(world: World, viewWidthWorld: number): number {
  const target = world.cartX + world.cartW / 2 - viewWidthWorld * CAMERA_LEAD;
  return Math.max(0, target);
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function drawParallax(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  cameraX: number,
  scale: number,
  tSec: number,
): void {
  // Far pillars
  const layers = [
    { factor: 0.2, spacing: 230, color: C.rockFar, top: 0.0, bw: 120 },
    { factor: 0.45, spacing: 300, color: C.pillar, top: 0.0, bw: 90 },
  ];
  for (const L of layers) {
    const off = (cameraX * L.factor * scale) % (L.spacing * scale);
    for (let x = -off - L.spacing * scale; x < w + L.spacing * scale; x += L.spacing * scale) {
      ctx.fillStyle = L.color;
      const bw = L.bw * scale;
      // stalactite-ish pillar from the top
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + bw, 0);
      ctx.lineTo(x + bw * 0.5, h * (0.45 + 0.1 * Math.sin(x)));
      ctx.closePath();
      ctx.fill();
      // base rock from the bottom
      ctx.fillRect(x, h * 0.72, bw, h * 0.28);
    }
  }

  // Hanging lanterns (mid layer) — warm pools of light
  const lanternSpacing = 360 * scale;
  const loff = (cameraX * 0.55 * scale) % lanternSpacing;
  for (let x = -loff; x < w + lanternSpacing; x += lanternSpacing) {
    const ly = h * 0.22 + Math.sin(tSec * 1.5 + x) * 3 * scale;
    // chain
    ctx.strokeStyle = "#3a4a44";
    ctx.lineWidth = Math.max(1, 1.5 * scale);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, ly);
    ctx.stroke();
    // glow
    const grd = ctx.createRadialGradient(x, ly, 0, x, ly, 90 * scale);
    grd.addColorStop(0, "rgba(246,178,74,0.35)");
    grd.addColorStop(1, "rgba(246,178,74,0)");
    ctx.fillStyle = grd;
    ctx.fillRect(x - 90 * scale, ly - 90 * scale, 180 * scale, 180 * scale);
    // lantern body
    ctx.fillStyle = C.lantern;
    roundRect(ctx, x - 7 * scale, ly, 14 * scale, 18 * scale, 3 * scale);
    ctx.fill();
  }
}

function drawPlatform(
  ctx: CanvasRenderingContext2D,
  x: number,
  width: number,
  y: number,
): void {
  const bottom = BASE_GROUND_Y + FALL_KILL_BELOW + 300;
  // rock body under the rail
  const grd = ctx.createLinearGradient(0, y, 0, bottom);
  grd.addColorStop(0, C.rockMid);
  grd.addColorStop(1, "#0a130f");
  ctx.fillStyle = grd;
  ctx.fillRect(x - 2, y + 10, width + 4, bottom - y);

  // top soil edge
  ctx.fillStyle = "#223029";
  ctx.fillRect(x - 2, y + 6, width + 4, 8);

  // ties
  ctx.fillStyle = C.tie;
  const tieStep = 26;
  for (let tx = x + 6; tx < x + width - 4; tx += tieStep) {
    ctx.fillRect(tx, y + 2, 12, 9);
  }

  // rails (two metallic lines)
  ctx.fillStyle = C.railDark;
  ctx.fillRect(x, y - 1, width, 4);
  ctx.fillStyle = C.rail;
  ctx.fillRect(x, y - 1, width, 2);

  // support posts going down
  ctx.fillStyle = C.woodDark;
  const postStep = 120;
  for (let px = x + 30; px < x + width - 20; px += postStep) {
    ctx.fillRect(px, y + 14, 10, 150);
    ctx.fillRect(px - 16, y + 60, 42, 8); // cross brace
  }
}

function drawGapPit(
  ctx: CanvasRenderingContext2D,
  x1: number,
  x2: number,
  y: number,
): void {
  const bottom = BASE_GROUND_Y + FALL_KILL_BELOW + 300;
  const grd = ctx.createLinearGradient(0, y, 0, bottom);
  grd.addColorStop(0, "#0a120f");
  grd.addColorStop(1, "#02060550");
  ctx.fillStyle = grd;
  ctx.fillRect(x1, y + 6, x2 - x1, bottom - y);
}

function drawObstacle(
  ctx: CanvasRenderingContext2D,
  o: Obstacle,
  tSec: number,
): void {
  if (o.kind === "bat") {
    const cx = o.x + o.width / 2;
    const cy = o.y + o.height / 2 + Math.sin(tSec * 6 + o.x) * 4;
    const flap = Math.sin(tSec * 14 + o.x) * 0.5 + 0.5;
    ctx.fillStyle = C.bat;
    // body
    ctx.beginPath();
    ctx.ellipse(cx, cy, 8, 9, 0, 0, Math.PI * 2);
    ctx.fill();
    // wings
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.quadraticCurveTo(cx - 20, cy - 8 - flap * 8, cx - 26, cy + 6);
    ctx.quadraticCurveTo(cx - 14, cy + 2, cx, cy + 4);
    ctx.moveTo(cx, cy);
    ctx.quadraticCurveTo(cx + 20, cy - 8 - flap * 8, cx + 26, cy + 6);
    ctx.quadraticCurveTo(cx + 14, cy + 2, cx, cy + 4);
    ctx.fill();
    // eyes
    ctx.fillStyle = C.batEye;
    ctx.fillRect(cx - 4, cy - 2, 2, 2);
    ctx.fillRect(cx + 2, cy - 2, 2, 2);
    return;
  }
  if (o.kind === "spike") {
    const n = Math.max(1, Math.round(o.width / 16));
    const sw = o.width / n;
    for (let i = 0; i < n; i++) {
      const sx = o.x + i * sw;
      ctx.fillStyle = C.spike;
      ctx.beginPath();
      ctx.moveTo(sx, o.y + o.height);
      ctx.lineTo(sx + sw / 2, o.y);
      ctx.lineTo(sx + sw, o.y + o.height);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = C.spikeDark;
      ctx.beginPath();
      ctx.moveTo(sx + sw / 2, o.y);
      ctx.lineTo(sx + sw, o.y + o.height);
      ctx.lineTo(sx + sw * 0.72, o.y + o.height);
      ctx.closePath();
      ctx.fill();
    }
    return;
  }
  if (o.kind === "crate") {
    ctx.fillStyle = C.crate;
    roundRect(ctx, o.x, o.y, o.width, o.height, 4);
    ctx.fill();
    ctx.strokeStyle = C.crateDark;
    ctx.lineWidth = 4;
    ctx.strokeRect(o.x + 2, o.y + 2, o.width - 4, o.height - 4);
    ctx.beginPath();
    ctx.moveTo(o.x + 3, o.y + 3);
    ctx.lineTo(o.x + o.width - 3, o.y + o.height - 3);
    ctx.moveTo(o.x + o.width - 3, o.y + 3);
    ctx.lineTo(o.x + 3, o.y + o.height - 3);
    ctx.stroke();
    return;
  }
  // rock
  ctx.fillStyle = C.rock;
  ctx.beginPath();
  const x = o.x;
  const y = o.y;
  const w = o.width;
  const h = o.height;
  ctx.moveTo(x, y + h);
  ctx.lineTo(x + w * 0.1, y + h * 0.35);
  ctx.lineTo(x + w * 0.4, y + h * 0.05);
  ctx.lineTo(x + w * 0.75, y + h * 0.2);
  ctx.lineTo(x + w, y + h * 0.55);
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = C.rockEdge;
  ctx.lineWidth = 3;
  ctx.stroke();
}

function drawGoal(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  const topY = y - 190;
  // posts
  ctx.fillStyle = C.wood;
  ctx.fillRect(x - 6, topY, 12, 190);
  ctx.fillRect(x + 90 - 6, topY, 12, 190);
  // crossbar
  ctx.fillStyle = C.woodLight;
  ctx.fillRect(x - 10, topY, 110, 16);
  // banner
  ctx.fillStyle = C.accent;
  ctx.beginPath();
  ctx.moveTo(x + 18, topY + 16);
  ctx.lineTo(x + 72, topY + 16);
  ctx.lineTo(x + 72, topY + 58);
  ctx.lineTo(x + 45, topY + 46);
  ctx.lineTo(x + 18, topY + 58);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#0e1a16";
  ctx.font = "bold 26px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("★", x + 45, topY + 44);
  ctx.textAlign = "left";
}

function drawCart(ctx: CanvasRenderingContext2D, w: World): void {
  const x = w.cartX;
  const y = w.cartY;
  const cw = w.cartW;
  const ch = w.cartH;
  const cx = x + cw / 2;
  const cy = y + ch / 2;
  const tilt = Math.max(-0.22, Math.min(0.22, w.vy / 4200));

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(tilt);
  ctx.translate(-cx, -cy);

  // wheels
  const wheelR = ch * 0.34;
  const wy = y + ch - wheelR * 0.5;
  for (const wx of [x + cw * 0.26, x + cw * 0.74]) {
    ctx.fillStyle = C.wheel;
    ctx.beginPath();
    ctx.arc(wx, wy, wheelR, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = C.wheelRim;
    ctx.lineWidth = 3;
    ctx.stroke();
    // spokes
    ctx.strokeStyle = "#7a5a33";
    ctx.lineWidth = 2;
    for (let s = 0; s < 4; s++) {
      const a = w.wheelAngle + (s * Math.PI) / 2;
      ctx.beginPath();
      ctx.moveTo(wx, wy);
      ctx.lineTo(wx + Math.cos(a) * wheelR * 0.8, wy + Math.sin(a) * wheelR * 0.8);
      ctx.stroke();
    }
  }

  // body (wooden tub)
  ctx.fillStyle = C.cartBody;
  ctx.beginPath();
  ctx.moveTo(x + 2, y + 6);
  ctx.lineTo(x + cw - 2, y + 6);
  ctx.lineTo(x + cw - 8, y + ch - 10);
  ctx.lineTo(x + 8, y + ch - 10);
  ctx.closePath();
  ctx.fill();
  // wood planks
  ctx.strokeStyle = C.cartBodyDark;
  ctx.lineWidth = 2;
  for (let i = 1; i < 4; i++) {
    const px = x + (cw * i) / 4;
    ctx.beginPath();
    ctx.moveTo(px, y + 7);
    ctx.lineTo(px - 3, y + ch - 11);
    ctx.stroke();
  }
  // metal rim
  ctx.strokeStyle = C.cartRim;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x + 1, y + 6);
  ctx.lineTo(x + cw - 1, y + 6);
  ctx.stroke();

  // a glowing ore chunk peeking out
  ctx.fillStyle = C.accent;
  ctx.beginPath();
  ctx.arc(x + cw * 0.5, y + 8, 5, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

export function render(
  ctx: CanvasRenderingContext2D,
  cssW: number,
  cssH: number,
  dpr: number,
  state: RenderState,
): void {
  const pxW = cssW * dpr;
  const pxH = cssH * dpr;
  const scale = pxH / VIEW_H;
  const viewWidthWorld = pxW / scale;
  const cameraX = cameraXFor(state.world, viewWidthWorld);

  // --- screen-space background ---
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const bg = ctx.createLinearGradient(0, 0, 0, pxH);
  bg.addColorStop(0, C.bgTop);
  bg.addColorStop(1, C.bgBottom);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, pxW, pxH);
  drawParallax(ctx, pxW, pxH, cameraX, scale, state.tSec);

  // --- world-space ---
  ctx.setTransform(
    scale,
    0,
    0,
    scale,
    (-cameraX + state.shakeX) * scale,
    state.shakeY * scale,
  );

  const { stage } = state;
  const plats = [...stage.platforms].sort((a, b) => a.x - b.x);
  // gaps (pits) first, behind rails
  for (let i = 0; i < plats.length - 1; i++) {
    const x1 = plats[i].x + plats[i].width;
    const x2 = plats[i + 1].x;
    if (x2 > x1 + 1) drawGapPit(ctx, x1, x2, Math.min(plats[i].y, plats[i + 1].y));
  }
  for (const p of plats) drawPlatform(ctx, p.x, p.width, p.y);

  // goal
  const goalGroundY =
    plats.find((p) => stage.goalX >= p.x && stage.goalX <= p.x + p.width)?.y ??
    stage.baseGroundY;
  drawGoal(ctx, stage.goalX, goalGroundY);

  for (const o of stage.obstacles) drawObstacle(ctx, o, state.tSec);

  // particles
  for (const p of state.particles) {
    ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x, p.y, p.size, p.size);
  }
  ctx.globalAlpha = 1;

  if (state.world.status !== "dead") {
    drawCart(ctx, state.world);
  } else {
    // draw a dimmed, crashed cart tilted
    ctx.globalAlpha = 0.85;
    drawCart(ctx, state.world);
    ctx.globalAlpha = 1;
  }

  // --- vignette (screen space) ---
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const vg = ctx.createRadialGradient(
    pxW / 2,
    pxH / 2,
    pxH * 0.3,
    pxW / 2,
    pxH / 2,
    pxH * 0.8,
  );
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, "rgba(0,0,0,0.45)");
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, pxW, pxH);
}
