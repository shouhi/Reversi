import type { Metadata } from "next";
import { notFound } from "next/navigation";
import GameRoom from "@/games/chess/components/GameRoom";
import { isValidRoomId } from "@/lib/tokens";

export const dynamic = "force-dynamic";

// Private, ephemeral game rooms must never be indexed or shared as a preview.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function ChessRoomPage({
  params,
}: {
  params: Promise<{ roomId: string }>;
}) {
  const { roomId } = await params;
  if (!isValidRoomId(roomId)) {
    notFound();
  }
  return <GameRoom roomId={roomId} />;
}
