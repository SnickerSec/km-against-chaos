"use client";

const GAME_TYPE_INFO: Record<string, { label: string; color: string; bg: string }> = {
  cah:              { label: "CAH",           color: "text-red-300",    bg: "bg-red-600/20 border-red-600/40" },
  joking_hazard:    { label: "Joking Hazard", color: "text-orange-300", bg: "bg-orange-600/20 border-orange-600/40" },
  apples_to_apples: { label: "A2A",           color: "text-green-300",  bg: "bg-green-600/20 border-green-600/40" },
  uno:              { label: "Uno",           color: "text-yellow-300", bg: "bg-yellow-600/20 border-yellow-600/40" },
  codenames:        { label: "Codenames",     color: "text-cyan-300",   bg: "bg-cyan-600/20 border-cyan-600/40" },
  superfight:       { label: "Superfight",   color: "text-pink-300",   bg: "bg-pink-600/20 border-pink-600/40" },
  blackjack:        { label: "Blackjack",     color: "text-emerald-300", bg: "bg-emerald-600/20 border-emerald-600/40" },
};

export default function GameTypeBadge({ gameType }: { gameType?: string }) {
  const info = GAME_TYPE_INFO[gameType || "cah"] || GAME_TYPE_INFO.cah;
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-semibold ${info.color} ${info.bg}`}>
      {info.label}
    </span>
  );
}
