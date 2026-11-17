import type { Metadata } from "next";
import Link from "next/link";
import SiteHeader from "@/components/layout/SiteHeader";
import SiteFooter from "@/components/layout/SiteFooter";
import CreateRoomButton from "@/games/reversi/components/CreateRoomButton";
import { reversiGame } from "@/games/reversi";

export const metadata: Metadata = {
  title: "リバーシ（オセロ）",
  description:
    "友達と2人でオンライン対戦できるリバーシ（オセロ）。ルームを作って招待URLを送るだけ。登録不要・スマホ対応。",
  alternates: { canonical: "/games/reversi" },
  openGraph: {
    title: "リバーシ（オセロ） — 友達と2人でオンライン対戦",
    description:
      "ルームを作って招待URLを送るだけで、友達とリバーシ（オセロ）を対戦できます。登録不要。",
    url: "/games/reversi",
    type: "website",
  },
};

const STEPS = [
  "ルームを作成（あなたは黒・先手）",
  "招待URLを友達に共有",
  "友達が参加したら対局開始",
];

export default function ReversiStartPage() {
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
          <div className="mb-3 flex items-center gap-3" aria-hidden>
            <span className="stone stone-black !h-5 !w-5 !animate-none" />
            <span className="stone stone-white !h-5 !w-5 !animate-none" />
          </div>
          <h1 className="text-4xl font-bold tracking-[0.18em] text-ink sm:text-5xl">
            REVERSI
          </h1>
          <p className="mt-4 text-base text-muted">{reversiGame.description}</p>

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
