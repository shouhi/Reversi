import { requestRematch } from "@/games/shogi/lib/roomService";
import { isValidRoomId } from "@/lib/tokens";
import { jsonResponse, storageUnavailable } from "@/lib/apiHelpers";
import {
  errorResponse,
  getShogiToken,
  resolveShogiStore,
} from "@/games/shogi/lib/api";

export const dynamic = "force-dynamic";

/**
 * POST /api/games/shogi/rooms/:roomId/rematch — body: { roundId? }.
 * Records the caller's rematch vote; the server starts a new round only once
 * BOTH players have voted.
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

  let roundId: number | undefined;
  try {
    const body = (await req.json()) as { roundId?: unknown };
    if (typeof body?.roundId === "number") roundId = body.roundId;
  } catch {
    // An empty/invalid body is fine — roundId is optional.
  }

  const resolved = resolveShogiStore();
  if (resolved.response) return resolved.response;

  try {
    const result = await requestRematch(
      resolved.store,
      roomId,
      getShogiToken(req),
      roundId,
    );
    if (!result.ok) return errorResponse(result.error);
    return jsonResponse({ publicState: result.value });
  } catch (e) {
    return storageUnavailable(e);
  }
}
