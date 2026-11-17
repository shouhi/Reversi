import { createRoom } from "@/games/shogi/lib/roomService";
import { jsonResponse, storageUnavailable } from "@/lib/apiHelpers";
import { errorResponse, resolveShogiStore } from "@/games/shogi/lib/api";

export const dynamic = "force-dynamic";

/** POST /api/games/shogi/rooms — create a room; creator is Sente (先手, first). */
export async function POST(): Promise<Response> {
  const resolved = resolveShogiStore();
  if (resolved.response) return resolved.response;

  try {
    const result = await createRoom(resolved.store);
    if (!result.ok) return errorResponse(result.error);

    return jsonResponse(
      {
        roomId: result.value.roomId,
        token: result.value.token,
        publicState: result.value.publicState,
      },
      201,
    );
  } catch (e) {
    return storageUnavailable(e);
  }
}
