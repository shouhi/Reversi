import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "list" : [["list"], ["html", { open: "never" }]],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [
    {
      // Default gate: all specs EXCEPT the PartyServer/Cloudflare one (which needs
      // wrangler/workerd). Keeps `npm run test:e2e` fast and workerd-independent.
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: /color-hide-partyserver\.spec\.ts/,
    },
    {
      // PartyServer / Durable Object integration — `npm run test:partyserver`.
      name: "partyserver",
      use: { ...devices["Desktop Chrome"] },
      testMatch: /color-hide-partyserver\.spec\.ts/,
    },
  ],
  webServer: {
    // Build + start a production server so E2E runs against the real build.
    // REVERSI_MEMORY_STORE lets the suite run without Upstash credentials.
    command: `npm run build && npm run start -- -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      REVERSI_MEMORY_STORE: "1",
      // Short COLOR HIDE phase timers so the realtime E2E can play a full round
      // in ~15s instead of ~95s. Clients always use the server-sent durations, so
      // this only affects test speed, never production behaviour.
      COLOR_HIDE_PREPARING_MS: "4000",
      COLOR_HIDE_PAINTING_MS: "4000",
      COLOR_HIDE_HIDING_MS: "2000",
      COLOR_HIDE_SEEKING_MS: "12000",
      COLOR_HIDE_RESULT_MS: "3000",
    },
  },
});
