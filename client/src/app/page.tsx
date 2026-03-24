"use client";

import { Suspense } from "react";
import { useGameStore } from "@/lib/store";
import HomeScreen from "@/components/HomeScreen";
import LobbyScreen from "@/components/LobbyScreen";
import GameScreen from "@/components/GameScreen";
import GameOverScreen from "@/components/GameOverScreen";

export default function Home() {
  const { screen } = useGameStore();

  switch (screen) {
    case "lobby":
      return <LobbyScreen />;
    case "game":
      return <GameScreen />;
    case "gameover":
      return <GameOverScreen />;
    default:
      return (
        <Suspense>
          <HomeScreen />
        </Suspense>
      );
  }
}
