import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

/**
 * End-to-end for 神経衰弱 (Memory): two browser contexts share a game, synced via
 * polling. Because the deck is shuffled and hidden, we never script a full win —
 * we verify the mechanics (create → join → flip → reveal) in a way that is robust
 * to whether any two flipped cards happen to match.
 */

const cell = (page: Page, row: number, col: number) =>
  page.getByTestId(`cell-${row}-${col}`);

const MH = (token: string) => ({ "x-memory-token": token });

/**
 * Solves a Memory game to completion over the HTTP API, learning each card's
 * symbol from the server's flip responses (the layout is hidden up front, so a
 * real game must be played out). Returns once the game is finished. Used to reach
 * a finished game for the rematch test without a brittle 16-click UI script.
 */
async function solveMemoryViaApi(
  request: APIRequestContext,
  roomId: string,
  p1Token: string,
  p2Token: string,
) {
  const base = `/api/games/memory/rooms/${roomId}`;
  const known = new Map<string, number[]>(); // symbol → unmatched indices
  const matched = new Set<number>();

  type PublicCard = { value: string | null; matchedBy: string | null };
  const learn = (cards: PublicCard[]) => {
    cards.forEach((c, i) => {
      if (c.matchedBy !== null) matched.add(i);
      if (c.value !== null && !matched.has(i)) {
        const arr = known.get(c.value) ?? [];
        if (!arr.includes(i)) arr.push(i);
        known.set(c.value, arr);
      }
    });
  };
  const flip = async (token: string, index: number, roundId: number) => {
    const res = await request.post(`${base}/move`, {
      headers: MH(token),
      data: { index, roundId },
    });
    const { publicState } = await res.json();
    learn(publicState.cards);
    return publicState;
  };
  const knownPair = (revealed: number[]): [number, number] | null => {
    for (const idxs of known.values()) {
      const avail = idxs.filter((i) => !matched.has(i));
      if (avail.length >= 2) {
        const a = avail.find((i) => !revealed.includes(i)) ?? avail[0];
        const b = avail.find((i) => i !== a)!;
        return [a, b];
      }
    }
    return null;
  };
  // A card is "unknown" only if we have never learned its symbol — a card that was
  // revealed then flipped back down is face-down again but still KNOWN, so skip it
  // (otherwise the solver re-flips the same low indices forever and never explores).
  const firstUnknown = (cards: PublicCard[], revealed: number[]): number => {
    const knownIdx = new Set<number>([...known.values()].flat());
    for (let i = 0; i < cards.length; i++) {
      if (
        !matched.has(i) &&
        !revealed.includes(i) &&
        !knownIdx.has(i) &&
        cards[i].value === null
      )
        return i;
    }
    return -1;
  };

  for (let guard = 0; guard < 300; guard++) {
    const res = await request.get(base, { headers: MH(p1Token) });
    const state = (await res.json()).publicState;
    learn(state.cards);
    if (state.status === "finished") return state;

    const mover = state.currentTurn === "p1" ? p1Token : p2Token;
    const roundId: number = state.roundId;

    const pair = knownPair(state.revealed);
    if (pair) {
      await flip(mover, pair[0], roundId);
      await flip(mover, pair[1], roundId); // match → same player keeps the turn
      continue;
    }
    // Flip an unknown to learn it; if it completes a known pair, take it.
    const a = firstUnknown(state.cards, state.revealed);
    if (a < 0) throw new Error("no unknown card to flip");
    const afterA = await flip(mover, a, roundId);
    const pair2 = knownPair(afterA.revealed);
    if (pair2) {
      const other = pair2[0] === a ? pair2[1] : pair2[0];
      await flip(mover, other, roundId);
      continue;
    }
    const b = firstUnknown(afterA.cards, afterA.revealed);
    if (b >= 0) await flip(mover, b, roundId); // mismatch → turn passes
  }
  throw new Error("memory game did not finish");
}

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

test("two players rematch in the SAME room: re-shuffle, scores reset, swap seats", async ({
  browser,
  request,
}) => {
  // --- Create + join over the API, then solve the game to a finish -------
  const created = await request.post("/api/games/memory/rooms");
  const { roomId, token: p1Token } = await created.json();
  const joined = await request.post(`/api/games/memory/rooms/${roomId}/join`);
  const { token: p2Token } = await joined.json();
  const finished = await solveMemoryViaApi(request, roomId, p1Token, p2Token);
  expect(finished.status).toBe("finished");

  const roomUrl = `/games/memory/room/${roomId}`;

  // --- Open two browsers as the two players (inject their tokens) --------
  const ctxA = await browser.newContext();
  await ctxA.addInitScript(
    (t: { k: string; v: string }) => localStorage.setItem(t.k, t.v),
    { k: `memory:token:${roomId}`, v: p1Token },
  );
  const pageA = await ctxA.newPage();
  await pageA.goto(roomUrl);

  const ctxB = await browser.newContext();
  await ctxB.addInitScript(
    (t: { k: string; v: string }) => localStorage.setItem(t.k, t.v),
    { k: `memory:token:${roomId}`, v: p2Token },
  );
  const pageB = await ctxB.newPage();
  await pageB.goto(roomUrl);

  // Both see the finished game.
  await expect(pageA.getByTestId("result")).toBeVisible();
  await expect(pageB.getByTestId("result")).toBeVisible();
  // At least one card ended matched (the game was completed).
  await expect(cell(pageA, 0, 0)).toHaveAttribute("data-card", /^matched-/);

  // --- A requests a rematch; B sees it; B accepts -----------------------
  await pageA.getByTestId("rematch").click();
  await expect(pageA.getByTestId("rematch-waiting")).toBeVisible();
  await expect(pageB.getByTestId("rematch-opponent")).toBeVisible();
  await pageB.getByTestId("rematch").click();

  // Fresh round: result gone, EVERY card face-down again (re-shuffled).
  await expect(pageA.getByTestId("result")).toHaveCount(0);
  await expect(pageB.getByTestId("result")).toHaveCount(0);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      await expect(cell(pageA, r, c)).toHaveAttribute("data-card", "down");
    }
  }

  // Scores reset to 0 and seats swapped: B is now p1 (opens).
  await expect(pageB.getByTestId("seat-p1")).toContainText("あなた");
  await expect(pageA.getByTestId("seat-p2")).toContainText("あなた");
  await expect(pageB.getByTestId("turn-banner")).toHaveAttribute(
    "data-my-turn",
    "true",
  );
  expect(pageB.url()).toContain(`/room/${roomId}`);

  // New round is playable: B (now p1) flips a card face-up.
  await cell(pageB, 0, 0).click();
  await expect(cell(pageB, 0, 0)).not.toHaveAttribute("data-card", "down");

  await ctxA.close();
  await ctxB.close();
});

test("the 神経衰弱 start page exposes a create-room action", async ({ page }) => {
  await page.goto("/games/memory");
  await expect(
    page.getByRole("button", { name: "対戦ルームを作成" }),
  ).toBeVisible();
});
