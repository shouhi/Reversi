import { playMove } from "@/games/chess/lib/roomService";
import { isValidRoomId } from "@/lib/tokens";
import { jsonResponse, storageUnavailable } from "@/lib/apiHelpers";
import {
  errorResponse,
  getChessToken,
  resolveChessStore,
} from "@/games/chess/lib/api";
import type { PieceType } from "@/games/chess/lib/engine";

export const dynamic = "force-dynamic";

const PROMO_TYPES: readonly PieceType[] = ["q", "r", "b", "n"];

function readCoord(value: unknown): { row: number; col: number } | null {
  if (typeof value !== "object" || value === null) return null;
  const { row, col } = value as { row?: unknown; col?: unknown };
  if (typeof row !== "number" || typeof col !== "number") return null;
  return { row, col };
}

/** POST /api/games/chess/rooms/:roomId/move — body: { from, to, promotion? }. Server validates. */
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

  const { from, to, promotion } = (body ?? {}) as {
    from?: unknown;
    to?: unknown;
    promotion?: unknown;
  };

  const fromCoord = readCoord(from);
  const toCoord = readCoord(to);
  if (!fromCoord || !toCoord) {
    return errorResponse({
      code: "invalid_request",
      message: "Body must include `from` and `to` with numeric row/col.",
    });
  }

  let promo: PieceType | undefined;
  if (promotion !== undefined && promotion !== null) {
    if (
      typeof promotion !== "string" ||
      !PROMO_TYPES.includes(promotion as PieceType)
    ) {
      return errorResponse({
        code: "invalid_request",
        message: "`promotion` must be one of q, r, b, n.",
      });
    }
    promo = promotion as PieceType;
  }

  const resolved = resolveChessStore();
  if (resolved.response) return resolved.response;

  try {
    const result = await playMove(
      resolved.store,
      roomId,
      getChessToken(req),
      fromCoord,
      toCoord,
      promo,
    );
    if (!result.ok) return errorResponse(result.error);
    return jsonResponse({ publicState: result.value });
  } catch (e) {
    return storageUnavailable(e);
  }
}
