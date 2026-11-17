import { joinRoom } from "@/games/reversi/lib/roomService";
import { isValidRoomId } from "@/lib/tokens";
import { jsonResponse, storageUnavailable } from "@/lib/apiHelpers";
import {
  errorResponse,
  getReversiToken,
  resolveReversiStore,
} from "@/games/reversi/lib/api";

export const dynamic = "force-dynamic";

/** POST /api/rooms/:roomId/join — claim the white seat (or reconnect). */
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

  const resolved = resolveReversiStore();
  if (resolved.response) return resolved.response;

  try {
    const result = await joinRoom(resolved.store, roomId, getReversiToken(req));
    if (!result.ok) return errorResponse(result.error);

    return jsonResponse({
      // `token` is present only when a new seat was claimed (absent on reconnect).
      token: result.value.token ?? null,
      publicState: result.value.publicState,
    });
  } catch (e) {
    return storageUnavailable(e);
  }
}
