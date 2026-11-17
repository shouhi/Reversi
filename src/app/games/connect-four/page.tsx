import type { Metadata } from "next";
import Link from "next/link";
import SiteHeader from "@/components/layout/SiteHeader";
import SiteFooter from "@/components/layout/SiteFooter";
import CreateRoomButton from "@/games/connect-four/components/CreateRoomButton";
import { connectFourGame } from "@/games/connect-four";

export const metadata: Metadata = {
  title: "四目並べ",
  description:
    "友達と2人でオンライン対戦できる四目並べ（コネクトフォー）。ルームを作って招待URLを送るだけ。登録不要・スマホ対応。",
  alternates: { canonical: "/games/connect-four" },
  openGraph: {
    title: "四目並べ — 友達と2人でオンライン対戦",
    description:
      "ルームを作って招待URLを送るだけで、友達と四目並べを対戦できます。登録不要。",
    url: "/games/connect-four",
    type: "website",
  },
};

const STEPS = [
  "ルームを作成（あなたは赤・先手）",
  "招待URLを友達に共有",
  "友達が参加したら対局開始",
];

export default function ConnectFourStartPage() {
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
          <div className="mb-3 flex items-center gap-2" aria-hidden>
            <span className="block h-7 w-7 rounded-full bg-[#ef4444] shadow-inner" />
            <span className="block h-7 w-7 rounded-full bg-[#fbbf24] shadow-inner" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-ink sm:text-4xl">
            四目並べ
          </h1>
          <p className="mt-4 text-base text-muted">{connectFourGame.description}</p>

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
