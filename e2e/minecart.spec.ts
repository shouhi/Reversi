import { test, expect } from "@playwright/test";

/**
 * E2E for the Minecart action game. The simulation/clearability is proven by the
 * unit + solver tests; here we verify the real UI flow: stage select → play →
 * start → pause/resume, that locked stages are not reachable, that a scripted
 * jump actually clears stage 1 (exercising the full canvas game loop + input +
 * progress persistence), and that it loads on a mobile viewport.
 */

test("stage select gates locked stages and opens the play screen", async ({
  page,
}) => {
  await page.goto("/games/minecart");

  // Stage 1 is unlocked; a later stage is locked (disabled).
  const stage1 = page.getByTestId("stage-easy-1");
  await expect(stage1).toBeEnabled();
  await expect(page.getByTestId("stage-easy-3")).toBeDisabled();

  await stage1.click();
  await expect(page.getByTestId("game-canvas")).toBeVisible();
  await expect(page.getByTestId("start-button")).toBeVisible();

  // Start, then pause and resume.
  await page.getByTestId("start-button").click();
  await expect(page.getByTestId("start-button")).toHaveCount(0);
  await page.getByTestId("pause-button").click();
  await expect(page.getByText("ポーズ中")).toBeVisible();
  await page.getByRole("button", { name: "再開" }).click();
  await expect(page.getByText("ポーズ中")).toHaveCount(0);
});

test("a well-timed jump clears stage 1 and unlocks stage 2", async ({ page }) => {
  await page.goto("/games/minecart");
  await page.getByTestId("stage-easy-1").click();
  await page.getByTestId("start-button").click();

  // easy-1 has a single gap; a jump ~1.95s after start clears it (generous
  // timing margin). Dispatch it from the page so game time and the timer align.
  await page.evaluate(() => {
    window.setTimeout(
      () =>
        window.dispatchEvent(
          new KeyboardEvent("keydown", { code: "Space", bubbles: true }),
        ),
      1950,
    );
  });

  await expect(page.getByTestId("clear-title")).toBeVisible({ timeout: 9000 });

  // Back to stage select: stage 1 cleared, stage 2 now unlocked.
  await page.getByRole("button", { name: "ステージ選択へ" }).click();
  await expect(page.getByTestId("stage-easy-2")).toBeEnabled();
});

test("loads and is playable on a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/games/minecart");
  await expect(page.getByTestId("stage-easy-1")).toBeVisible();
  await page.getByTestId("stage-easy-1").click();
  await expect(page.getByTestId("game-canvas")).toBeVisible();
  await expect(page.getByTestId("start-button")).toBeVisible();
});
