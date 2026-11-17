import { playMove } from "@/games/connect-four/lib/roomService";
import { isValidRoomId } from "@/lib/tokens";
import { jsonResponse, storageUnavailable } from "@/lib/apiHelpers";
import {
  errorResponse,
  getConnectFourToken,
  resolveConnectFourStore,
} from "@/games/connect-four/lib/api";

export const dynamic = "force-dynamic";

/** POST /api/games/connect-four/rooms/:roomId/move — body: { col }. Server validates. */
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

  const { col } = (body ?? {}) as { col?: unknown };
  if (typeof col !== "number") {
    return errorResponse({
      code: "invalid_request",
      message: "Body must include a numeric `col`.",
    });
  }

  const resolved = resolveConnectFourStore();
  if (resolved.response) return resolved.response;

  try {
    const result = await playMove(
      resolved.store,
      roomId,
      getConnectFourToken(req),
      col,
    );
    if (!result.ok) return errorResponse(result.error);
    return jsonResponse({ publicState: result.value });
  } catch (e) {
    return storageUnavailable(e);
  }
}
