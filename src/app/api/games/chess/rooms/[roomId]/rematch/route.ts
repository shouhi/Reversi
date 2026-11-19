import { requestRematch } from "@/games/chess/lib/roomService";
import { isValidRoomId } from "@/lib/tokens";
import { jsonResponse, storageUnavailable } from "@/lib/apiHelpers";
import {
  errorResponse,
  getChessToken,
  resolveChessStore,
} from "@/games/chess/lib/api";

export const dynamic = "force-dynamic";

/**
 * POST /api/games/chess/rooms/:roomId/rematch — body: { roundId? }.
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

  const resolved = resolveChessStore();
  if (resolved.response) return resolved.response;

  try {
    const result = await requestRematch(
      resolved.store,
      roomId,
      getChessToken(req),
      roundId,
    );
    if (!result.ok) return errorResponse(result.error);
    return jsonResponse({ publicState: result.value });
  } catch (e) {
    return storageUnavailable(e);
  }
}
