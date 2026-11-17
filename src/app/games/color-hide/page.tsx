import type { Metadata } from "next";
import ColorHideLanding from "@/games/color-hide/components/ColorHideLanding";

export const metadata: Metadata = {
  title: "COLOR HIDE — お絵描きかくれんぼ",
  description:
    "自分のキャラクターに絵を描いて景色に擬態し、3D空間で友達とかくれんぼ。鬼から見つからず逃げ切ろう。登録不要・URLを送るだけで2〜6人対戦。",
  alternates: { canonical: "/games/color-hide" },
  openGraph: {
    title: "COLOR HIDE — 3Dお絵描きかくれんぼ",
    description:
      "体に絵を描いて隠れる3Dオンラインかくれんぼ。URLを共有して友達と2〜6人で対戦。",
    url: "/games/color-hide",
    type: "website",
  },
};

export default function ColorHidePage() {
  return <ColorHideLanding />;
}
