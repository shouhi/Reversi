import { describe, it, expect } from "vitest";
import { isOriginAllowed, parseOrigins } from "./realtimeShared";

describe("parseOrigins", () => {
  it("splits, trims, and drops empties", () => {
    expect(parseOrigins("a, b ,,c")).toEqual(["a", "b", "c"]);
    expect(parseOrigins("")).toEqual([]);
    expect(parseOrigins(undefined)).toEqual([]);
  });
});

describe("isOriginAllowed", () => {
  const prod = ["https://zen-gamebox.vercel.app"];

  it("allows any Origin when the allowlist is empty (dev)", () => {
    expect(isOriginAllowed("https://anything.example", [])).toBe(true);
  });

  it("allows a missing Origin (non-browser client; token auth is the gate)", () => {
    expect(isOriginAllowed(null, prod)).toBe(true);
    expect(isOriginAllowed(undefined, prod)).toBe(true);
  });

  it("allows an exact match and rejects others", () => {
    expect(isOriginAllowed("https://zen-gamebox.vercel.app", prod)).toBe(true);
    expect(isOriginAllowed("https://evil.example", prod)).toBe(false);
    // Must not substring-match or ignore scheme.
    expect(isOriginAllowed("http://zen-gamebox.vercel.app", prod)).toBe(false);
    expect(isOriginAllowed("https://zen-gamebox.vercel.app.evil.com", prod)).toBe(false);
  });

  it("supports wildcard entries for dynamic Vercel Preview URLs", () => {
    const list = ["https://*.vercel.app"];
    expect(isOriginAllowed("https://game-box-abc123-shouhi.vercel.app", list)).toBe(true);
    expect(isOriginAllowed("https://zen-gamebox.vercel.app", list)).toBe(true);
    expect(isOriginAllowed("https://evil.example", list)).toBe(false);
    // The wildcard is anchored: it must not allow a different suffix.
    expect(isOriginAllowed("https://x.vercel.app.evil.com", list)).toBe(false);
  });

  it("supports a project-scoped wildcard (tighter than *.vercel.app)", () => {
    const list = ["https://game-box-*-shouhis-projects.vercel.app"];
    expect(
      isOriginAllowed("https://game-box-abc-shouhis-projects.vercel.app", list),
    ).toBe(true);
    expect(isOriginAllowed("https://game-box-abc.vercel.app", list)).toBe(false);
  });
});
