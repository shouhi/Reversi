"use client";

import { useEffect, useState } from "react";

export default function SharePanel({ roomId }: { roomId: string }) {
  const [url, setUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [canShare, setCanShare] = useState(false);

  useEffect(() => {
    setUrl(`${window.location.origin}/games/tic-tac-toe/room/${roomId}`);
    setCanShare(typeof navigator !== "undefined" && !!navigator.share);
  }, [roomId]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  async function share() {
    try {
      await navigator.share({
        title: "○×ゲームで対戦しよう",
        text: "○×ゲームで対戦しよう！このURLから参加してね。",
        url,
      });
    } catch {
      /* user cancelled or share failed — no-op */
    }
  }

  return (
    <div className="w-full">
      <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted">
        招待URL
      </label>
      <div className="flex items-center gap-2 rounded-lg border border-line bg-bg/60 px-3 py-2">
        <input
          readOnly
          value={url}
          aria-label="招待URL"
          data-testid="invite-url"
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 truncate bg-transparent text-sm text-ink outline-none"
        />
      </div>

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={copy}
          data-testid="copy-url"
          className="flex-1 rounded-lg bg-raised px-4 py-3 text-sm font-semibold text-ink transition active:scale-[0.98]"
        >
          {copied ? "コピーしました ✓" : "URLをコピー"}
        </button>
        {canShare && (
          <button
            type="button"
            onClick={share}
            className="flex-1 rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-black transition active:scale-[0.98]"
          >
            共有
          </button>
        )}
      </div>
    </div>
  );
}
