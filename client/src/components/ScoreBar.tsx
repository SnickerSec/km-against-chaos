"use client";

import { useState, useRef, useEffect } from "react";
import { Icon } from "@iconify/react";
import { useGameStore } from "@/lib/store";
import PlayerAvatar from "./PlayerAvatar";

export default function ScoreBar() {
  const { scores, lobby } = useGameStore();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  if (!lobby) return null;

  const sorted = lobby.players
    .map((p) => ({ id: p.id, name: p.name, score: scores[p.id] || 0, isBot: p.isBot }))
    .sort((a, b) => b.score - a.score);

  const leader = sorted[0];

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-sm text-gray-300 hover:text-white transition-colors"
        aria-label="Leaderboard"
      >
        <Icon icon="mdi:trophy" className="text-yellow-400 text-base" />
        <span className="font-medium">{leader.name}</span>
        <strong className="text-white">{leader.score}</strong>
        <Icon icon={open ? "mdi:chevron-up" : "mdi:chevron-down"} className="text-gray-500 text-sm" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-52 bg-gray-900 border border-gray-700 rounded-xl shadow-xl z-50 py-1 overflow-hidden">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider px-3 pt-2 pb-1">Leaderboard</p>
          {sorted.map((p, i) => (
            <div key={p.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-800 transition-colors">
              <span className="text-xs w-4 text-gray-500 text-right shrink-0">
                {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`}
              </span>
              <PlayerAvatar name={p.name} isBot={p.isBot} size="sm" />
              <span className="text-sm text-gray-300 truncate flex-1">{p.name}</span>
              <strong className="text-white text-sm shrink-0">{p.score}</strong>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
