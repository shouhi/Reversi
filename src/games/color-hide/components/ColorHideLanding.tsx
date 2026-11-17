"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import SiteHeader from "@/components/layout/SiteHeader";
import SiteFooter from "@/components/layout/SiteFooter";
import {
  apiCreateRoom,
  getStoredNickname,
  storeNickname,
  storePlayerId,
  storeToken,
} from "../lib/clientApi";

const PaintStudio = dynamic(() => import("./paint/PaintStudio"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[60vh] items-center justify-center text-muted">
      3Dスタジオを読み込み中…
    </div>
  ),
});

/** Extracts a room id from a pasted room URL or raw code. */
function parseRoomCode(input: string): string | null {
  const trimmed = input.trim();
  const m = trimmed.match(/room\/([a-z0-9]+)/i);
  const code = (m ? m[1] : trimmed).toLowerCase();
  return /^[a-z0-9]{6,64}$/.test(code) ? code : null;
}

export default function ColorHideLanding() {
  const router = useRouter();
  const [nickname, setNickname] = useState(getStoredNickname());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [practice, setPractice] = useState(false);

  async function createRoom() {
    setBusy(true);
    setError(null);
    const name = nickname.trim() || "ホスト";
    storeNickname(name);
    const res = await apiCreateRoom(name);
    if (res.ok) {
      storeToken(res.data.roomId, res.data.token);
      storePlayerId(res.data.roomId, res.data.playerId);
      router.push(`/games/color-hide/room/${res.data.roomId}`);
    } else {
      setBusy(false);
      setError(res.message);
    }
  }

  function joinRoom() {
    const code = parseRoomCode(joinCode);
    if (!code) {
      setError("ルームコードまたは招待URLを確認してください。");
      return;
    }
    if (nickname.trim()) storeNickname(nickname.trim());
    router.push(`/games/color-hide/room/${code}`);
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">
        <nav aria-label="パンくず" className="mb-5">
          <Link
            href="/"
            className="text-sm text-muted underline-offset-4 hover:text-ink hover:underline"
          >
            ← ゲーム一覧
          </Link>
        </nav>

        <section className="max-w-2xl">
          <span className="inline-block rounded-full bg-raised px-3 py-1 text-xs font-medium text-accent ring-1 ring-line">
            3Dオンライン・かくれんぼ
          </span>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-ink sm:text-4xl">
            COLOR HIDE
          </h1>
          <p className="mt-3 text-base leading-relaxed text-muted">
            自分のキャラクターに自由に絵を描いて景色に擬態し、3D空間に隠れる。
            鬼に見つからず逃げ切ろう。URLを送るだけで友達が参加できます（2〜6人）。
          </p>
        </section>

        {practice ? (
          <section className="mt-6">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-ink">ペイント練習</h2>
              <button
                type="button"
                onClick={() => setPractice(false)}
                className="text-sm text-muted underline-offset-4 hover:text-ink hover:underline"
              >
                閉じる
              </button>
            </div>
            <PaintStudio />
          </section>
        ) : (
          <section className="mt-8 grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-line bg-surface p-5">
              <h2 className="text-lg font-semibold text-ink">部屋を作る</h2>
              <p className="mt-1 text-sm text-muted">
                ホストになって招待URLを発行します。
              </p>
              <label className="mt-4 block text-xs font-medium text-muted">
                ニックネーム
                <input
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  maxLength={20}
                  placeholder="あなたの名前"
                  className="mt-1 w-full rounded-md border border-line bg-bg px-3 py-2 text-ink outline-none focus:border-accent"
                />
              </label>
              <button
                type="button"
                onClick={createRoom}
                disabled={busy}
                className="mt-4 w-full rounded-lg bg-accent px-4 py-2.5 font-semibold text-bg disabled:opacity-50"
              >
                {busy ? "作成中…" : "部屋を作る"}
              </button>
            </div>

            <div className="rounded-xl border border-line bg-surface p-5">
              <h2 className="text-lg font-semibold text-ink">参加する</h2>
              <p className="mt-1 text-sm text-muted">
                招待URLまたはルームコードを貼り付けてください。
              </p>
              <input
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                placeholder="https://… / ルームコード"
                className="mt-4 w-full rounded-md border border-line bg-bg px-3 py-2 text-ink outline-none focus:border-accent"
              />
              <button
                type="button"
                onClick={joinRoom}
                className="mt-4 w-full rounded-lg bg-raised px-4 py-2.5 font-semibold text-ink ring-1 ring-line"
              >
                参加する
              </button>
              <button
                type="button"
                onClick={() => setPractice(true)}
                className="mt-3 w-full text-sm text-accent underline-offset-4 hover:underline"
              >
                まずはペイントを試す →
              </button>
            </div>
          </section>
        )}

        {error && (
          <p className="mt-4 rounded-md bg-raised px-3 py-2 text-sm text-red-300 ring-1 ring-line">
            {error}
          </p>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
