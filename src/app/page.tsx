import CreateRoomButton from "@/components/CreateRoomButton";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center px-6 py-12">
      <div className="flex w-full flex-col items-center text-center">
        {/* Wordmark */}
        <div className="mb-3 flex items-center gap-3" aria-hidden>
          <span className="stone stone-black !h-5 !w-5 !animate-none" />
          <span className="stone stone-white !h-5 !w-5 !animate-none" />
        </div>
        <h1 className="text-5xl font-bold tracking-[0.2em] text-ink sm:text-6xl">
          REVERSI
        </h1>
        <p className="mt-4 text-base text-muted">友達と2人でオンライン対戦</p>

        <div className="mt-12 w-full">
          <CreateRoomButton />
          <p className="mt-4 text-sm leading-relaxed text-muted">
            ルームを作成すると招待URLが発行されます。
            <br />
            友達にURLを送るだけで、すぐに対戦できます。
          </p>
        </div>

        <ol className="mt-12 w-full space-y-3 text-left text-sm text-muted">
          <li className="flex gap-3">
            <span className="font-mono text-accent">1.</span>
            ルームを作成（あなたは黒・先手）
          </li>
          <li className="flex gap-3">
            <span className="font-mono text-accent">2.</span>
            招待URLを友達に共有
          </li>
          <li className="flex gap-3">
            <span className="font-mono text-accent">3.</span>
            友達が参加したら対局開始
          </li>
        </ol>
      </div>

      <footer className="mt-16 text-xs text-muted/70">
        登録不要・無料・スマホ対応
      </footer>
    </main>
  );
}
