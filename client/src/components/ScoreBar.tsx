"use client";

import { useGameStore } from "@/lib/store";

export default function ScoreBar() {
  const { scores, lobby } = useGameStore();

  if (!lobby) return null;

  const sorted = lobby.players
    .map((p) => ({ name: p.name, score: scores[p.id] || 0 }))
    .sort((a, b) => b.score - a.score);

  return (
    <div className="flex gap-3 text-sm">
      {sorted.map((p) => (
        <span key={p.name} className="text-gray-400">
          {p.name}: <strong className="text-white">{p.score}</strong>
        </span>
      ))}
    </div>
  );
}
