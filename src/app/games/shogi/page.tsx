import type { Metadata } from "next";
import Link from "next/link";
import SiteHeader from "@/components/layout/SiteHeader";
import SiteFooter from "@/components/layout/SiteFooter";
import CreateRoomButton from "@/games/shogi/components/CreateRoomButton";
import { shogiGame } from "@/games/shogi";

export const metadata: Metadata = {
  title: "将棋（Shogi）",
  description:
    "友達と2人でオンライン対戦できる将棋。ルームを作って招待URLを送るだけ。合法手・成り・駒打ち・王手・詰みに対応。登録不要・スマホ対応。",
  alternates: { canonical: "/games/shogi" },
  openGraph: {
    title: "将棋 — 友達と2人でオンライン対戦",
    description:
      "ルームを作って招待URLを送るだけで、友達と将棋を対戦できます。登録不要。",
    url: "/games/shogi",
    type: "website",
  },
};

const STEPS = [
  "ルームを作成（あなたは先手）",
  "招待URLを友達に共有",
  "友達が後手で参加したら対局開始",
];

export default function ShogiStartPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />

      <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center px-6 py-12 text-center">
        <nav aria-label="パンくず" className="mb-6 w-full text-left">
          <Link
            href="/"
            className="text-sm text-muted underline-offset-4 hover:text-ink hover:underline"
          >
            ← ゲーム一覧
          </Link>
        </nav>

        <div className="flex w-full flex-col items-center">
          <div className="mb-3 flex items-center gap-2 text-4xl leading-none" aria-hidden>
            <span className="text-ink">玉</span>
            <span className="text-ink">歩</span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-ink sm:text-4xl">
            将棋
          </h1>
          <p className="mt-4 text-base text-muted">{shogiGame.description}</p>

          <div className="mt-10 w-full">
            <CreateRoomButton />
            <p className="mt-4 text-sm leading-relaxed text-muted">
              ルームを作成すると招待URLが発行されます。
              <br />
              友達にURLを送るだけで、すぐに対戦できます。
            </p>
          </div>

          <ol className="mt-12 w-full space-y-3 text-left text-sm text-muted">
            {STEPS.map((step, i) => (
              <li key={i} className="flex gap-3">
                <span className="font-mono text-accent">{i + 1}.</span>
                {step}
              </li>
            ))}
          </ol>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
