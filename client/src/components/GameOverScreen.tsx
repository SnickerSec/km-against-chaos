"use client";

import { useGameStore } from "@/lib/store";
import { useSocket } from "@/lib/useSocket";
import { getSocket } from "@/lib/socket";
import PlayerAvatar from "./PlayerAvatar";

export default function GameOverScreen() {
  const { scores, lobby, reset } = useGameStore();
  const { leaveLobby, rematch } = useSocket();
  const socket = getSocket();
  const isHost = lobby?.hostId === socket.id;

  const sorted = lobby
    ? lobby.players
        .filter(p => !p.isSpectator)
        .map((p) => ({ name: p.name, score: scores[p.id] || 0, isBot: p.isBot }))
        .sort((a, b) => b.score - a.score)
    : [];

  const winner = sorted[0];

  // Assign fun titles
  function getTitle(index: number, score: number, total: number): string | null {
    if (total <= 1) return null;
    if (index === 0) return "Champion";
    if (index === 1 && total > 2) return "Runner Up";
    if (index === total - 1 && score === 0) return "Better Luck Next Time";
    if (index === total - 1) return "Underdog";
    return null;
  }

  const handlePlayAgain = () => {
    reset();
    leaveLobby();
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-4">
      <h1 className="text-4xl font-bold mb-2">Game Over!</h1>

      {winner && (
        <p className="text-green-400 text-xl mb-8">
          <strong>{winner.name}</strong> wins with {winner.score} point
          {winner.score !== 1 ? "s" : ""}!
        </p>
      )}

      <div className="w-full max-w-sm space-y-2 mb-8">
        {sorted.map((p, i) => {
          const title = getTitle(i, p.score, sorted.length);
          return (
            <div
              key={p.name}
              className={`flex items-center justify-between px-4 py-3 rounded-lg ${
                i === 0 ? "bg-yellow-600/20 border border-yellow-600" : "bg-gray-800"
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <PlayerAvatar name={p.name} isBot={p.isBot} size="lg" />
                <div className="min-w-0">
                  <span className="font-medium">
                    {i === 0 ? "🏆 " : ""}{p.name}
                  </span>
                  {title && (
                    <p className={`text-xs ${i === 0 ? "text-yellow-400" : "text-gray-500"}`}>
                      {title}
                    </p>
                  )}
                </div>
              </div>
              <span className="font-bold text-lg">{p.score}</span>
            </div>
          );
        })}
      </div>

      <div className="flex flex-col items-center gap-3">
        {isHost ? (
          <button
            onClick={rematch}
            className="py-3 px-8 bg-purple-600 hover:bg-purple-700 rounded-lg font-semibold text-lg transition-colors"
          >
            Rematch
          </button>
        ) : (
          <p className="text-gray-400 text-sm">Waiting for host to start rematch...</p>
        )}
        <button
          onClick={handlePlayAgain}
          className="py-2 px-6 text-gray-400 hover:text-red-400 text-sm transition-colors"
        >
          Leave
        </button>
      </div>
    </div>
  );
}
