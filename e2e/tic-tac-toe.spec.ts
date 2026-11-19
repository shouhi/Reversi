import { test, expect, type Page } from "@playwright/test";

/**
 * End-to-end for ○×ゲーム: two browser contexts play a shared game to a win,
 * synced via polling, then verify reload recovery and the third-player guard.
 */

const cell = (page: Page, row: number, col: number) =>
  page.getByTestId(`cell-${row}-${col}`);

async function expectMark(
  page: Page,
  row: number,
  col: number,
  mark: "o" | "x",
) {
  await expect(cell(page, row, col)).toHaveAttribute("data-mark", mark);
}

test("two players play ○×ゲーム to a win and recover", async ({ browser }) => {
  // --- Player A (○ / creator) via the catalog ---------------------------
  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();
  await pageA.goto("/");
  await pageA.getByRole("link", { name: "○×ゲーム を遊ぶ" }).click();
  await pageA.waitForURL(/\/games\/tic-tac-toe$/);
  await pageA.getByRole("button", { name: "対戦ルームを作成" }).click();
  await pageA.waitForURL(/\/games\/tic-tac-toe\/room\/[a-z0-9]+/);
  const roomUrl = pageA.url();

  await expect(pageA.getByTestId("waiting")).toBeVisible();
  await expect(pageA.getByTestId("invite-url")).toHaveValue(roomUrl);
  await expect(pageA.getByTestId("seat-o")).toContainText("あなた");

  // --- Player B (×) joins via the shared URL ----------------------------
  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  await pageB.goto(roomUrl);
  const joinBtn = pageB.getByTestId("join-x");
  await expect(joinBtn).toBeVisible();
  await joinBtn.click();

  await expect(pageB.getByTestId("board")).toBeVisible();
  await expect(pageB.getByTestId("seat-x")).toContainText("あなた");
  await expect(pageA.getByTestId("waiting")).toHaveCount(0);

  // Turn ownership: ○ (A) to move; × (B) waits.
  await expect(pageA.getByTestId("turn-banner")).toHaveAttribute(
    "data-my-turn",
    "true",
  );
  await expect(pageB.getByTestId("turn-banner")).toHaveAttribute(
    "data-my-turn",
    "false",
  );

  // ○ (A) plays (0,0); it propagates to B.
  await cell(pageA, 0, 0).click();
  await expectMark(pageA, 0, 0, "o");
  await expectMark(pageB, 0, 0, "o");
  await expect(pageB.getByTestId("turn-banner")).toHaveAttribute(
    "data-my-turn",
    "true",
  );

  // × (B) plays (1,0).
  await cell(pageB, 1, 0).click();
  await expectMark(pageA, 1, 0, "x");
  await expect(pageA.getByTestId("turn-banner")).toHaveAttribute(
    "data-my-turn",
    "true",
  );

  // ○ (A) plays (0,1).
  await cell(pageA, 0, 1).click();
  await expectMark(pageB, 0, 1, "o");
  await expect(pageB.getByTestId("turn-banner")).toHaveAttribute(
    "data-my-turn",
    "true",
  );

  // × (B) plays (1,1).
  await cell(pageB, 1, 1).click();
  await expectMark(pageA, 1, 1, "x");
  await expect(pageA.getByTestId("turn-banner")).toHaveAttribute(
    "data-my-turn",
    "true",
  );

  // ○ (A) plays (0,2) → completes the top row and wins.
  await cell(pageA, 0, 2).click();
  await expect(pageA.getByTestId("result-headline")).toHaveText("あなたの勝ち！");
  await expect(pageB.getByTestId("result-headline")).toHaveText("あなたの負け…");

  // Reload B — still ×, finished state preserved from the server.
  await pageB.reload();
  await expect(pageB.getByTestId("board")).toBeVisible();
  await expectMark(pageB, 0, 0, "o");
  await expectMark(pageB, 0, 2, "o");

  // A third visitor cannot join a full room.
  const ctxC = await browser.newContext();
  const pageC = await ctxC.newPage();
  await pageC.goto(roomUrl);
  await expect(pageC.getByTestId("room-full")).toBeVisible();

  await ctxA.close();
  await ctxB.close();
  await ctxC.close();
});

test("two players rematch in the SAME room, swap seats, and play again", async ({
  browser,
}) => {
  // --- Set up a finished game (○ = A wins the top row) -------------------
  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();
  await pageA.goto("/games/tic-tac-toe");
  await pageA.getByRole("button", { name: "対戦ルームを作成" }).click();
  await pageA.waitForURL(/\/games\/tic-tac-toe\/room\/[a-z0-9]+/);
  const roomUrl = pageA.url();

  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  await pageB.goto(roomUrl);
  await pageB.getByTestId("join-x").click();
  await expect(pageB.getByTestId("board")).toBeVisible();

  // ○(A) wins: (0,0),(0,1),(0,2) around ×(B) at (1,0),(1,1).
  await cell(pageA, 0, 0).click();
  await cell(pageB, 1, 0).click();
  await cell(pageA, 0, 1).click();
  await cell(pageB, 1, 1).click();
  await cell(pageA, 0, 2).click();
  await expect(pageA.getByTestId("result-headline")).toHaveText("あなたの勝ち！");
  await expect(pageB.getByTestId("result-headline")).toHaveText("あなたの負け…");

  // --- A requests a rematch; one side alone does NOT restart ------------
  await pageA.getByTestId("rematch").click();
  await expect(pageA.getByTestId("rematch-waiting")).toBeVisible();
  // Still finished for both — no new game yet.
  await expect(pageA.getByTestId("result")).toBeVisible();
  // B sees the pending request via polling.
  await expect(pageB.getByTestId("rematch-opponent")).toBeVisible();

  // --- B accepts → a new game starts in the SAME room ------------------
  await pageB.getByTestId("rematch").click();

  // Result panels disappear on both; the board is live again.
  await expect(pageA.getByTestId("result")).toHaveCount(0);
  await expect(pageB.getByTestId("result")).toHaveCount(0);

  // Seats swapped: B is now ○ (opener), A is now ×.
  await expect(pageB.getByTestId("seat-o")).toContainText("あなた");
  await expect(pageA.getByTestId("seat-x")).toContainText("あなた");
  await expect(pageB.getByTestId("turn-banner")).toHaveAttribute(
    "data-my-turn",
    "true",
  );
  await expect(pageA.getByTestId("turn-banner")).toHaveAttribute(
    "data-my-turn",
    "false",
  );

  // The URL never changed — no new room, no re-invite.
  expect(pageB.url()).toBe(roomUrl);

  // New round is fully playable: B(○) wins again to prove the fresh game works.
  await cell(pageB, 0, 0).click();
  await expectMark(pageA, 0, 0, "o");
  await cell(pageA, 1, 0).click();
  await cell(pageB, 0, 1).click();
  await cell(pageA, 1, 1).click();
  await cell(pageB, 0, 2).click();
  await expect(pageB.getByTestId("result-headline")).toHaveText("あなたの勝ち！");

  await ctxA.close();
  await ctxB.close();
});

test("the catalog links ○×ゲーム to its start page", async ({ page }) => {
  await page.goto("/");
  const link = page.getByRole("link", { name: "○×ゲーム を遊ぶ" });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/games\/tic-tac-toe$/);
  await expect(
    page.getByRole("button", { name: "対戦ルームを作成" }),
  ).toBeVisible();
});
