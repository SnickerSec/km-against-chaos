"use client";

import { Suspense, useEffect } from "react";
import dynamic from "next/dynamic";
import { useGameStore } from "@/lib/store";
import HomeScreen from "@/components/HomeScreen";
import InstallPrompt from "@/components/InstallPrompt";

// Lazy-load screens that only appear after the user joins a game.
// Cuts ~60 KB parsed (ComicPanel, GameScreen, VoiceChat, Chat, RoundWinner,
// CzarView, etc.) off the homepage bundle; users never touch this code
// until they enter a lobby.
const LobbyScreen = dynamic(() => import("@/components/LobbyScreen"), { ssr: false });
const GameScreen = dynamic(() => import("@/components/GameScreen"), { ssr: false });
const GameOverScreen = dynamic(() => import("@/components/GameOverScreen"), { ssr: false });

function ServerRestartBanner() {
  const restarting = useGameStore((s) => s.serverRestarting);
  if (!restarting) return null;
  // Shown after the reconnect-grace timer fires in socket.ts (500ms).
  // Fast reconnects (well under that) stay invisible.
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[9999] bg-gray-800/95 text-gray-200 rounded-full px-3 py-1.5 text-xs shadow-lg flex items-center gap-2 border border-gray-700">
      <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
      Reconnecting…
    </div>
  );
}

/**
 * Keep the URL's ?code=XXXX in sync with the joined lobby so the address
 * bar is shareable mid-game and the code is visible for debugging. The
 * home screen's HomeScreen already reads ?code= as a join prefill, so
 * reloading a shared URL drops you straight into the join flow.
 */
function useRoomCodeInUrl() {
  const code = useGameStore((s) => s.lobby?.code);
  const screen = useGameStore((s) => s.screen);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (code && screen !== "home") {
      if (url.searchParams.get("code") !== code) {
        url.searchParams.set("code", code);
        window.history.replaceState(null, "", url.toString());
      }
    } else if (url.searchParams.has("code")) {
      url.searchParams.delete("code");
      window.history.replaceState(null, "", url.toString());
    }
  }, [code, screen]);
}

export default function Home() {
  const { screen } = useGameStore();
  const restarting = useGameStore((s) => s.serverRestarting);
  useRoomCodeInUrl();

  // Gate pointer events while the banner is up so mid-reconnect clicks
  // (bet, play card, give clue) don't dispatch into a dead socket and
  // vanish. The banner itself and anything outside this wrapper stays
  // interactive so the "Reconnecting…" indicator remains visible and
  // non-game UI (e.g. leaving the page) keeps working.
  return (
    <>
      <ServerRestartBanner />
      <div
        key={screen ?? "home"}
        className={`animate-phase-enter transition-opacity ${
          restarting ? "pointer-events-none opacity-60" : ""
        }`}
        aria-busy={restarting || undefined}
      >
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
