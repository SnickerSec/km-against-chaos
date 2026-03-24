"use client";

import { useState } from "react";
import { useGameStore } from "@/lib/store";
import { useSocket } from "@/lib/useSocket";

export default function CzarView({ isCzar }: { isCzar: boolean }) {
  const { round } = useGameStore();
  const { pickWinner } = useSocket();
  const [selected, setSelected] = useState<string | null>(null);

  if (!round || round.phase !== "judging") return null;

  const handlePick = () => {
    if (selected && isCzar) {
      pickWinner(selected);
    }
  };

  return (
    <div>
      <p className="text-center text-gray-400 text-sm mb-4">
        {isCzar
          ? "Pick the funniest answer!"
          : "The Czar is choosing a winner..."}
      </p>

      <div className="grid grid-cols-1 gap-3 max-w-lg mx-auto">
        {round.submissions.map((sub, i) => (
          <button
            key={i}
            disabled={!isCzar}
            onClick={() => isCzar && setSelected(sub.playerId)}
            className={`p-4 rounded-xl text-left transition-all ${
              selected === sub.playerId
                ? "bg-purple-600 border-2 border-purple-400"
                : isCzar
                  ? "bg-gray-800 border-2 border-gray-700 hover:border-gray-500"
                  : "bg-gray-800 border-2 border-gray-700"
            }`}
          >
            {sub.cards.map((card, j) => (
              <p key={j} className="font-medium">
                {sub.cards.length > 1 && (
                  <span className="text-xs text-purple-300 mr-2">#{j + 1}</span>
                )}
                {card.text}
              </p>
            ))}
          </button>
        ))}
      </div>

      {isCzar && selected && (
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-gray-950/90 backdrop-blur border-t border-gray-800">
          <button
            onClick={handlePick}
            className="w-full max-w-lg mx-auto block py-3 bg-purple-600 hover:bg-purple-700 rounded-lg font-semibold text-lg transition-colors"
          >
            Pick Winner
          </button>
        </div>
      )}
    </div>
  );
}
