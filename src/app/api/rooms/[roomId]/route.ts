import { getRoomView } from "@/games/reversi/lib/roomService";
import { isValidRoomId } from "@/lib/tokens";
import { jsonResponse, storageUnavailable } from "@/lib/apiHelpers";
import {
  errorResponse,
  getReversiToken,
  resolveReversiStore,
} from "@/games/reversi/lib/api";

export const dynamic = "force-dynamic";

/** GET /api/rooms/:roomId — current public state (used by the polling loop). */
export async function GET(
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
    const result = await getRoomView(resolved.store, roomId, getReversiToken(req));
    if (!result.ok) return errorResponse(result.error);
    return jsonResponse({ publicState: result.value });
  } catch (e) {
    return storageUnavailable(e);
  }
}
