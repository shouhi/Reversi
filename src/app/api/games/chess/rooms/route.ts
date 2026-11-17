import { createRoom } from "@/games/chess/lib/roomService";
import { jsonResponse, storageUnavailable } from "@/lib/apiHelpers";
import { errorResponse, resolveChessStore } from "@/games/chess/lib/api";

export const dynamic = "force-dynamic";

/** POST /api/games/chess/rooms — create a room; creator is White (first). */
export async function POST(): Promise<Response> {
  const resolved = resolveChessStore();
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
