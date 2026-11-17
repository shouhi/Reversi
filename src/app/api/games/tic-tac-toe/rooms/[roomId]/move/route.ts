import { playMove } from "@/games/tic-tac-toe/lib/roomService";
import { isValidRoomId } from "@/lib/tokens";
import { jsonResponse, storageUnavailable } from "@/lib/apiHelpers";
import {
  errorResponse,
  getTicTacToeToken,
  resolveTicTacToeStore,
} from "@/games/tic-tac-toe/lib/api";

export const dynamic = "force-dynamic";

/** POST /api/games/tic-tac-toe/rooms/:roomId/move — body: { row, col }. Server validates. */
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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorResponse({
      code: "invalid_request",
      message: "Request body must be valid JSON.",
    });
  }

  const { row, col } = (body ?? {}) as { row?: unknown; col?: unknown };
  if (typeof row !== "number" || typeof col !== "number") {
    return errorResponse({
      code: "invalid_request",
      message: "Body must include numeric `row` and `col`.",
    });
  }

  const resolved = resolveTicTacToeStore();
  if (resolved.response) return resolved.response;

  try {
    const result = await playMove(
      resolved.store,
      roomId,
      getTicTacToeToken(req),
      row,
      col,
    );
    if (!result.ok) return errorResponse(result.error);
    return jsonResponse({ publicState: result.value });
  } catch (e) {
    return storageUnavailable(e);
  }
}
