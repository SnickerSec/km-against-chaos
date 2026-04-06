"use client";

import { useState, useRef, useEffect } from "react";
import { Icon } from "@iconify/react";
import { useGameStore } from "@/lib/store";
import PlayerAvatar from "./PlayerAvatar";
import { isMuted, toggleMute } from "@/lib/sounds";

export default function ScoreBar() {
  const { scores, lobby } = useGameStore();
  const [open, setOpen] = useState(false);
  const [muted, setMuted] = useState(() => (typeof window !== "undefined" ? isMuted() : false));
  const btnRef = useRef<HTMLButtonElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, right: 0 });

  // Position dropdown relative to button using fixed coords
  const openDropdown = () => {
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 8, right: window.innerWidth - r.right });
    }
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (
        btnRef.current?.contains(e.target as Node) ||
        dropRef.current?.contains(e.target as Node)
      ) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  if (!lobby) return null;

  const sorted = lobby.players
    .map((p) => ({ id: p.id, name: p.name, score: scores[p.id] || 0, isBot: p.isBot }))
    .sort((a, b) => b.score - a.score);

  const leader = sorted[0];

  return (
    <>
      <button
        onClick={() => setMuted(toggleMute())}
        className="text-gray-500 hover:text-gray-300 transition-colors"
        aria-label={muted ? "Unmute sounds" : "Mute sounds"}
        title={muted ? "Unmute sounds" : "Mute sounds"}
      >
        <Icon icon={muted ? "mdi:volume-off" : "mdi:volume-high"} className="text-base" />
      </button>
      <button
        ref={btnRef}
        onClick={() => open ? setOpen(false) : openDropdown()}
        className="flex items-center gap-1.5 text-sm text-gray-300 hover:text-white transition-colors"
        aria-label="Leaderboard"
      >
        <Icon icon="mdi:trophy" className="text-yellow-400 text-base" />
        <span className="font-medium">{leader.name}</span>
        <strong className="text-white">{leader.score}</strong>
        <Icon icon={open ? "mdi:chevron-up" : "mdi:chevron-down"} className="text-gray-500 text-sm" />
      </button>

      {open && (
        <div
          ref={dropRef}
          style={{ position: "fixed", top: pos.top, right: pos.right, zIndex: 9999 }}
          className="w-52 bg-gray-900 border border-gray-700 rounded-xl shadow-xl py-1"
        >
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
    </>
  );
}
