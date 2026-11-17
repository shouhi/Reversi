import { joinRoom } from "@/games/shogi/lib/roomService";
import { isValidRoomId } from "@/lib/tokens";
import { jsonResponse, storageUnavailable } from "@/lib/apiHelpers";
import {
  errorResponse,
  getShogiToken,
  resolveShogiStore,
} from "@/games/shogi/lib/api";

export const dynamic = "force-dynamic";

/** POST /api/games/shogi/rooms/:roomId/join — claim the Gote seat (or reconnect). */
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

  const resolved = resolveShogiStore();
  if (resolved.response) return resolved.response;

  try {
    const result = await joinRoom(resolved.store, roomId, getShogiToken(req));
    if (!result.ok) return errorResponse(result.error);

    return jsonResponse({
      token: result.value.token ?? null,
      publicState: result.value.publicState,
    });
  } catch (e) {
    return storageUnavailable(e);
  }
}
