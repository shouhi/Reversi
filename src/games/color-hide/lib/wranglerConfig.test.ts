import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Guard against the Phase 9-D release hazard: a `wrangler deploy` (which deletes
 * plaintext vars then re-applies the config's) using the DEV config would push dev
 * vars to production and break the live realtime backend. These tests pin the
 * invariant that the dev config stays dev, the PRODUCTION config stays production,
 * and both target the same Worker + DO migration (so a prod deploy can never
 * inherit dev values, target the wrong Worker, or add an unwanted migration).
 *
 * Text-based (no TOML dependency) — robust enough as a config-drift tripwire.
 */
const dev = readFileSync("cloudflare/color-hide/wrangler.toml", "utf8");
const prod = readFileSync("cloudflare/color-hide/wrangler.production.toml", "utf8");

function val(toml: string, key: string): string | null {
  const m = new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`, "m").exec(toml);
  return m ? m[1] : null;
}

describe("wrangler dev config (local only)", () => {
  it("uses development values (never deployed to prod directly)", () => {
    expect(val(dev, "ENVIRONMENT")).toBe("development");
    expect(val(dev, "COLOR_HIDE_APP_URL")).toBe("http://localhost:3100");
    expect(val(dev, "COLOR_HIDE_ALLOWED_ORIGINS")).toBe("");
  });
});

describe("wrangler PRODUCTION config (the only safe prod deploy source)", () => {
  it("pins production, non-dev values", () => {
    expect(val(prod, "ENVIRONMENT")).toBe("production");
    expect(val(prod, "COLOR_HIDE_APP_URL")).toBe("https://zen-gamebox.vercel.app");
    const origins = val(prod, "COLOR_HIDE_ALLOWED_ORIGINS");
    expect(origins).toBeTruthy();
    expect(origins!.startsWith("https://")).toBe(true);
  });

  it("contains NO development markers in its SETTINGS (comments aside)", () => {
    // The whole point: a prod deploy can never carry dev values. Check the actual
    // config lines, not the explanatory comments (which mention the dev values).
    const settings = prod
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("#"))
      .join("\n");
    expect(settings).not.toMatch(/localhost/);
    expect(settings).not.toMatch(/ENVIRONMENT\s*=\s*"development"/);
    expect(settings).not.toMatch(/COLOR_HIDE_ALLOWED_ORIGINS\s*=\s*""/);
  });

  it("never stores a secret value", () => {
    // COLOR_HIDE_RT_SECRET is a `wrangler secret` (persisted), never committed.
    expect(prod).not.toMatch(/COLOR_HIDE_RT_SECRET\s*=/);
  });

  it("targets the SAME Worker name as the dev config", () => {
    expect(val(prod, "name")).toBe("color-hide-realtime");
    expect(val(prod, "name")).toBe(val(dev, "name"));
  });

  it("declares the SAME Durable Object class + migration tag (no new migration)", () => {
    expect(prod).toMatch(/class_name\s*=\s*"ColorHide"/);
    expect(prod).toMatch(/new_sqlite_classes\s*=\s*\["ColorHide"\]/);
    // Migration tag must match dev's so a prod deploy never adds a migration.
    const devTag = val(dev, "tag");
    const prodTag = val(prod, "tag");
    expect(prodTag).toBe(devTag);
  });
});
