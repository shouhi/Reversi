import { resolvePlayerId } from "@/games/color-hide/lib/roomService";
import {
  commitPaint,
  getPaints,
} from "@/games/color-hide/lib/paintService";
import { isValidRoomId } from "@/lib/tokens";
import { jsonResponse, storageUnavailable } from "@/lib/apiHelpers";
import {
  errorResponse,
  getColorHideToken,
  resolveColorHidePaintStore,
  resolveColorHideStore,
} from "@/games/color-hide/lib/api";

export const dynamic = "force-dynamic";

/** GET — all confirmed paints for the room (playerId → data URL). */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ roomId: string }> },
): Promise<Response> {
  const { roomId } = await params;
  if (!isValidRoomId(roomId)) {
    return errorResponse({ code: "not_found", message: "Unknown room." });
  }
  const paintStore = resolveColorHidePaintStore();
  if (paintStore.response) return paintStore.response;
  try {
    const paints = await getPaints(paintStore.store, roomId);
    return jsonResponse({ paints });
  } catch (e) {
    return storageUnavailable(e);
  }
}

/** POST — commit the caller's own paint (ownership derived from their token). */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ roomId: string }> },
): Promise<Response> {
  const { roomId } = await params;
  if (!isValidRoomId(roomId)) {
    return errorResponse({ code: "not_found", message: "Unknown room." });
  }

  const roomStore = resolveColorHideStore();
  if (roomStore.response) return roomStore.response;
  const paintStore = resolveColorHidePaintStore();
  if (paintStore.response) return paintStore.response;

  const token = getColorHideToken(req);
  let paint: unknown;
  try {
    paint = (await req.json())?.paint;
  } catch {
    return errorResponse({ code: "invalid_request", message: "Invalid JSON body." });
  }

  try {
    const playerId = await resolvePlayerId(roomStore.store, roomId, token);
    if (!playerId) {
      return errorResponse({ code: "not_a_player", message: "You are not in this room." });
    }
    const result = await commitPaint(paintStore.store, roomId, playerId, paint);
    if (!result.ok) {
      const status = result.error === "rate_limited" ? 429 : 400;
      return jsonResponse(
        { error: { code: result.error, message: result.message } },
        status,
      );
    }
    return jsonResponse({ bytes: result.value.bytes });
  } catch (e) {
    return storageUnavailable(e);
  }
}
