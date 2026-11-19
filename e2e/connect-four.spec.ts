import { test, expect, type Page } from "@playwright/test";

/**
 * End-to-end for 四目並べ (Connect Four): two browser contexts play a shared game
 * to a red win, synced via polling, then verify reload recovery and the
 * third-player guard.
 *
 * To drop a disc into a column, click the TOP cell of that column — clicking
 * anywhere in a column drops into it, and the top cell is always present/empty
 * while the column is playable.
 */

const cell = (page: Page, row: number, col: number) =>
  page.getByTestId(`cell-${row}-${col}`);

async function expectDisc(
  page: Page,
  row: number,
  col: number,
  disc: "red" | "yellow",
) {
  await expect(cell(page, row, col)).toHaveAttribute("data-disc", disc);
}

/** Drop into `col` by clicking its top cell. */
async function drop(page: Page, col: number) {
  await cell(page, 0, col).click();
}

test("two players play 四目並べ to a win and recover", async ({ browser }) => {
  // --- Player A (red / creator) via the start page -----------------------
  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();
  await pageA.goto("/games/connect-four");
  await pageA.getByRole("button", { name: "対戦ルームを作成" }).click();
  await pageA.waitForURL(/\/games\/connect-four\/room\/[a-z0-9]+/);
  const roomUrl = pageA.url();

  await expect(pageA.getByTestId("waiting")).toBeVisible();
  await expect(pageA.getByTestId("invite-url")).toHaveValue(roomUrl);
  await expect(pageA.getByTestId("seat-red")).toContainText("あなた");

  // --- Player B (yellow) joins via the shared URL -----------------------
  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  await pageB.goto(roomUrl);
  const joinBtn = pageB.getByTestId("join-yellow");
  await expect(joinBtn).toBeVisible();
  await joinBtn.click();

  await expect(pageB.getByTestId("board")).toBeVisible();
  await expect(pageB.getByTestId("seat-yellow")).toContainText("あなた");
  await expect(pageA.getByTestId("waiting")).toHaveCount(0);

  // Turn ownership: red (A) to move; yellow (B) waits.
  await expect(pageA.getByTestId("turn-banner")).toHaveAttribute(
    "data-my-turn",
    "true",
  );
  await expect(pageB.getByTestId("turn-banner")).toHaveAttribute(
    "data-my-turn",
    "false",
  );

  // Script a red win along the bottom row (cols 0-3). Yellow dumps into col 6.
  // red col 0
  await drop(pageA, 0);
  await expectDisc(pageA, 5, 0, "red");
  await expectDisc(pageB, 5, 0, "red");
  await expect(pageB.getByTestId("turn-banner")).toHaveAttribute(
    "data-my-turn",
    "true",
  );

  // yellow col 6
  await drop(pageB, 6);
  await expectDisc(pageA, 5, 6, "yellow");
  await expect(pageA.getByTestId("turn-banner")).toHaveAttribute(
    "data-my-turn",
    "true",
  );

  // red col 1
  await drop(pageA, 1);
  await expectDisc(pageB, 5, 1, "red");
  await expect(pageB.getByTestId("turn-banner")).toHaveAttribute(
    "data-my-turn",
    "true",
  );

  // yellow col 6
  await drop(pageB, 6);
  await expectDisc(pageA, 4, 6, "yellow");
  await expect(pageA.getByTestId("turn-banner")).toHaveAttribute(
    "data-my-turn",
    "true",
  );

  // red col 2
  await drop(pageA, 2);
  await expectDisc(pageB, 5, 2, "red");
  await expect(pageB.getByTestId("turn-banner")).toHaveAttribute(
    "data-my-turn",
    "true",
  );

  // yellow col 6
  await drop(pageB, 6);
  await expectDisc(pageA, 3, 6, "yellow");
  await expect(pageA.getByTestId("turn-banner")).toHaveAttribute(
    "data-my-turn",
    "true",
  );

  // red col 3 → completes the bottom row 0-3 and wins.
  await drop(pageA, 3);
  await expect(pageA.getByTestId("result-headline")).toHaveText("あなたの勝ち！");
  await expect(pageB.getByTestId("result-headline")).toHaveText("あなたの負け…");

  // The whole bottom row (cols 0-3) is red on both pages.
  for (let c = 0; c <= 3; c++) {
    await expectDisc(pageA, 5, c, "red");
    await expectDisc(pageB, 5, c, "red");
  }

  // Reload B — still yellow, finished state preserved from the server.
  await pageB.reload();
  await expect(pageB.getByTestId("board")).toBeVisible();
  await expectDisc(pageB, 5, 0, "red");
  await expectDisc(pageB, 5, 3, "red");

  // A third visitor cannot join a full room.
  const ctxC = await browser.newContext();
  const pageC = await ctxC.newPage();
  await pageC.goto(roomUrl);
  await expect(pageC.getByTestId("room-full")).toBeVisible();

  await ctxA.close();
  await ctxB.close();
  await ctxC.close();
});

test("two players rematch in the SAME room, swap colors, and play again", async ({
  browser,
}) => {
  // --- Set up a finished game (red = A wins the bottom row) --------------
  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();
  await pageA.goto("/games/connect-four");
  await pageA.getByRole("button", { name: "対戦ルームを作成" }).click();
  await pageA.waitForURL(/\/games\/connect-four\/room\/[a-z0-9]+/);
  const roomUrl = pageA.url();

  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  await pageB.goto(roomUrl);
  await pageB.getByTestId("join-yellow").click();
  await expect(pageB.getByTestId("board")).toBeVisible();

  // red bottom row 0-3; yellow dumps into col 6.
  await drop(pageA, 0);
  await drop(pageB, 6);
  await drop(pageA, 1);
  await drop(pageB, 6);
  await drop(pageA, 2);
  await drop(pageB, 6);
  await drop(pageA, 3);
  await expect(pageA.getByTestId("result-headline")).toHaveText("あなたの勝ち！");

  // --- A requests a rematch; one side alone does NOT restart ------------
  await pageA.getByTestId("rematch").click();
  await expect(pageA.getByTestId("rematch-waiting")).toBeVisible();
  await expect(pageA.getByTestId("result")).toBeVisible();
  await expect(pageB.getByTestId("rematch-opponent")).toBeVisible();

  // --- B accepts → a fresh game starts in the SAME room ----------------
  await pageB.getByTestId("rematch").click();
  await expect(pageA.getByTestId("result")).toHaveCount(0);
  await expect(pageB.getByTestId("result")).toHaveCount(0);

  // Colors swapped: B is now red (opener), A is now yellow.
  await expect(pageB.getByTestId("seat-red")).toContainText("あなた");
  await expect(pageA.getByTestId("seat-yellow")).toContainText("あなた");
  await expect(pageB.getByTestId("turn-banner")).toHaveAttribute(
    "data-my-turn",
    "true",
  );

  // Board reset: the previous winning bottom row is empty again.
  await expectDisc(pageB, 5, 0, "empty");
  // Same URL throughout — no new room, no re-invite.
  expect(pageB.url()).toBe(roomUrl);

  // New round is playable: B (now red) drops a disc.
  await drop(pageB, 3);
  await expectDisc(pageB, 5, 3, "red");
  await expectDisc(pageA, 5, 3, "red");

  await ctxA.close();
  await ctxB.close();
});

test("the start page offers to create a 四目並べ room", async ({ page }) => {
  await page.goto("/games/connect-four");
  await expect(
    page.getByRole("button", { name: "対戦ルームを作成" }),
  ).toBeVisible();
});
