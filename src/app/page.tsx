import type { Metadata } from "next";
import SiteHeader from "@/components/layout/SiteHeader";
import SiteFooter from "@/components/layout/SiteFooter";
import GameCard from "@/components/game/GameCard";
import { getAllGames } from "@/games/registry";
import { SITE_NAME, SITE_TAGLINE } from "@/lib/site";

export const metadata: Metadata = {
  title: { absolute: `${SITE_NAME} — 友達と遊ぶブラウザゲーム` },
  description: SITE_TAGLINE,
  alternates: { canonical: "/" },
  openGraph: {
    title: `${SITE_NAME} — 友達と遊ぶブラウザゲーム`,
    description: SITE_TAGLINE,
    url: "/",
    type: "website",
  },
};

export default function HomePage() {
  const games = getAllGames();

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 sm:px-6 sm:py-14">
        <section className="max-w-2xl">
          <h1 className="text-3xl font-bold tracking-tight text-ink sm:text-4xl">
            友達と遊ぶ、ブラウザゲーム
          </h1>
          <p className="mt-3 text-base leading-relaxed text-muted">
            {SITE_TAGLINE}
            <br className="hidden sm:block" />
            登録もインストールも不要。遊びたいゲームを選んでください。
          </p>
        </section>

        <section className="mt-10" aria-label="ゲーム一覧">
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {games.map((game) => (
              <li key={game.id} className="flex">
                <GameCard game={game} />
              </li>
            ))}
          </ul>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
