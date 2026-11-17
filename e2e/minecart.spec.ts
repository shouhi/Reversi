import { test, expect } from "@playwright/test";

/**
 * E2E for the Minecart action game. Clearability of all 24 stages is proven by
 * the BFS solver unit tests; here we verify the real UI flow: the 4 difficulty
 * tiers render, stage gating works, the play screen starts and pauses, a scripted
 * jump actually clears stage 1 (full canvas loop + input + progress persistence),
 * and it loads on a mobile viewport.
 */

test("stage select shows four tiers and gates locked stages", async ({ page }) => {
  await page.goto("/games/minecart");

  for (const tier of ["EASY", "NORMAL", "HARD", "EXPERT"]) {
    await expect(page.getByRole("heading", { name: tier })).toBeVisible();
  }

  await expect(page.getByTestId("stage-e1")).toBeEnabled();
  await expect(page.getByTestId("stage-e3")).toBeDisabled();

  await page.getByTestId("stage-e1").click();
  await expect(page.getByTestId("game-canvas")).toBeVisible();
  await expect(page.getByTestId("start-button")).toBeVisible();

  await page.getByTestId("start-button").click();
  await expect(page.getByTestId("start-button")).toHaveCount(0);
  await page.getByTestId("pause-button").click();
  await expect(page.getByText("ポーズ中")).toBeVisible();
  await page.getByRole("button", { name: "再開" }).click();
  await expect(page.getByText("ポーズ中")).toHaveCount(0);
});

test("a well-timed jump clears stage 1 and unlocks stage 2", async ({ page }) => {
  await page.goto("/games/minecart");
  await page.getByTestId("stage-e1").click();
  await page.getByTestId("start-button").click();

  // e1 has a single gap; the takeoff window is t≈1.63–1.89s, so jumping at 1.75s
  // clears it. Dispatch from the page so game time and the timer align.
  await page.evaluate(() => {
    window.setTimeout(
      () =>
        window.dispatchEvent(
          new KeyboardEvent("keydown", { code: "Space", bubbles: true }),
        ),
      1750,
    );
  });

  await expect(page.getByTestId("clear-title")).toBeVisible({ timeout: 9000 });

  await page.getByRole("button", { name: "ステージ選択へ" }).click();
  await expect(page.getByTestId("stage-e2")).toBeEnabled();
});

test("shows a failure reason and reach when the cart dies", async ({ page }) => {
  await page.goto("/games/minecart");
  await page.getByTestId("stage-e1").click();
  await page.getByTestId("start-button").click();
  // Never jump → fall into the gap → fail overlay with a reason.
  await expect(page.getByTestId("fail-title")).toBeVisible({ timeout: 9000 });
  await expect(page.getByText(/到達/)).toBeVisible();
  // Instant retry is available.
  await expect(page.getByTestId("retry-button")).toBeVisible();
});

test("loads and is playable on a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/games/minecart");
  await expect(page.getByTestId("stage-e1")).toBeVisible();
  await page.getByTestId("stage-e1").click();
  await expect(page.getByTestId("game-canvas")).toBeVisible();
  await expect(page.getByTestId("start-button")).toBeVisible();
});
