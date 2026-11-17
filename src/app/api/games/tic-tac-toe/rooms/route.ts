import { createRoom } from "@/games/tic-tac-toe/lib/roomService";
import { jsonResponse, storageUnavailable } from "@/lib/apiHelpers";
import {
  errorResponse,
  resolveTicTacToeStore,
} from "@/games/tic-tac-toe/lib/api";

export const dynamic = "force-dynamic";

/** POST /api/games/tic-tac-toe/rooms — create a room; creator is ○ (first). */
export async function POST(): Promise<Response> {
  const resolved = resolveTicTacToeStore();
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
