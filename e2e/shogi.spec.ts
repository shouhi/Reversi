import { test, expect, type Page } from "@playwright/test";

/**
 * End-to-end for 将棋: two browser contexts create/join a room and exchange a
 * couple of pawn pushes, synced via polling, then verify reload recovery and the
 * third-player guard. There is no quick opening mate in shogi, so we do NOT
 * script a checkmate.
 *
 * A move is two clicks: the from-square (select) then the to-square. data-testid
 * is keyed to LOGICAL board coordinates (row,col), with the board shown in a
 * fixed orientation (Gote pieces are rotated 180° in place).
 */

const cell = (page: Page, row: number, col: number) =>
  page.getByTestId(`cell-${row}-${col}`);

async function expectPiece(page: Page, row: number, col: number, piece: string) {
  await expect(cell(page, row, col)).toHaveAttribute("data-piece", piece);
}

/** Selects the from-square then clicks the to-square to submit a move. */
async function move(page: Page, from: [number, number], to: [number, number]) {
  await cell(page, from[0], from[1]).click();
  await cell(page, to[0], to[1]).click();
}

test("two players create, join, and exchange moves with live sync", async ({
  browser,
}) => {
  // --- Player A (Sente / creator) ---------------------------------------
  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();
  await pageA.goto("/games/shogi");
  await pageA.getByRole("button", { name: "対戦ルームを作成" }).click();
  await pageA.waitForURL(/\/games\/shogi\/room\/[a-z0-9]+/);
  const roomUrl = pageA.url();

  await expect(pageA.getByTestId("waiting")).toBeVisible();
  await expect(pageA.getByTestId("invite-url")).toHaveValue(roomUrl);
  await expect(pageA.getByTestId("seat-sente")).toContainText("あなた");

  // --- Player B (Gote) joins via the shared URL -------------------------
  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  await pageB.goto(roomUrl);
  const joinBtn = pageB.getByTestId("join-gote");
  await expect(joinBtn).toBeVisible();
  await joinBtn.click();

  await expect(pageB.getByTestId("board")).toBeVisible();
  await expect(pageB.getByTestId("seat-gote")).toContainText("あなた");
  await expect(pageA.getByTestId("waiting")).toHaveCount(0);

  // Both see the board; Sente to move.
  await expect(pageA.getByTestId("board")).toBeVisible();
  await expect(pageA.getByTestId("turn-banner")).toHaveAttribute(
    "data-my-turn",
    "true",
  );
  await expect(pageB.getByTestId("turn-banner")).toHaveAttribute(
    "data-my-turn",
    "false",
  );

  // Sente pushes a pawn: (6,6) -> (5,6).
  await move(pageA, [6, 6], [5, 6]);
  await expectPiece(pageA, 5, 6, "sfu");
  await expectPiece(pageB, 5, 6, "sfu"); // propagated to Gote
  await expect(pageB.getByTestId("turn-banner")).toHaveAttribute(
    "data-my-turn",
    "true",
  );

  // Gote pushes a pawn: (2,2) -> (3,2).
  await move(pageB, [2, 2], [3, 2]);
  await expectPiece(pageB, 3, 2, "gfu");
  await expectPiece(pageA, 3, 2, "gfu"); // propagated to Sente
  await expect(pageA.getByTestId("turn-banner")).toHaveAttribute(
    "data-my-turn",
    "true",
  );

  // Reload B — still Gote, state preserved from the server.
  await pageB.reload();
  await expect(pageB.getByTestId("board")).toBeVisible();
  await expect(pageB.getByTestId("seat-gote")).toContainText("あなた");
  await expectPiece(pageB, 5, 6, "sfu");
  await expectPiece(pageB, 3, 2, "gfu");

  // A third visitor cannot join a full room.
  const ctxC = await browser.newContext();
  const pageC = await ctxC.newPage();
  await pageC.goto(roomUrl);
  await expect(pageC.getByTestId("room-full")).toBeVisible();

  await ctxA.close();
  await ctxB.close();
  await ctxC.close();
});

test("the shogi start page can create a room", async ({ page }) => {
  await page.goto("/games/shogi");
  await expect(
    page.getByRole("heading", { name: "将棋", level: 1 }),
  ).toBeVisible();
  await page.getByRole("button", { name: "対戦ルームを作成" }).click();
  await expect(page).toHaveURL(/\/games\/shogi\/room\/[a-z0-9]+/);
  await expect(page.getByTestId("board")).toBeVisible();
});
