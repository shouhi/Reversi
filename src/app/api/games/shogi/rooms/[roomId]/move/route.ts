import { playMove, type MovePayload } from "@/games/shogi/lib/roomService";
import { isValidRoomId } from "@/lib/tokens";
import { jsonResponse, storageUnavailable } from "@/lib/apiHelpers";
import {
  errorResponse,
  getShogiToken,
  resolveShogiStore,
} from "@/games/shogi/lib/api";

export const dynamic = "force-dynamic";

/**
 * POST /api/games/shogi/rooms/:roomId/move — body is a move payload:
 *   - board move: { from: {row,col}, to: {row,col}, promote?: boolean }
 *   - drop:       { drop: DroppableType, to: {row,col} }
 * The server validates and computes the resulting position.
 */
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

  // The roomService performs the full structural + legality validation; here we
  // just forward the raw fields it understands.
  const { from, to, promote, drop, roundId } = (body ?? {}) as Record<
    string,
    unknown
  >;
  const payload: MovePayload = {
    from: from as MovePayload["from"],
    to: to as MovePayload["to"],
    promote: promote as MovePayload["promote"],
    drop: drop as MovePayload["drop"],
  };

  const resolved = resolveShogiStore();
  if (resolved.response) return resolved.response;

  try {
    const result = await playMove(
      resolved.store,
      roomId,
      getShogiToken(req),
      payload,
      typeof roundId === "number" ? roundId : undefined,
    );
    if (!result.ok) return errorResponse(result.error);
    return jsonResponse({ publicState: result.value });
  } catch (e) {
    return storageUnavailable(e);
  }
}
