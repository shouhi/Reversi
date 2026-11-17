import type { Metadata } from "next";
import MinecartGame from "@/games/minecart/components/MinecartGame";

export const metadata: Metadata = {
  title: "トロッコダッシュ",
  description:
    "自動で走るトロッコをタップでジャンプ！鉱山の線路の切れ目や障害物を飛び越える1人用の横スクロールアクション。全12ステージ、PC・スマホ対応、登録不要。",
  alternates: { canonical: "/games/minecart" },
  openGraph: {
    title: "トロッコダッシュ — 鉱山を駆け抜けるアクション",
    description:
      "自動で走るトロッコをタップでジャンプ。全12ステージの横スクロールアクション。登録不要・スマホ対応。",
    url: "/games/minecart",
    type: "website",
  },
};

export default function MinecartPage() {
  return <MinecartGame />;
}
