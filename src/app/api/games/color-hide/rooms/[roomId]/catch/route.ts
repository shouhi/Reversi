import { markCaught } from "@/games/color-hide/lib/roomService";
import { isValidRoomId } from "@/lib/tokens";
import { jsonResponse, storageUnavailable } from "@/lib/apiHelpers";
import {
  errorResponse,
  isTrustedRealtime,
  resolveColorHideStore,
} from "@/games/color-hide/lib/api";

export const dynamic = "force-dynamic";

/**
 * POST /api/games/color-hide/rooms/:roomId/catch — the TRUSTED realtime host
 * reports that it validated (distance + line of sight) a catch. Gated behind a
 * shared secret so a browser client can never self-declare a catch. Body: { hiderId }.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ roomId: string }> },
): Promise<Response> {
  if (!isTrustedRealtime(req)) {
    return jsonResponse(
      { error: { code: "forbidden", message: "Realtime host authentication required." } },
      403,
    );
  }

  const { roomId } = await params;
  if (!isValidRoomId(roomId)) {
    return errorResponse({ code: "not_found", message: "Unknown room." });
  }

  const resolved = resolveColorHideStore();
  if (resolved.response) return resolved.response;

  let hiderId: unknown;
  try {
    hiderId = (await req.json())?.hiderId;
  } catch {
    hiderId = undefined;
  }
  if (typeof hiderId !== "string") {
    return errorResponse({ code: "invalid_request", message: "hiderId is required." });
  }

  try {
    const result = await markCaught(resolved.store, roomId, hiderId);
    if (!result.ok) return errorResponse(result.error);
    return jsonResponse({ publicState: result.value });
  } catch (e) {
    return storageUnavailable(e);
  }
}
