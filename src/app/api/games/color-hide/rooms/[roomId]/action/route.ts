import {
  leaveRoom,
  returnToLobby,
  selectMap,
  setNickname,
  setReady,
  startGame,
} from "@/games/color-hide/lib/roomService";
import { isValidRoomId } from "@/lib/tokens";
import { jsonResponse, storageUnavailable } from "@/lib/apiHelpers";
import {
  errorResponse,
  getColorHideToken,
  resolveColorHideStore,
} from "@/games/color-hide/lib/api";

export const dynamic = "force-dynamic";

/**
 * POST /api/games/color-hide/rooms/:roomId/action — lobby/round control.
 * Body: { action: "ready"|"nickname"|"map"|"start"|"lobby"|"leave", ... }
 * Consolidated so the lobby has one endpoint instead of many tiny ones.
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

  const resolved = resolveColorHideStore();
  if (resolved.response) return resolved.response;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return errorResponse({ code: "invalid_request", message: "Invalid JSON body." });
  }

  const token = getColorHideToken(req);
  const { store } = resolved;

  try {
    const action = body.action;
    let result;
    switch (action) {
      case "ready":
        result = await setReady(store, roomId, token, Boolean(body.ready));
        break;
      case "nickname":
        result = await setNickname(store, roomId, token, body.nickname);
        break;
      case "map":
        result = await selectMap(store, roomId, token, body.mapId);
        break;
      case "start":
        result = await startGame(store, roomId, token);
        break;
      case "lobby":
        result = await returnToLobby(store, roomId, token);
        break;
      case "leave":
        result = await leaveRoom(store, roomId, token);
        break;
      default:
        return errorResponse({ code: "invalid_request", message: "Unknown action." });
    }
    if (!result.ok) return errorResponse(result.error);
    return jsonResponse({ publicState: result.value });
  } catch (e) {
    return storageUnavailable(e);
  }
}
