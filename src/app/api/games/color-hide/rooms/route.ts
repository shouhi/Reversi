import { createRoom } from "@/games/color-hide/lib/roomService";
import { jsonResponse, storageUnavailable } from "@/lib/apiHelpers";
import { errorResponse, resolveColorHideStore } from "@/games/color-hide/lib/api";

export const dynamic = "force-dynamic";

/** POST /api/games/color-hide/rooms — create a room; the creator becomes host. */
export async function POST(req: Request): Promise<Response> {
  const resolved = resolveColorHideStore();
  if (resolved.response) return resolved.response;

  let nickname: unknown;
  try {
    nickname = (await req.json())?.nickname;
  } catch {
    nickname = undefined;
  }

  try {
    const result = await createRoom(resolved.store, nickname);
    if (!result.ok) return errorResponse(result.error);
    return jsonResponse(
      {
        roomId: result.value.roomId,
        token: result.value.token,
        playerId: result.value.playerId,
        publicState: result.value.publicState,
      },
      201,
    );
  } catch (e) {
    return storageUnavailable(e);
  }
}
