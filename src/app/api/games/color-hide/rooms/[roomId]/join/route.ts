import { joinRoom } from "@/games/color-hide/lib/roomService";
import { isValidRoomId } from "@/lib/tokens";
import { jsonResponse, storageUnavailable } from "@/lib/apiHelpers";
import {
  errorResponse,
  getColorHideToken,
  resolveColorHideStore,
} from "@/games/color-hide/lib/api";

export const dynamic = "force-dynamic";

/** POST /api/games/color-hide/rooms/:roomId/join — join a lobby (or reconnect). */
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

  let nickname: unknown;
  try {
    nickname = (await req.json())?.nickname;
  } catch {
    nickname = undefined;
  }

  try {
    const result = await joinRoom(
      resolved.store,
      roomId,
      getColorHideToken(req),
      nickname,
    );
    if (!result.ok) return errorResponse(result.error);
    return jsonResponse({
      token: result.value.token ?? null,
      playerId: result.value.playerId,
      publicState: result.value.publicState,
    });
  } catch (e) {
    return storageUnavailable(e);
  }
}
