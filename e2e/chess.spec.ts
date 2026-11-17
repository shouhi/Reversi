import { test, expect, type Page } from "@playwright/test";

/**
 * End-to-end for チェス: two browser contexts play Fool's mate to a decisive
 * checkmate, synced via polling, then verify reload recovery and the
 * third-player guard.
 *
 * A chess move is two clicks: the from-square (select) then the to-square
 * (destination). data-testid is keyed to LOGICAL board coordinates (row,col),
 * so it is unaffected by the board being visually flipped for Black.
 */

const cell = (page: Page, row: number, col: number) =>
  page.getByTestId(`cell-${row}-${col}`);

async function expectPiece(
  page: Page,
  row: number,
  col: number,
  piece: string,
) {
  await expect(cell(page, row, col)).toHaveAttribute("data-piece", piece);
}

/** Selects the from-square then clicks the to-square to submit a move. */
async function move(
  page: Page,
  from: [number, number],
  to: [number, number],
) {
  await cell(page, from[0], from[1]).click();
  await cell(page, to[0], to[1]).click();
}

test("two players play Fool's mate to checkmate and recover", async ({
  browser,
}) => {
  // --- Player A (White / creator) ---------------------------------------
  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();
  await pageA.goto("/games/chess");
  await pageA.getByRole("button", { name: "対戦ルームを作成" }).click();
  await pageA.waitForURL(/\/games\/chess\/room\/[a-z0-9]+/);
  const roomUrl = pageA.url();

  await expect(pageA.getByTestId("waiting")).toBeVisible();
  await expect(pageA.getByTestId("invite-url")).toHaveValue(roomUrl);
  await expect(pageA.getByTestId("seat-white")).toContainText("あなた");

  // --- Player B (Black) joins via the shared URL ------------------------
  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  await pageB.goto(roomUrl);
  const joinBtn = pageB.getByTestId("join-black");
  await expect(joinBtn).toBeVisible();
  await joinBtn.click();

  await expect(pageB.getByTestId("board")).toBeVisible();
  await expect(pageB.getByTestId("seat-black")).toContainText("あなた");
  await expect(pageA.getByTestId("waiting")).toHaveCount(0);

  // Both see the board; White to move.
  await expect(pageA.getByTestId("board")).toBeVisible();
  await expect(pageA.getByTestId("turn-banner")).toHaveAttribute(
    "data-my-turn",
    "true",
  );
  await expect(pageB.getByTestId("turn-banner")).toHaveAttribute(
    "data-my-turn",
    "false",
  );

  // 1. f3  — White f2->f3: (6,5) -> (5,5)
  await move(pageA, [6, 5], [5, 5]);
  await expectPiece(pageA, 5, 5, "wp");
  await expectPiece(pageB, 5, 5, "wp"); // propagated to Black
  await expect(pageB.getByTestId("turn-banner")).toHaveAttribute(
    "data-my-turn",
    "true",
  );

  // 1... e5 — Black e7->e5: (1,4) -> (3,4)
  await move(pageB, [1, 4], [3, 4]);
  await expectPiece(pageA, 3, 4, "bp");
  await expect(pageA.getByTestId("turn-banner")).toHaveAttribute(
    "data-my-turn",
    "true",
  );

  // 2. g4  — White g2->g4: (6,6) -> (4,6)
  await move(pageA, [6, 6], [4, 6]);
  await expectPiece(pageB, 4, 6, "wp");
  await expect(pageB.getByTestId("turn-banner")).toHaveAttribute(
    "data-my-turn",
    "true",
  );

  // 2... Qh4# — Black d8->h4: (0,3) -> (4,7) delivers checkmate
  await move(pageB, [0, 3], [4, 7]);

  // Black wins; White loses.
  await expect(pageB.getByTestId("result-headline")).toHaveText("あなたの勝ち！");
  await expect(pageA.getByTestId("result-headline")).toHaveText("あなたの負け…");

  // The mating queen is on h4 on both boards.
  await expectPiece(pageA, 4, 7, "bq");
  await expectPiece(pageB, 4, 7, "bq");

  // Reload B — still Black, finished state preserved from the server.
  await pageB.reload();
  await expect(pageB.getByTestId("board")).toBeVisible();
  await expectPiece(pageB, 4, 7, "bq");
  await expect(pageB.getByTestId("result-headline")).toHaveText("あなたの勝ち！");

  // A third visitor cannot join a full room.
  const ctxC = await browser.newContext();
  const pageC = await ctxC.newPage();
  await pageC.goto(roomUrl);
  await expect(pageC.getByTestId("room-full")).toBeVisible();

  await ctxA.close();
  await ctxB.close();
  await ctxC.close();
});

test("the chess start page can create a room", async ({ page }) => {
  await page.goto("/games/chess");
  await expect(
    page.getByRole("heading", { name: "チェス", level: 1 }),
  ).toBeVisible();
  await page.getByRole("button", { name: "対戦ルームを作成" }).click();
  await expect(page).toHaveURL(/\/games\/chess\/room\/[a-z0-9]+/);
  await expect(page.getByTestId("board")).toBeVisible();
});
