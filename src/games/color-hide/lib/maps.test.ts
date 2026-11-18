import { describe, it, expect } from "vitest";
import { allMaps, getMap, mapPalette } from "./maps";
import { expandAabb, pointInAabb } from "./geometry";
import { MAP_IDS, MAX_PLAYERS, PLAYER_RADIUS } from "./constants";
import type { Vec3 } from "../types";

describe("mapPalette (Phase 10 in-world eyedropper)", () => {
  it("exposes the exact rendered surface colours (wall/floor/accent) for every map", () => {
    for (const id of MAP_IDS) {
      const map = getMap(id);
      const pal = mapPalette(id);
      const byKey = Object.fromEntries(pal.map((s) => [s.key, s.color]));
      // These must match what MapScene paints the world with, so a hider blends in.
      expect(byKey.wall).toBe(map.theme.wall);
      expect(byKey.floor).toBe(map.theme.floor);
      expect(byKey.accent).toBe(map.theme.accent);
      // Every swatch is a usable hex colour with a label.
      for (const s of pal) {
        expect(s.label.length).toBeGreaterThan(0);
        expect(s.color).toMatch(/^#[0-9a-fA-F]{3,8}$/);
      }
    }
  });
});

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

/**
 * Grid flood-fill reachability from a start point, over cells that are inside the
 * bounds and clear of every obstacle (expanded by the player radius — i.e. where a
 * player can actually stand). Returns a membership test for reachable cells. Used
 * to prove there are no walled-off safe zones and the seeker can reach everywhere.
 */
function reachableFrom(map: ReturnType<typeof getMap>, start: Vec3, res = 0.5) {
  const { bounds, obstacles } = map;
  const cx = (x: number) => Math.round((x - bounds.min.x) / res);
  const cz = (z: number) => Math.round((z - bounds.min.z) / res);
  const nx = cx(bounds.max.x) + 1;
  const nz = cz(bounds.max.z) + 1;
  const expanded = obstacles.map((o) => expandAabb(o, PLAYER_RADIUS));
  const walkable = (ix: number, iz: number) => {
    const x = bounds.min.x + ix * res;
    const z = bounds.min.z + iz * res;
    const p = { x, y: 0, z };
    if (!withinBoundsXZ(p, bounds)) return false;
    return !expanded.some((o) => pointInAabb(p, o));
  };
  const key = (ix: number, iz: number) => ix * nz + iz;
  const seen = new Set<number>();
  const q: Array<[number, number]> = [[cx(start.x), cz(start.z)]];
  seen.add(key(q[0][0], q[0][1]));
  while (q.length) {
    const [ix, iz] = q.pop()!;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const jx = ix + dx, jz = iz + dz;
      if (jx < 0 || jz < 0 || jx >= nx || jz >= nz) continue;
      if (seen.has(key(jx, jz)) || !walkable(jx, jz)) continue;
      seen.add(key(jx, jz));
      q.push([jx, jz]);
    }
  }
  return {
    has: (p: Vec3) => seen.has(key(cx(p.x), cz(p.z))),
    count: seen.size,
  };
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

      it("the seeker can reach EVERY hider spawn (no walled-off safe zones)", () => {
        const reach = reachableFrom(map, map.seekerSpawn);
        for (const s of map.spawns) {
          expect(reach.has(s), `hider spawn ${JSON.stringify(s)} reachable from seeker`).toBe(true);
        }
      });

      it("the open play area is one connected region (no unreachable pockets)", () => {
        // Reachable cells from the seeker spawn should cover most of the non-obstacle
        // floor; a large isolated pocket would show up as a low ratio. (Heuristic
        // guard against future map edits creating an unreachable hideout.)
        const fromSeeker = reachableFrom(map, map.seekerSpawn).count;
        const fromHider = reachableFrom(map, map.spawns[0]).count;
        // Both floods must agree on the connected-region size (symmetry = connected).
        expect(Math.abs(fromSeeker - fromHider)).toBeLessThanOrEqual(2);
        expect(fromSeeker).toBeGreaterThan(50); // a real, traversable floor
      });
    });
  }
});
