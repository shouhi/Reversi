"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiCreateRoom, storeToken } from "../lib/clientApi";

export default function CreateRoomButton({
  label = "対戦ルームを作成",
  className = "",
}: {
  label?: string;
  className?: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    if (loading) return;
    setLoading(true);
    setError(null);

    const result = await apiCreateRoom();
    if (!result.ok) {
      setError(result.message);
      setLoading(false);
      return;
    }

    storeToken(result.data.roomId, result.data.token);
    // Keep the spinner up through navigation.
    router.push(`/games/shogi/room/${result.data.roomId}`);
  }

  return (
    <div className={className}>
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        className="w-full rounded-xl bg-accent px-6 py-4 text-base font-semibold text-black shadow-lg shadow-accent/20 transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 sm:text-lg"
      >
        {loading ? "作成中…" : label}
      </button>
      {error && (
        <p className="mt-3 text-center text-sm text-red-400" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
