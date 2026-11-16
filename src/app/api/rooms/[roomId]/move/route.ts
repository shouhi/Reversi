import { playMove } from "@/lib/roomService";
import { isValidRoomId } from "@/lib/tokens";
import {
  errorResponse,
  getToken,
  jsonResponse,
  resolveStore,
  storageUnavailable,
} from "@/lib/apiHelpers";

export const dynamic = "force-dynamic";

/** POST /api/rooms/:roomId/move — body: { row, col }. The server validates. */
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

  const resolved = resolveStore();
  if (resolved.response) return resolved.response;

  try {
    const result = await playMove(
      resolved.store,
      roomId,
      getToken(req),
      row,
      col,
    );
    if (!result.ok) return errorResponse(result.error);
    return jsonResponse({ publicState: result.value });
  } catch (e) {
    return storageUnavailable(e);
  }
}
