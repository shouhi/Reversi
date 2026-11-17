import { test, expect } from "@playwright/test";

/**
 * End-to-end for COLOR HIDE's lobby + round start. These cover the deterministic,
 * server-driven flows (catalog link, join, capacity, readiness, start → role
 * reveal). The 3D round itself (movement, occlusion, catch) is covered by unit
 * tests on the pure logic + netcode and by manual browser verification, since it
 * needs the realtime host and WebGL, which aren't part of this CI suite.
 */

const base = "/api/games/color-hide/rooms";

test("the catalog links COLOR HIDE to its start page", async ({ page }) => {
  await page.goto("/");
  const link = page.getByRole("link", { name: "COLOR HIDE を遊ぶ" });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/games\/color-hide$/);
  await expect(page.getByRole("button", { name: "部屋を作る" })).toBeVisible();
});

test("host creates a room, a friend joins, it fills to 6, and the 7th is rejected", async ({
  browser,
  request,
}) => {
  // --- Host (A) creates via the start page ------------------------------
  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();
  await pageA.goto("/games/color-hide");
  await pageA.getByPlaceholder("あなたの名前").fill("ホスト");
  await pageA.getByRole("button", { name: "部屋を作る" }).click();
  await pageA.waitForURL(/\/games\/color-hide\/room\/[a-z0-9]+/);
  const roomUrl = pageA.url();
  const roomId = roomUrl.split("/room/")[1];
  await expect(pageA.getByText(/プレイヤー 1\/6/)).toBeVisible();

  // --- Friend (B) joins via the shared URL -----------------------------
  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  await pageB.goto(roomUrl);
  await pageB.getByPlaceholder("あなたの名前").fill("ゲスト");
  await pageB.getByRole("button", { name: "参加する" }).click();
  await expect(pageB.getByText(/プレイヤー 2\/6/)).toBeVisible();
  // The host's lobby updates via polling without a reload.
  await expect(pageA.getByText(/プレイヤー 2\/6/)).toBeVisible();

  // --- Fill seats 3–6 via the API (fast; no four more browsers) --------
  for (let i = 3; i <= 6; i++) {
    const res = await request.post(`${base}/${roomId}/join`, {
      data: { nickname: `P${i}` },
    });
    expect(res.ok()).toBeTruthy();
  }
  await expect(pageA.getByText(/プレイヤー 6\/6/)).toBeVisible();

  // --- The 7th join is rejected by the API ... -------------------------
  const seventh = await request.post(`${base}/${roomId}/join`, {
    data: { nickname: "セブン" },
  });
  expect(seventh.status()).toBe(409);

  // --- ... and a 7th visitor sees the "full" message -------------------
  const ctxC = await browser.newContext();
  const pageC = await ctxC.newPage();
  await pageC.goto(roomUrl);
  await expect(pageC.getByText(/満員/)).toBeVisible();

  await ctxA.close();
  await ctxB.close();
  await ctxC.close();
});

test("the host starts a round once everyone is ready and roles are revealed", async ({
  browser,
  request,
}) => {
  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();
  await pageA.goto("/games/color-hide");
  await pageA.getByPlaceholder("あなたの名前").fill("ホスト");
  await pageA.getByRole("button", { name: "部屋を作る" }).click();
  await pageA.waitForURL(/\/games\/color-hide\/room\/[a-z0-9]+/);
  const roomId = pageA.url().split("/room/")[1];

  // Second player joins + readies via the API.
  const join = await (
    await request.post(`${base}/${roomId}/join`, { data: { nickname: "ゲスト" } })
  ).json();
  const ready = await request.post(`${base}/${roomId}/action`, {
    headers: { "x-color-hide-token": join.token },
    data: { action: "ready", ready: true },
  });
  expect(ready.ok()).toBeTruthy();

  // Host readies and starts from the UI.
  await pageA.getByRole("button", { name: "準備完了にする" }).click();
  const startBtn = pageA.getByRole("button", { name: "ゲーム開始" });
  await expect(startBtn).toBeEnabled();
  await startBtn.click();

  // The round begins: the lobby's start button is gone and the role is revealed.
  await expect(pageA.getByText(/あなたは/)).toBeVisible();
  await expect(pageA.getByRole("button", { name: "ゲーム開始" })).toHaveCount(0);

  await ctxA.close();
});
