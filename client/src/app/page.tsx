"use client";

import { Suspense } from "react";
import { useGameStore } from "@/lib/store";
import HomeScreen from "@/components/HomeScreen";
import LobbyScreen from "@/components/LobbyScreen";
import GameScreen from "@/components/GameScreen";
import GameOverScreen from "@/components/GameOverScreen";
import InstallPrompt from "@/components/InstallPrompt";

function ServerRestartBanner() {
  const restarting = useGameStore((s) => s.serverRestarting);
  if (!restarting) return null;
  // Subtle corner pill — only shown if the reconnect takes longer than
  // the 2s grace period set in socket.ts. Fast redeploys are invisible.
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[9999] bg-gray-800/95 text-gray-200 rounded-full px-3 py-1.5 text-xs shadow-lg flex items-center gap-2 border border-gray-700">
      <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
      Reconnecting…
    </div>
  );
}

export default function Home() {
  const { screen } = useGameStore();

  return (
    <>
      <ServerRestartBanner />
      <div key={screen ?? "home"} className="animate-phase-enter">
        {screen === "lobby" ? (
          <LobbyScreen />
        ) : screen === "game" ? (
          <GameScreen />
        ) : screen === "gameover" ? (
          <GameOverScreen />
        ) : (
          <Suspense>
            <HomeScreen />
          </Suspense>
        )}
      </div>
      <InstallPrompt />
    </>
  );
}
