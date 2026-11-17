import { createRoom } from "@/games/reversi/lib/roomService";
import { jsonResponse, storageUnavailable } from "@/lib/apiHelpers";
import { errorResponse, resolveReversiStore } from "@/games/reversi/lib/api";

// This route touches per-request storage; never statically cached.
export const dynamic = "force-dynamic";

/** POST /api/rooms — create a new room; the creator becomes black (first). */
export async function POST(): Promise<Response> {
  const resolved = resolveReversiStore();
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
