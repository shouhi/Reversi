import * as THREE from "three";
import { uvToPixel } from "../../lib/paint";
import { PAINT_TEXTURE_SIZE } from "../../lib/constants";

/**
 * COLOR HIDE — paint engine (browser only).
 *
 * Wraps a 2D offscreen canvas as a three.js CanvasTexture. Painting = raycast UV
 * → canvas pixel (via the tested `uvToPixel`) → draw a round stroke → flag the
 * texture dirty. One stroke (pointer-down to up) is one undo step. Only ever
 * instantiated inside a client component (uses `document`).
 */

export interface BrushOptions {
  color: string;
  /** Brush radius in texture pixels. */
  radius: number;
  erase: boolean;
}

const MAX_UNDO = 24;

export class PaintEngine {
  readonly canvas: HTMLCanvasElement;
  readonly texture: THREE.CanvasTexture;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly size: number;
  private readonly base: string;
  private undoStack: ImageData[] = [];
  private last: { x: number; y: number } | null = null;

  constructor(size = PAINT_TEXTURE_SIZE, base = "#f4f4f5") {
    this.size = size;
    this.base = base;
    this.canvas = document.createElement("canvas");
    this.canvas.width = size;
    this.canvas.height = size;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas context unavailable");
    this.ctx = ctx;
    this.ctx.fillStyle = base;
    this.ctx.fillRect(0, 0, size, size);

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
  }

  /** Call at pointer-down so the whole drag is a single undo step. */
  beginStroke(): void {
    this.snapshot();
    this.last = null;
  }

  endStroke(): void {
    this.last = null;
  }

  /** Paints a round dab at the UV, connecting from the previous dab for smooth lines. */
  paintAt(u: number, v: number, opts: BrushOptions): void {
    const { x, y } = uvToPixel(u, v, this.size);
    const color = opts.erase ? this.base : opts.color;
    this.ctx.fillStyle = color;
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = opts.radius * 2;
    this.ctx.lineCap = "round";
    this.ctx.lineJoin = "round";

    if (this.last) {
      this.ctx.beginPath();
      this.ctx.moveTo(this.last.x, this.last.y);
      this.ctx.lineTo(x, y);
      this.ctx.stroke();
    }
    this.ctx.beginPath();
    this.ctx.arc(x, y, opts.radius, 0, Math.PI * 2);
    this.ctx.fill();

    this.last = { x, y };
    this.texture.needsUpdate = true;
  }

  /** Flood the whole character with one color (undoable). */
  fill(color: string): void {
    this.snapshot();
    this.ctx.fillStyle = color;
    this.ctx.fillRect(0, 0, this.size, this.size);
    this.texture.needsUpdate = true;
  }

  /** Reset to the blank base color (undoable). */
  clear(): void {
    this.fill(this.base);
  }

  undo(): void {
    const img = this.undoStack.pop();
    if (!img) return;
    this.ctx.putImageData(img, 0, 0);
    this.texture.needsUpdate = true;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  /** Current texture as a PNG data URL (for committing / sharing). */
  toDataURL(): string {
    return this.canvas.toDataURL("image/png");
  }

  /** Load a shared paint (another player's) onto the canvas. */
  loadDataURL(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        this.ctx.clearRect(0, 0, this.size, this.size);
        this.ctx.drawImage(img, 0, 0, this.size, this.size);
        this.texture.needsUpdate = true;
        resolve();
      };
      img.onerror = () => reject(new Error("failed to load paint"));
      img.src = url;
    });
  }

  private snapshot(): void {
    this.undoStack.push(this.ctx.getImageData(0, 0, this.size, this.size));
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
  }

  dispose(): void {
    this.texture.dispose();
    this.undoStack = [];
  }
}
