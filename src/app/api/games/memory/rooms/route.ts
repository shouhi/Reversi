import { createRoom } from "@/games/memory/lib/roomService";
import { jsonResponse, storageUnavailable } from "@/lib/apiHelpers";
import { errorResponse, resolveMemoryStore } from "@/games/memory/lib/api";

export const dynamic = "force-dynamic";

/** POST /api/games/memory/rooms — create a room; creator is プレイヤー1 (first). */
export async function POST(): Promise<Response> {
  const resolved = resolveMemoryStore();
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
