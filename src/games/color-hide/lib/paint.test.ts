import { describe, it, expect } from "vitest";
import {
  base64ByteLength,
  isValidPaintPayload,
  uvToPixel,
  validatePaintPayload,
} from "./paint";
import { MAX_PAINT_BYTES } from "./constants";

/** Builds a syntactically valid data URL whose base64 body is `bytes` long. */
function pngDataUrl(bytes: number): string {
  // 4 base64 chars encode 3 bytes; round up and let padding express remainder.
  const chars = Math.ceil(bytes / 3) * 4;
  const body = "A".repeat(chars);
  return `data:image/png;base64,${body}`;
}

describe("base64ByteLength", () => {
  it("accounts for padding", () => {
    expect(base64ByteLength("")).toBe(0);
    expect(base64ByteLength("QQ==")).toBe(1);
    expect(base64ByteLength("QUI=")).toBe(2);
    expect(base64ByteLength("QUJD")).toBe(3);
  });
});

describe("validatePaintPayload", () => {
  it("accepts a small base64 PNG data URL", () => {
    const res = validatePaintPayload(pngDataUrl(1024));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.mime).toBe("image/png");
      expect(res.bytes).toBeGreaterThan(0);
    }
  });

  it("accepts WebP too", () => {
    expect(validatePaintPayload("data:image/webp;base64,QUJD").ok).toBe(true);
  });

  it("rejects non-string payloads", () => {
    expect(validatePaintPayload(null).ok).toBe(false);
    expect(validatePaintPayload({}).ok).toBe(false);
    expect(validatePaintPayload(42).ok).toBe(false);
  });

  it("rejects disallowed MIME types (e.g. svg, which can carry script)", () => {
    expect(
      validatePaintPayload("data:image/svg+xml;base64,QUJD").ok,
    ).toBe(false);
    expect(validatePaintPayload("data:text/html;base64,QUJD").ok).toBe(false);
  });

  it("rejects non-data-URL strings", () => {
    expect(validatePaintPayload("https://evil.example/x.png").ok).toBe(false);
    expect(validatePaintPayload("not a data url").ok).toBe(false);
  });

  it("rejects malformed base64 bodies", () => {
    expect(validatePaintPayload("data:image/png;base64,!!!!").ok).toBe(false);
  });

  it("rejects an empty body", () => {
    expect(validatePaintPayload("data:image/png;base64,").ok).toBe(false);
  });

  it("rejects payloads over the byte cap (fast length guard)", () => {
    const tooBig = pngDataUrl(MAX_PAINT_BYTES + 4096);
    const res = validatePaintPayload(tooBig);
    expect(res.ok).toBe(false);
  });

  it("isValidPaintPayload is a boolean wrapper", () => {
    expect(isValidPaintPayload(pngDataUrl(512))).toBe(true);
    expect(isValidPaintPayload(123)).toBe(false);
  });
});

describe("uvToPixel", () => {
  it("maps UV origin (bottom-left) to the canvas bottom-left (Y flipped)", () => {
    expect(uvToPixel(0, 0, 256)).toEqual({ x: 0, y: 256 });
    expect(uvToPixel(0, 1, 256)).toEqual({ x: 0, y: 0 });
    expect(uvToPixel(1, 0, 256)).toEqual({ x: 256, y: 256 });
    expect(uvToPixel(0.5, 0.5, 256)).toEqual({ x: 128, y: 128 });
  });

  it("clamps out-of-range UVs so a seam never draws off-canvas", () => {
    expect(uvToPixel(-0.2, 1.5, 256)).toEqual({ x: 0, y: 0 });
    expect(uvToPixel(2, -1, 256)).toEqual({ x: 256, y: 256 });
  });
});
