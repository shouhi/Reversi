import { getRoomView } from "@/lib/roomService";
import { isValidRoomId } from "@/lib/tokens";
import {
  errorResponse,
  getToken,
  jsonResponse,
  resolveStore,
  storageUnavailable,
} from "@/lib/apiHelpers";

export const dynamic = "force-dynamic";

/** GET /api/rooms/:roomId — current public state (used by the polling loop). */
export async function GET(
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

  const resolved = resolveStore();
  if (resolved.response) return resolved.response;

  try {
    const result = await getRoomView(resolved.store, roomId, getToken(req));
    if (!result.ok) return errorResponse(result.error);
    return jsonResponse({ publicState: result.value });
  } catch (e) {
    return storageUnavailable(e);
  }
}
