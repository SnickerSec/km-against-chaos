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
  return (
    <div className="fixed top-0 inset-x-0 z-[9999] bg-yellow-500 text-black text-center py-2 px-4 text-sm font-medium animate-pulse">
      Server is restarting — reconnecting automatically...
    </div>
  );
}

export default function Home() {
  const { screen } = useGameStore();

  return (
    <>
      <ServerRestartBanner />
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
      <InstallPrompt />
    </>
  );
}
