import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center px-6 py-12 text-center">
      <h1 className="text-4xl font-bold tracking-[0.15em] text-ink">404</h1>
      <p className="mt-4 text-sm leading-relaxed text-muted">
        ページが見つかりません。ルームが存在しないか、期限切れの可能性があります。
      </p>
      <Link
        href="/"
        className="mt-8 w-full rounded-xl bg-accent px-6 py-4 text-base font-semibold text-black transition active:scale-[0.98]"
      >
        ゲーム一覧へ戻る
      </Link>
    </main>
  );
}
