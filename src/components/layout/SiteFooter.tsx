import { SITE_NAME } from "@/lib/site";

/** Minimal platform footer. */
export default function SiteFooter() {
  return (
    <footer className="w-full border-t border-line/60">
      <div className="mx-auto flex w-full max-w-5xl flex-col items-center gap-1 px-4 py-8 text-center sm:px-6">
        <p className="text-sm font-medium text-ink">{SITE_NAME}</p>
        <p className="text-xs text-muted">
          登録不要・無料・スマホ対応のブラウザゲーム。
        </p>
      </div>
    </footer>
  );
}
