import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { getValidMoves, type Board, type Player } from "../src/games/reversi/lib/engine";

/**
 * End-to-end: two independent browser contexts (two "devices") play a shared
 * game that stays in sync via polling. Covers the full lifecycle plus the
 * adversarial cases (wrong turn, reload recovery, third player rejected).
 */

const stoneAt = (page: Page, row: number, col: number) =>
  page.getByTestId(`cell-${row}-${col}`);

const H = (token: string) => ({ "x-reversi-token": token });

/**
 * Drives a reversi game to completion over the HTTP API (fast — no polling
 * waits), always playing a legal move for whoever is to move. Returns the
 * finished public state. Used to reach a finished game for the rematch test
 * without scripting ~40 UI clicks.
 */
async function finishGameViaApi(
  request: APIRequestContext,
  roomId: string,
  blackToken: string,
  whiteToken: string,
) {
  for (let ply = 0; ply < 120; ply++) {
    const res = await request.get(`/api/rooms/${roomId}`, { headers: H(blackToken) });
    const { publicState } = await res.json();
    if (publicState.status === "finished") return publicState;
    const turn: Player = publicState.currentTurn;
    const board: Board = publicState.board;
    const moves = getValidMoves(board, turn);
    if (moves.length === 0) throw new Error("no legal move but game not finished");
    const [row, col] = moves[0];
    const mv = await request.post(`/api/rooms/${roomId}/move`, {
      headers: { ...H(turn === "black" ? blackToken : whiteToken) },
      data: { row, col, roundId: publicState.roundId },
    });
    if (!mv.ok()) throw new Error(`move failed: ${mv.status()}`);
  }
  throw new Error("game did not finish within 120 plies");
}

async function expectStone(
  page: Page,
  row: number,
  col: number,
  color: "black" | "white",
) {
  await expect(stoneAt(page, row, col)).toHaveAttribute("data-stone", color);
}

test("two players create, join, play in sync, and recover", async ({
  browser,
}) => {
  // --- Player A (black / creator) ---------------------------------------
  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();
  // Start at the catalog, pick Reversi, then create the room from its page.
  await pageA.goto("/");
  await pageA.getByRole("link", { name: "リバーシ を遊ぶ" }).click();
  await pageA.waitForURL(/\/games\/reversi$/);

  await pageA.getByRole("button", { name: "対戦ルームを作成" }).click();
  await pageA.waitForURL(/\/room\/[a-z0-9]+/);
  const roomUrl = pageA.url();

  // (1) A is waiting for a friend and sees the invite URL.
  await expect(pageA.getByTestId("waiting")).toBeVisible();
  await expect(pageA.getByTestId("invite-url")).toHaveValue(roomUrl);
  // A is black with the opening position.
  await expect(pageA.getByTestId("score-black")).toContainText("あなた");
  await expect(pageA.getByTestId("count-black")).toHaveText("2");

  // --- Player B (white) joins via the shared URL ------------------------
  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  await pageB.goto(roomUrl);

  // (2) B is offered the white seat.
  const joinBtn = pageB.getByTestId("join-white");
  await expect(joinBtn).toBeVisible();
  await joinBtn.click();

  // (3) Both players now see the same started board (2–2).
  await expect(pageB.getByTestId("board")).toBeVisible();
  await expect(pageB.getByTestId("score-white")).toContainText("あなた");
  await expect(pageA.getByTestId("waiting")).toHaveCount(0); // A auto-advances
  await expect(pageA.getByTestId("count-black")).toHaveText("2");
  await expect(pageB.getByTestId("count-black")).toHaveText("2");

  // Turn ownership: black (A) to move; white (B) waits.
  await expect(pageA.getByTestId("turn-banner")).toHaveAttribute(
    "data-my-turn",
    "true",
  );
  await expect(pageB.getByTestId("turn-banner")).toHaveAttribute(
    "data-my-turn",
    "false",
  );

  // (8) Wrong-turn guard: B has no legal-move hints while it's black's turn.
  await expect(pageB.locator('[data-hint="true"]')).toHaveCount(0);

  // (4) Black plays (2,3).
  await stoneAt(pageA, 2, 3).click();
  await expectStone(pageA, 2, 3, "black");
  await expect(pageA.getByTestId("count-black")).toHaveText("4");

  // (5) The move propagates to white's device via polling.
  await expectStone(pageB, 2, 3, "black");
  await expect(pageB.getByTestId("count-black")).toHaveText("4");
  await expect(pageB.getByTestId("turn-banner")).toHaveAttribute(
    "data-my-turn",
    "true",
  );

  // (6) White plays (2,4) — a legal reply.
  await stoneAt(pageB, 2, 4).click();
  await expectStone(pageB, 2, 4, "white");

  // (7) White's move propagates back to black's device; turn returns to black.
  await expectStone(pageA, 2, 4, "white");
  await expect(pageA.getByTestId("turn-banner")).toHaveAttribute(
    "data-my-turn",
    "true",
  );

  // (9) Reload B — still white, state preserved from the server.
  await pageB.reload();
  await expect(pageB.getByTestId("board")).toBeVisible();
  await expect(pageB.getByTestId("score-white")).toContainText("あなた");
  await expectStone(pageB, 2, 3, "black");
  await expectStone(pageB, 2, 4, "white");

  // (10) A third visitor cannot join a full room.
  const ctxC = await browser.newContext();
  const pageC = await ctxC.newPage();
  await pageC.goto(roomUrl);
  await expect(pageC.getByTestId("room-full")).toBeVisible();
  await expect(pageC.getByTestId("join-white")).toHaveCount(0);

  await ctxA.close();
  await ctxB.close();
  await ctxC.close();
});

