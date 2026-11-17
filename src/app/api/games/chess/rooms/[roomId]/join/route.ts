import { joinRoom } from "@/games/chess/lib/roomService";
import { isValidRoomId } from "@/lib/tokens";
import { jsonResponse, storageUnavailable } from "@/lib/apiHelpers";
import {
  errorResponse,
  getChessToken,
  resolveChessStore,
} from "@/games/chess/lib/api";

export const dynamic = "force-dynamic";

/** POST /api/games/chess/rooms/:roomId/join — claim the Black seat (or reconnect). */
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

  const resolved = resolveChessStore();
  if (resolved.response) return resolved.response;

  try {
    const result = await joinRoom(resolved.store, roomId, getChessToken(req));
    if (!result.ok) return errorResponse(result.error);

    return jsonResponse({
      token: result.value.token ?? null,
      publicState: result.value.publicState,
    });
  } catch (e) {
    return storageUnavailable(e);
  }
}
