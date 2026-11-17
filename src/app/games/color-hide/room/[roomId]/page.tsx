import type { Metadata } from "next";
import ColorHideRoom from "@/games/color-hide/components/ColorHideRoom";

export const metadata: Metadata = {
  title: "COLOR HIDE — ルーム",
  description: "3Dお絵描きかくれんぼのルーム。",
  robots: { index: false },
};

export default async function ColorHideRoomPage({
  params,
}: {
  params: Promise<{ roomId: string }>;
}) {
  const { roomId } = await params;
  return <ColorHideRoom roomId={roomId} />;
}
