import { playMove } from "@/games/memory/lib/roomService";
import { isValidRoomId } from "@/lib/tokens";
import { jsonResponse, storageUnavailable } from "@/lib/apiHelpers";
import {
  errorResponse,
  getMemoryToken,
  resolveMemoryStore,
} from "@/games/memory/lib/api";

export const dynamic = "force-dynamic";

/** POST /api/games/memory/rooms/:roomId/move — body: { index }. Server validates. */
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

  const { index, roundId } = (body ?? {}) as {
    index?: unknown;
    roundId?: unknown;
  };
  if (typeof index !== "number") {
    return errorResponse({
      code: "invalid_request",
      message: "Body must include a numeric `index`.",
    });
  }

  const resolved = resolveMemoryStore();
  if (resolved.response) return resolved.response;

  try {
    const result = await playMove(
      resolved.store,
      roomId,
      getMemoryToken(req),
      index,
      typeof roundId === "number" ? roundId : undefined,
    );
    if (!result.ok) return errorResponse(result.error);
    return jsonResponse({ publicState: result.value });
  } catch (e) {
    return storageUnavailable(e);
  }
}