test("two players rematch in the SAME room, swap colors, and play again", async ({
  browser,
  request,
}) => {
  // --- Create + join over the API, then play the game out to a finish ----
  const created = await request.post("/api/rooms");
  const { roomId, token: blackToken } = await created.json();
  const joined = await request.post(`/api/rooms/${roomId}/join`);
  const { token: whiteToken } = await joined.json();
  const finished = await finishGameViaApi(request, roomId, blackToken, whiteToken);
  expect(finished.status).toBe("finished");

  const roomUrl = `/room/${roomId}`;

  // --- Open two browsers as the two players (inject their tokens) --------
  const ctxA = await browser.newContext();
  await ctxA.addInitScript(
    (t: { k: string; v: string }) => localStorage.setItem(t.k, t.v),
    { k: `reversi:token:${roomId}`, v: blackToken },
  );
  const pageA = await ctxA.newPage();
  await pageA.goto(roomUrl);

  const ctxB = await browser.newContext();
  await ctxB.addInitScript(
    (t: { k: string; v: string }) => localStorage.setItem(t.k, t.v),
    { k: `reversi:token:${roomId}`, v: whiteToken },
  );
  const pageB = await ctxB.newPage();
  await pageB.goto(roomUrl);

  // Both see the finished game; A was black, B was white.
  await expect(pageA.getByTestId("result")).toBeVisible();
  await expect(pageB.getByTestId("result")).toBeVisible();
  await expect(pageA.getByTestId("score-black")).toContainText("あなた");
  await expect(pageB.getByTestId("score-white")).toContainText("あなた");

  // --- A requests a rematch; one side alone does NOT restart ------------
  await pageA.getByTestId("rematch").click();
  await expect(pageA.getByTestId("rematch-waiting")).toBeVisible();
  await expect(pageA.getByTestId("result")).toBeVisible(); // still finished
  await expect(pageB.getByTestId("rematch-opponent")).toBeVisible();

  // --- B accepts → a fresh game starts in the SAME room -----------------
  await pageB.getByTestId("rematch").click();
  await expect(pageA.getByTestId("result")).toHaveCount(0);
  await expect(pageB.getByTestId("result")).toHaveCount(0);

  // Board reset to the 2–2 opening; colors swapped (B now black & opens).
  await expect(pageA.getByTestId("count-black")).toHaveText("2");
  await expect(pageB.getByTestId("count-black")).toHaveText("2");
  await expect(pageB.getByTestId("score-black")).toContainText("あなた");
  await expect(pageA.getByTestId("score-white")).toContainText("あなた");
  await expect(pageB.getByTestId("turn-banner")).toHaveAttribute(
    "data-my-turn",
    "true",
  );

  // Same URL throughout — no new room, no re-invite.
  expect(pageB.url()).toContain(`/room/${roomId}`);

  // New round is playable: B (now black) makes a legal opening move.
  await pageB.locator('[data-hint="true"]').first().click();
  await expect(pageB.getByTestId("count-black")).not.toHaveText("2");

  await ctxA.close();
  await ctxB.close();
});

test("an unknown room shows a friendly error", async ({ page }) => {
  await page.goto("/room/doesnotexist99");
  await expect(
    page.getByRole("button", { name: "新しい対戦を始める" }),
  ).toBeVisible();
});

test("the catalog lists the games as playable links", async ({ page }) => {
  await page.goto("/");

  // Every available game is listed as a live link to its detail page.
  const reversiLink = page.getByRole("link", { name: "リバーシ を遊ぶ" });
  await expect(reversiLink).toBeVisible();
  await expect(page.getByRole("link", { name: "○×ゲーム を遊ぶ" })).toBeVisible();
  await expect(page.getByRole("link", { name: "四目並べ を遊ぶ" })).toBeVisible();
  await expect(page.getByRole("link", { name: "チェス を遊ぶ" })).toBeVisible();
  await expect(page.getByRole("link", { name: "神経衰弱 を遊ぶ" })).toBeVisible();

  // Selecting Reversi navigates to its start page.
  await reversiLink.click();
  await expect(page).toHaveURL(/\/games\/reversi$/);
  await expect(
    page.getByRole("button", { name: "対戦ルームを作成" }),
  ).toBeVisible();
});

test("the catalog and Reversi flow work on a mobile viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");

  const reversiLink = page.getByRole("link", { name: "リバーシ を遊ぶ" });
  await expect(reversiLink).toBeVisible();
  await reversiLink.click();
  await expect(
    page.getByRole("button", { name: "対戦ルームを作成" }),
  ).toBeVisible();
});
