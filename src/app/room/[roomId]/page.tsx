import { notFound } from "next/navigation";
import GameRoom from "@/components/GameRoom";
import { isValidRoomId } from "@/lib/tokens";

export const dynamic = "force-dynamic";

export default async function RoomPage({
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
