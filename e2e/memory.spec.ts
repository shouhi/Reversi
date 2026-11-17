import { test, expect, type Page } from "@playwright/test";

/**
 * End-to-end for 神経衰弱 (Memory): two browser contexts share a game, synced via
 * polling. Because the deck is shuffled and hidden, we never script a full win —
 * we verify the mechanics (create → join → flip → reveal) in a way that is robust
 * to whether any two flipped cards happen to match.
 */

const cell = (page: Page, row: number, col: number) =>
  page.getByTestId(`cell-${row}-${col}`);

/** A flipped card is face-up when its data-card is no longer "down" (it is
 *  either "up-<value>" or, on a match, "matched-<player>"). */
async function expectFaceUp(page: Page, row: number, col: number) {
  await expect(cell(page, row, col)).not.toHaveAttribute("data-card", "down");
}

test("two players flip cards in a shared 神経衰弱 room and recover", async ({
  browser,
}) => {
  // --- Player A (p1 / creator) via the game's start page ------------------
  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();
  await pageA.goto("/games/memory");
  await pageA.getByRole("button", { name: "対戦ルームを作成" }).click();
  await pageA.waitForURL(/\/games\/memory\/room\/[a-z0-9]+/);
  const roomUrl = pageA.url();

  await expect(pageA.getByTestId("waiting")).toBeVisible();
  await expect(pageA.getByTestId("invite-url")).toHaveValue(roomUrl);
  await expect(pageA.getByTestId("seat-p1")).toContainText("あなた");

  // --- Player B (p2) joins via the shared URL ----------------------------
  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  await pageB.goto(roomUrl);
  const joinBtn = pageB.getByTestId("join-p2");
  await expect(joinBtn).toBeVisible();
  await joinBtn.click();

  await expect(pageB.getByTestId("board")).toBeVisible();
  await expect(pageB.getByTestId("seat-p2")).toContainText("あなた");
  await expect(pageA.getByTestId("waiting")).toHaveCount(0);

  // Turn ownership: p1 (A) goes first; p2 (B) waits.
  await expect(pageA.getByTestId("turn-banner")).toHaveAttribute(
    "data-my-turn",
    "true",
  );
  await expect(pageB.getByTestId("turn-banner")).toHaveAttribute(
    "data-my-turn",
    "false",
  );

  // Both cards start face-down on both pages (hidden layout).
  await expect(cell(pageA, 0, 0)).toHaveAttribute("data-card", "down");
  await expect(cell(pageB, 0, 0)).toHaveAttribute("data-card", "down");

  // p1 (A) flips the first card; a first flip keeps the turn.
  await cell(pageA, 0, 0).click();
  await expectFaceUp(pageA, 0, 0);
  await expect(pageA.getByTestId("turn-banner")).toHaveAttribute(
    "data-my-turn",
    "true",
  );

  // p1 (A) flips a second card to complete the pair attempt.
  await cell(pageA, 0, 1).click();
  await expectFaceUp(pageA, 0, 1);

  // Both flipped cards are now visible on BOTH pages (regardless of
  // match/mismatch — a match shows them as "matched-p1", a mismatch as "up-…").
  await expectFaceUp(pageA, 0, 0);
  await expectFaceUp(pageB, 0, 0);
  await expectFaceUp(pageB, 0, 1);

  // Reload B — it is still p2 and the board state is preserved by the server.
  await pageB.reload();
  await expect(pageB.getByTestId("board")).toBeVisible();
  await expect(pageB.getByTestId("seat-p2")).toContainText("あなた");

  // A third visitor cannot join a full room.
  const ctxC = await browser.newContext();
  const pageC = await ctxC.newPage();
  await pageC.goto(roomUrl);
  await expect(pageC.getByTestId("room-full")).toBeVisible();

  await ctxA.close();
  await ctxB.close();
  await ctxC.close();
});

test("the 神経衰弱 start page exposes a create-room action", async ({ page }) => {
  await page.goto("/games/memory");
  await expect(
    page.getByRole("button", { name: "対戦ルームを作成" }),
  ).toBeVisible();
});
