import { createRoom } from "@/games/connect-four/lib/roomService";
import { jsonResponse, storageUnavailable } from "@/lib/apiHelpers";
import {
  errorResponse,
  resolveConnectFourStore,
} from "@/games/connect-four/lib/api";

export const dynamic = "force-dynamic";

/** POST /api/games/connect-four/rooms — create a room; creator is red (first). */
export async function POST(): Promise<Response> {
  const resolved = resolveConnectFourStore();
  if (resolved.response) return resolved.response;

  try {
    const result = await createRoom(resolved.store);
    if (!result.ok) return errorResponse(result.error);

    return jsonResponse(
      {
        roomId: result.value.roomId,
        token: result.value.token,
        publicState: result.value.publicState,
      },
      201,
    );
  } catch (e) {
    return storageUnavailable(e);
  }
}
