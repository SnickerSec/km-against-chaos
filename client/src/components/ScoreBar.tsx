"use client";

import { useGameStore } from "@/lib/store";
import PlayerAvatar from "./PlayerAvatar";

export default function ScoreBar() {
  const { scores, lobby } = useGameStore();

  if (!lobby) return null;

  const sorted = lobby.players
    .map((p) => ({ name: p.name, score: scores[p.id] || 0, isBot: p.isBot }))
    .sort((a, b) => b.score - a.score);

  return (
    <div className="flex gap-3 text-sm overflow-x-auto min-w-0">
      {sorted.map((p) => (
        <span key={p.name} className="text-gray-400 inline-flex items-center gap-1 whitespace-nowrap shrink-0">
          <PlayerAvatar name={p.name} isBot={p.isBot} size="sm" />
          {p.name}: <strong className="text-white">{p.score}</strong>
        </span>
      ))}
    </div>
  );
}
