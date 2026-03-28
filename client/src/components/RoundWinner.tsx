"use client";

import { useGameStore, type KnowledgeCard } from "@/lib/store";
import ComicPanel from "./ComicPanel";

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
  const { gameType, round } = useGameStore();
  const isJH = gameType === "joking_hazard";

  return (
    <div className="text-center mt-4 max-w-2xl mx-auto">
      <p className="text-green-400 text-xl font-bold mb-2">
        {winnerInfo.winnerName} wins the round!
      </p>

      {isJH && round ? (
        round.isBonus ? (
          /* Bonus round reveal: winner's 2 cards = Panels 1+2, drawn red card = Panel 3 */
          <div>
            <div className="text-center mb-3">
              <span className="inline-block bg-red-600 text-white text-xs px-3 py-1 rounded-full font-bold uppercase tracking-wider">
                Bonus Round — 2 Points
              </span>
            </div>
            <div className="flex gap-2 sm:gap-3 mb-6">
              <ComicPanel text={winnerInfo.cards[0]?.text || ""} cardId={winnerInfo.cards[0]?.id} borderColor="green" label="Panel 1" labelColor="text-green-400" />
              <ComicPanel text={winnerInfo.cards[1]?.text || ""} cardId={winnerInfo.cards[1]?.id} borderColor="green" label="Panel 2" labelColor="text-green-400" />
              <ComicPanel text={round.chaosCard.text} cardId={round.chaosCard.id} borderColor="red" label="Panel 3" labelColor="text-red-400" />
            </div>
          </div>
        ) : (
          /* Regular round reveal: drawn card = Panel 1, judge = Panel 2, winner = Panel 3 */
          <div className="flex gap-2 sm:gap-3 mb-6">
            <ComicPanel text={round.chaosCard.text} cardId={round.chaosCard.id} borderColor="black" label="Panel 1" labelColor="text-gray-400" />
            <ComicPanel text={round.czarSetupCard?.text || ""} cardId={round.czarSetupCard?.id} borderColor="purple" label="Panel 2" labelColor="text-purple-400" />
            <ComicPanel text={winnerInfo.cards[0]?.text || ""} cardId={winnerInfo.cards[0]?.id} borderColor="green" label="Panel 3" labelColor="text-green-400" />
          </div>
        )
      ) : (
        <div className="bg-green-900/30 border-2 border-green-600 rounded-xl p-5 mb-6 max-w-lg mx-auto">
          {winnerInfo.cards.map((card, i) => (
            <p key={i} className="text-lg font-medium">
              {card.text}
            </p>
          ))}
        </div>
      )}

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
