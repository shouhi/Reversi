import { joinRoom } from "@/games/memory/lib/roomService";
import { isValidRoomId } from "@/lib/tokens";
import { jsonResponse, storageUnavailable } from "@/lib/apiHelpers";
import {
  errorResponse,
  getMemoryToken,
  resolveMemoryStore,
} from "@/games/memory/lib/api";

export const dynamic = "force-dynamic";

/** POST /api/games/memory/rooms/:roomId/join — claim the プレイヤー2 seat (or reconnect). */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ roomId: string }> },
): Promise<Response> {
  const { roomId } = await params;
  if (!isValidRoomId(roomId)) {
    return errorResponse({
      code: "not_found",
      message: "This room does not exist or has expired.",
    });
  }

  const resolved = resolveMemoryStore();
  if (resolved.response) return resolved.response;

  try {
    const result = await joinRoom(resolved.store, roomId, getMemoryToken(req));
    if (!result.ok) return errorResponse(result.error);

    return jsonResponse({
      token: result.value.token ?? null,
      publicState: result.value.publicState,
    });
  } catch (e) {
    return storageUnavailable(e);
  }
}
