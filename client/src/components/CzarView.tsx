"use client";

import { useState, useRef, useCallback } from "react";
import { useGameStore, type GameType } from "@/lib/store";
import { useSocket } from "@/lib/useSocket";
import { getSocket } from "@/lib/socket";
import CardPreview from "./CardPreview";

export default function CzarView({ isCzar }: { isCzar: boolean }) {
  const { round, gameType, lobby } = useGameStore();
  const { pickWinner, spectatorVote } = useSocket();
  const isJH = gameType === "joking_hazard";
  const [selected, setSelected] = useState<string | null>(null);
  const [hasVoted, setHasVoted] = useState(false);
  const [previewText, setPreviewText] = useState<string | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggered = useRef(false);

  const socket = getSocket();
  const isSpectator = lobby?.players.find(p => p.id === socket.id)?.isSpectator;
  const canVote = isSpectator && !isCzar && !hasVoted;

  const startLongPress = useCallback((text: string) => {
    longPressTriggered.current = false;
    longPressTimer.current = setTimeout(() => {
      longPressTriggered.current = true;
      setPreviewText(text);
    }, 500);
  }, []);

  const cancelLongPress = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  if (!round || round.phase !== "judging") return null;

  const handlePick = () => {
    if (selected && isCzar) {
      pickWinner(selected);
    }
  };

  const handleSpectatorVote = () => {
    if (selected && canVote) {
      spectatorVote(selected);
      setHasVoted(true);
    }
  };

  const canSelect = isCzar || canVote;

  return (
    <div>
      <p className="text-center text-gray-400 text-sm mb-4">
        {isCzar
          ? isJH ? "Pick the funniest punchline!" : "Pick the funniest answer!"
          : hasVoted
            ? "Voted! Waiting for the " + (isJH ? "Judge" : "Czar") + " to decide..."
            : isSpectator
              ? "Vote for your favorite!"
              : isJH ? "The Judge is choosing a winner..." : "The Czar is choosing a winner..."}
      </p>

      <div className="grid grid-cols-1 gap-3 max-w-lg mx-auto">
        {round.submissions.map((sub, i) => (
          <button
            key={i}
            disabled={!canSelect}
            onClick={() => {
              if (longPressTriggered.current) return;
              if (canSelect) setSelected(sub.playerId);
            }}
            onTouchStart={() => startLongPress(sub.cards.map(c => c.text).join(" / "))}
            onTouchEnd={cancelLongPress}
            onTouchCancel={cancelLongPress}
            onMouseDown={() => startLongPress(sub.cards.map(c => c.text).join(" / "))}
            onMouseUp={cancelLongPress}
            onMouseLeave={cancelLongPress}
            className={`p-4 rounded-xl text-left transition-all ${
              selected === sub.playerId
                ? isCzar
                  ? "bg-purple-600 border-2 border-purple-400"
                  : "bg-yellow-600 border-2 border-yellow-400"
                : canSelect
                  ? "bg-gray-800 border-2 border-gray-700 hover:border-gray-500"
                  : "bg-gray-800 border-2 border-gray-700"
            }`}
          >
            {sub.cards.map((card, j) => (
              <p key={j} className="font-medium">
                {sub.cards.length > 1 && (
                  <span className="text-xs text-purple-300 mr-2">
                    {isJH && round?.isBonus ? `Panel ${j + 1}` : `#${j + 1}`}
                  </span>
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

      {canVote && selected && (
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-gray-950/90 backdrop-blur border-t border-gray-800">
          <button
            onClick={handleSpectatorVote}
            className="w-full max-w-lg mx-auto block py-3 bg-yellow-600 hover:bg-yellow-700 rounded-lg font-semibold text-lg transition-colors"
          >
            Cast Vote
          </button>
        </div>
      )}

      {previewText && (
        <CardPreview text={previewText} onClose={() => setPreviewText(null)} />
      )}
    </div>
  );
}
