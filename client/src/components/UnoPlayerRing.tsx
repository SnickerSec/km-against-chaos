"use client";

import { useGameStore, PlayerInfo } from "@/lib/store";
import { Icon } from "@iconify/react";

const COLOR_RING: Record<string, string> = {
  red: "ring-red-500",
  blue: "ring-blue-500",
  green: "ring-green-500",
  yellow: "ring-yellow-500",
};

export default function UnoPlayerRing() {
  const { lobby, unoTurn, scores } = useGameStore();
  if (!lobby || !unoTurn) return null;

  const activePlayers = lobby.players.filter(p => !p.isSpectator);

  return (
    <div className="flex justify-center gap-3 flex-wrap px-4">
      {activePlayers.map((player: PlayerInfo) => {
        const isTurn = player.id === unoTurn.currentPlayerId;
        const cardCount = unoTurn.playerCardCounts[player.id] ?? 0;
        const score = scores[player.id] ?? 0;
        const canChallenge = unoTurn.canChallenge === player.id;

        return (
          <div
            key={player.id}
            className={`
              flex flex-col items-center gap-1 px-3 py-2 rounded-xl border transition-all
              ${isTurn
                ? `bg-gray-800 border-purple-500 ring-2 ${COLOR_RING[unoTurn.activeColor] || "ring-purple-500"} scale-105`
                : "bg-gray-900 border-gray-800"
              }
              ${!player.connected ? "opacity-40" : ""}
            `}
          >
            <div className="flex items-center gap-1.5">
              <span className={`text-xs font-medium truncate max-w-[80px] ${isTurn ? "text-white" : "text-gray-400"}`}>
                {player.name}
              </span>
              {player.isBot && <Icon icon="mdi:robot" width={12} className="text-gray-500" />}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-gray-500">{cardCount} cards</span>
              <span className="text-[10px] text-purple-400">{score}pts</span>
            </div>
            {cardCount === 1 && (
              <span className="text-[10px] font-bold text-yellow-400 uppercase">UNO!</span>
            )}
            {canChallenge && (
              <span className="text-[10px] font-bold text-red-400 animate-pulse">Challenge?</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
