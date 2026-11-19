import { describe, it, expect } from "vitest";
import {
  initialRematch,
  getRematch,
  hasVoted,
  addVote,
  allVoted,
  nextRound,
  toRematchView,
} from "./rematch";

describe("rematch — shared consent + round model", () => {
  it("initialRematch starts at round 1 with no votes", () => {
    expect(initialRematch()).toEqual({ roundId: 1, votes: [] });
  });

  it("getRematch defaults a legacy room (no rematch field) to round 1", () => {
    expect(getRematch({})).toEqual({ roundId: 1, votes: [] });
    const existing = { roundId: 3, votes: ["o"] };
    expect(getRematch({ rematch: existing })).toBe(existing);
  });

  it("addVote records a seat and is idempotent", () => {
    const r0 = initialRematch();
    const r1 = addVote(r0, "o");
    expect(r1.votes).toEqual(["o"]);
    expect(hasVoted(r1, "o")).toBe(true);
    expect(hasVoted(r1, "x")).toBe(false);
    // duplicate vote → same object (no change), still a single entry
    const r2 = addVote(r1, "o");
    expect(r2).toBe(r1);
    expect(r2.votes).toEqual(["o"]);
  });

  it("addVote does not mutate the input", () => {
    const r0 = initialRematch();
    addVote(r0, "o");
    expect(r0.votes).toEqual([]);
  });

  it("allVoted is true only when BOTH seats have voted", () => {
    const seats = ["o", "x"] as const;
    let r = initialRematch();
    expect(allVoted(r, seats)).toBe(false);
    r = addVote(r, "o");
    expect(allVoted(r, seats)).toBe(false); // one side only — never starts
    r = addVote(r, "x");
    expect(allVoted(r, seats)).toBe(true);
  });

  it("allVoted is false for an empty seat list", () => {
    expect(allVoted(initialRematch(), [])).toBe(false);
  });

  it("nextRound bumps roundId and clears votes", () => {
    const r = { roundId: 1, votes: ["o", "x"] };
    expect(nextRound(r)).toEqual({ roundId: 2, votes: [] });
  });

  it("toRematchView reports you/opponent relative to the caller", () => {
    const r = { roundId: 2, votes: ["x"] };
    expect(toRematchView(r, "o")).toEqual({
      roundId: 2,
      youRequested: false,
      opponentRequested: true,
    });
    expect(toRematchView(r, "x")).toEqual({
      roundId: 2,
      youRequested: true,
      opponentRequested: false,
    });
  });

  it("toRematchView for both-voted shows both true", () => {
    const r = { roundId: 1, votes: ["o", "x"] };
    expect(toRematchView(r, "o")).toEqual({
      roundId: 1,
      youRequested: true,
      opponentRequested: true,
    });
  });

  it("toRematchView for a non-participant: opponentRequested = any vote", () => {
    expect(toRematchView({ roundId: 1, votes: ["o"] }, null)).toEqual({
      roundId: 1,
      youRequested: false,
      opponentRequested: true,
    });
    expect(toRematchView({ roundId: 1, votes: [] }, null)).toEqual({
      roundId: 1,
      youRequested: false,
      opponentRequested: false,
    });
  });
});
