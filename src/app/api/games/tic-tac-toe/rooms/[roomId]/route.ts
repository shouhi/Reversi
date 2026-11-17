import { getRoomView } from "@/games/tic-tac-toe/lib/roomService";
import { isValidRoomId } from "@/lib/tokens";
import { jsonResponse, storageUnavailable } from "@/lib/apiHelpers";
import {
  errorResponse,
  getTicTacToeToken,
  resolveTicTacToeStore,
} from "@/games/tic-tac-toe/lib/api";

export const dynamic = "force-dynamic";

/** GET /api/games/tic-tac-toe/rooms/:roomId — current public state (polling). */
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

  const resolved = resolveTicTacToeStore();
  if (resolved.response) return resolved.response;

  try {
    const result = await getRoomView(
      resolved.store,
      roomId,
      getTicTacToeToken(req),
    );
    if (!result.ok) return errorResponse(result.error);
    return jsonResponse({ publicState: result.value });
  } catch (e) {
    return storageUnavailable(e);
  }
}
