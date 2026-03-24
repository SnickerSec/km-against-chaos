"use client";

import { useGameStore } from "@/lib/store";
import { useSocket } from "@/lib/useSocket";

export default function GameOverScreen() {
  const { scores, lobby, reset } = useGameStore();
  const { leaveLobby } = useSocket();

  const sorted = lobby
    ? lobby.players
        .map((p) => ({ name: p.name, score: scores[p.id] || 0 }))
        .sort((a, b) => b.score - a.score)
    : [];

  const winner = sorted[0];

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
        {sorted.map((p, i) => (
          <div
            key={p.name}
            className={`flex items-center justify-between px-4 py-3 rounded-lg ${
              i === 0 ? "bg-yellow-600/20 border border-yellow-600" : "bg-gray-800"
            }`}
          >
            <span className="font-medium">
              {i === 0 ? "🏆 " : ""}
              {p.name}
            </span>
            <span className="font-bold text-lg">{p.score}</span>
          </div>
        ))}
      </div>

      <button
        onClick={handlePlayAgain}
        className="py-3 px-8 bg-purple-600 hover:bg-purple-700 rounded-lg font-semibold text-lg transition-colors"
      >
        Play Again
      </button>
    </div>
  );
}
