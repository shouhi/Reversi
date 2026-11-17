import { describe, it, expect } from "vitest";
import { allHidersCaught, buildRoundResult, hiders } from "./winner";
import type { PlayerRecord, Role } from "../types";

let seq = 0;
function player(role: Role | null, caught = false): PlayerRecord {
  seq += 1;
  return {
    id: `p${seq}`,
    tokenHash: `h${seq}`,
    nickname: `P${seq}`,
    isHost: false,
    ready: true,
    role,
    caught,
    lastSeen: 0,
    joinedAt: 0,
  };
}

describe("hiders / allHidersCaught", () => {
  it("counts only hiders, excluding the seeker", () => {
    const roster = [player("seeker"), player("hider"), player("hider")];
    expect(hiders(roster)).toHaveLength(2);
  });

  it("is false while any hider is free, true once all are caught", () => {
    const h1 = player("hider", false);
    const h2 = player("hider", false);
    const roster = [player("seeker"), h1, h2];
    expect(allHidersCaught(roster)).toBe(false);
    h1.caught = true;
    expect(allHidersCaught(roster)).toBe(false);
    h2.caught = true;
    expect(allHidersCaught(roster)).toBe(true);
  });

  it("is false when there are no hiders at all", () => {
    expect(allHidersCaught([player("seeker")])).toBe(false);
  });
});

describe("buildRoundResult", () => {
  it("hiders win when the timer ends with a survivor", () => {
    const seekerP = player("seeker");
    const roster = [seekerP, player("hider", true), player("hider", false)];
    const res = buildRoundResult(roster, seekerP.id, 123);
    expect(res.winner).toBe("hider");
    expect(res.survivors).toHaveLength(1);
    expect(res.caught).toHaveLength(1);
    expect(res.seekerId).toBe(seekerP.id);
    expect(res.endedAt).toBe(123);
  });

  it("seeker wins when every hider is caught", () => {
    const seekerP = player("seeker");
    const roster = [seekerP, player("hider", true), player("hider", true)];
    const res = buildRoundResult(roster, seekerP.id, 9);
    expect(res.winner).toBe("seeker");
    expect(res.survivors).toEqual([]);
  });
});
