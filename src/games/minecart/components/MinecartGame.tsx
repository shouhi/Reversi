"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import SiteHeader from "@/components/layout/SiteHeader";
import SiteFooter from "@/components/layout/SiteFooter";
import { STAGES } from "../lib/stages";
import {
  defaultProgress,
  loadProgress,
  recordClear,
  recordReach,
  setSound,
} from "../lib/storage";
import type { MinecartProgress } from "../types";
import StageSelect from "./StageSelect";
import GameCanvas from "./GameCanvas";

export default function MinecartGame() {
  // Start from the default so SSR and the first client render match; hydrate
  // real progress from localStorage after mount.
  const [progress, setProgress] = useState<MinecartProgress>(defaultProgress);
  const [screen, setScreen] = useState<"select" | "play">("select");
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setProgress(loadProgress());
  }, []);

  const stage = STAGES[index];

  const handleToggleSound = (on: boolean) =>
    setProgress((p) => setSound(p, on));

  const handleSelect = (i: number) => {
    setIndex(i);
    setScreen("play");
  };

  const handleClear = (timeMs: number) => {
    setProgress((p) => recordClear(p, stage.id, timeMs));
  };

  const handleReach = (reach: number) => {
    setProgress((p) => recordReach(p, stage.id, reach));
  };

  const handleNext = () => {
    if (index + 1 < STAGES.length) setIndex(index + 1);
  };

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        {screen === "select" ? (
          <>
            <nav aria-label="パンくず" className="mb-5">
              <Link
                href="/"
                className="text-sm text-muted underline-offset-4 hover:text-ink hover:underline"
              >
                ← ゲーム一覧
              </Link>
            </nav>
            <StageSelect
              stages={STAGES}
              progress={progress}
              onSelect={handleSelect}
              onToggleSound={handleToggleSound}
            />
          </>
        ) : (
          <>
            <nav className="mb-4">
              <button
                type="button"
                onClick={() => setScreen("select")}
                className="text-sm text-muted underline-offset-4 hover:text-ink hover:underline"
              >
                ← ステージ選択
              </button>
            </nav>
            <GameCanvas
              key={stage.id}
              stage={stage}
              stageIndex={index}
              totalStages={STAGES.length}
              soundOn={progress.sound}
              bestReach={progress.bestReach[stage.id] ?? 0}
              onToggleSound={handleToggleSound}
              onClear={handleClear}
              onReach={handleReach}
              onExit={() => setScreen("select")}
              onNext={handleNext}
              hasNext={index + 1 < STAGES.length}
            />
          </>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
