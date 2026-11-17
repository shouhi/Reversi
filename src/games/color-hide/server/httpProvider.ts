import type { RoomMeta, RoomMetaProvider } from "../net/realtime";
import { RT_SECRET_HEADER, TOKEN_HEADER } from "../lib/realtimeShared";

/**
 * COLOR HIDE — HTTP RoomMetaProvider.
 *
 * The realtime host (local WS host AND the Cloudflare Durable Object) is the
 * authority for EPHEMERAL live positions, but it never owns the DURABLE room
 * record — that stays in the app + Upstash. So the host reads roster/phase/map
 * from the app over HTTP and writes catches back through the secret-gated
 * `/catch` endpoint. This keeps the trust boundary clean: the realtime tier holds
 * no secrets of its own beyond the shared RT secret, and persists nothing.
 *
 * `fetch` is a global in both Node 18+ and the Workers runtime, so this module is
 * environment-agnostic (no node/next imports).
 */

type PublicStateLike = {
  phase: RoomMeta["phase"];
  phaseStartedAt: number;
  mapId: RoomMeta["mapId"];
  seekerId: string | null;
  players: Array<{ id: string; role: RoomMeta["players"][number]["role"]; caught: boolean }>;
};

export function toMeta(p: PublicStateLike): RoomMeta {
  return {
    phase: p.phase,
    phaseStartedAt: p.phaseStartedAt,
    mapId: p.mapId,
    seekerId: p.seekerId,
    players: p.players.map((pl) => ({ id: pl.id, role: pl.role, caught: pl.caught })),
  };
}

export function roomUrl(appUrl: string, roomId: string): string {
  return `${appUrl.replace(/\/$/, "")}/api/games/color-hide/rooms/${encodeURIComponent(roomId)}`;
}

export interface HttpProviderOptions {
  appUrl: string;
  secret: string;
}

export function createHttpProvider(opts: HttpProviderOptions): RoomMetaProvider {
  return {
    async getMeta(roomId) {
      try {
        const res = await fetch(roomUrl(opts.appUrl, roomId));
        if (!res.ok) return null;
        const body = (await res.json()) as { publicState?: PublicStateLike };
        return body.publicState ? toMeta(body.publicState) : null;
      } catch {
        return null;
      }
    },
    async persistCatch(roomId, hiderId) {
      try {
        await fetch(`${roomUrl(opts.appUrl, roomId)}/catch`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            [RT_SECRET_HEADER]: opts.secret,
          },
          body: JSON.stringify({ hiderId }),
        });
      } catch {
        /* best-effort; the next tick re-reads meta anyway */
      }
    },
  };
}

/** Verifies a player's token maps to the claimed id (via the app's own room view). */
export async function authenticate(
  appUrl: string,
  roomId: string,
  playerId: string,
  token: string | undefined,
): Promise<boolean> {
  if (!token) return false;
  try {
    const res = await fetch(roomUrl(appUrl, roomId), {
      headers: { [TOKEN_HEADER]: token },
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { publicState?: { yourId?: string | null } };
    return body.publicState?.yourId === playerId;
  } catch {
    return false;
  }
}
