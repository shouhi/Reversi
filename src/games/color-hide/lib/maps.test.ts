import { describe, it, expect } from "vitest";
import { allMaps, getMap } from "./maps";
import { expandAabb, pointInAabb } from "./geometry";
import { MAP_IDS, MAX_PLAYERS, PLAYER_RADIUS } from "./constants";
import type { Vec3 } from "../types";

/** A spawn is valid if it is inside the bounds and clear of every obstacle. */
function spawnIsClear(p: Vec3, obstacles: ReturnType<typeof getMap>["obstacles"]) {
  return !obstacles.some((o) => pointInAabb(p, expandAabb(o, PLAYER_RADIUS)));
}

function withinBoundsXZ(p: Vec3, bounds: ReturnType<typeof getMap>["bounds"]) {
  return (
    p.x >= bounds.min.x + PLAYER_RADIUS &&
    p.x <= bounds.max.x - PLAYER_RADIUS &&
    p.z >= bounds.min.z + PLAYER_RADIUS &&
    p.z <= bounds.max.z - PLAYER_RADIUS
  );
}

describe("map catalog", () => {
  it("exposes exactly the declared map ids", () => {
    expect(allMaps().map((m) => m.id).sort()).toEqual([...MAP_IDS].sort());
  });

  for (const id of MAP_IDS) {
    describe(`map: ${id}`, () => {
      const map = getMap(id);

      it("has enough spawn points to seat a full room", () => {
        // Hiders use `spawns`; the seeker has its own. Keep a margin.
        expect(map.spawns.length).toBeGreaterThanOrEqual(MAX_PLAYERS);
      });

      it("every hider spawn is inside the bounds and clear of obstacles", () => {
        for (const s of map.spawns) {
          expect(withinBoundsXZ(s, map.bounds), `spawn ${JSON.stringify(s)} in bounds`).toBe(true);
          expect(spawnIsClear(s, map.obstacles), `spawn ${JSON.stringify(s)} clear`).toBe(true);
        }
      });

      it("the seeker spawn is inside the bounds and clear of obstacles", () => {
        expect(withinBoundsXZ(map.seekerSpawn, map.bounds)).toBe(true);
        expect(spawnIsClear(map.seekerSpawn, map.obstacles)).toBe(true);
      });

      it("has obstacles (walls + cover), not an empty box", () => {
        // 4 perimeter walls + interior cover.
        expect(map.obstacles.length).toBeGreaterThanOrEqual(8);
      });
    });
  }
});
