"use client";

import type { KnowledgeCard } from "@/lib/store";

interface Props {
  winnerInfo: {
    winnerId: string;
    winnerName: string;
    cards: KnowledgeCard[];
  };
  onNext: () => void;
  isHost: boolean;
}

export default function RoundWinner({ winnerInfo, onNext, isHost }: Props) {
  return (
    <div className="text-center mt-4 max-w-lg mx-auto">
      <p className="text-green-400 text-xl font-bold mb-2">
        {winnerInfo.winnerName} wins the round!
      </p>

      <div className="bg-green-900/30 border-2 border-green-600 rounded-xl p-5 mb-6">
        {winnerInfo.cards.map((card, i) => (
          <p key={i} className="text-lg font-medium">
            {card.text}
          </p>
        ))}
      </div>

      {isHost && (
        <button
          onClick={onNext}
          className="py-3 px-8 bg-purple-600 hover:bg-purple-700 rounded-lg font-semibold text-lg transition-colors"
        >
          Next Round
        </button>
      )}

      {!isHost && (
        <p className="text-gray-500 text-sm">
          Waiting for host to start next round...
        </p>
      )}
    </div>
  );
}
