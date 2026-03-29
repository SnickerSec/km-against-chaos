"use client";

import { Suspense } from "react";
import { useGameStore } from "@/lib/store";
import HomeScreen from "@/components/HomeScreen";
import LobbyScreen from "@/components/LobbyScreen";
import GameScreen from "@/components/GameScreen";
import GameOverScreen from "@/components/GameOverScreen";
import InstallPrompt from "@/components/InstallPrompt";

export default function Home() {
  const { screen } = useGameStore();

  return (
    <>
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
