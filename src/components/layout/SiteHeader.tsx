import Link from "next/link";
import { SITE_NAME } from "@/lib/site";

/**
 * Platform header: wordmark (home link) + minimal nav. Shown on catalog and
 * game-detail pages. The immersive in-game room intentionally uses its own
 * slimmer header instead.
 */
export default function SiteHeader() {
  return (
    <header className="w-full border-b border-line/60">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-4 sm:px-6">
        <Link
          href="/"
          className="flex items-center gap-2.5 transition hover:opacity-90"
          aria-label={`${SITE_NAME} ホーム`}
        >
          <span className="flex items-center gap-1" aria-hidden>
            <span className="stone stone-black !h-4 !w-4 !animate-none" />
            <span className="stone stone-white !h-4 !w-4 !animate-none" />
          </span>
          <span className="text-base font-semibold tracking-tight text-ink">
            {SITE_NAME}
          </span>
        </Link>
        <nav>
          <Link
            href="/"
            className="rounded-lg px-3 py-2 text-sm font-medium text-muted transition hover:text-ink"
          >
            ゲーム一覧
          </Link>
        </nav>
      </div>
    </header>
  );
}
