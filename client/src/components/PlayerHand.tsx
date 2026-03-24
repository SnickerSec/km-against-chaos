"use client";

import { useGameStore } from "@/lib/store";
import { useSocket } from "@/lib/useSocket";

export default function PlayerHand() {
  const { hand, selectedCards, round } = useGameStore();
  const { toggleCardSelection } = useGameStore();
  const { submitCards } = useSocket();
  const pick = round?.chaosCard.pick || 1;

  const handleSubmit = () => {
    if (selectedCards.length === pick) {
      submitCards(selectedCards);
    }
  };

  return (
    <div>
      <p className="text-gray-400 text-sm mb-3 text-center">
        {pick > 1
          ? `Pick ${pick} cards in order (1st blank, 2nd blank)`
          : "Pick a card from your hand"}
      </p>
      <div className="grid grid-cols-1 gap-3 max-w-lg mx-auto">
        {hand.map((card) => {
          const selIndex = selectedCards.indexOf(card.id);
          const isSelected = selIndex !== -1;
          return (
            <button
              key={card.id}
              onClick={() => toggleCardSelection(card.id, pick)}
              className={`p-4 rounded-xl text-left transition-all relative ${
                isSelected
                  ? "bg-purple-600 border-2 border-purple-400 scale-[1.02]"
                  : "bg-gray-800 border-2 border-gray-700 hover:border-gray-500"
              }`}
            >
              <p className="font-medium">{card.text}</p>
              {isSelected && pick > 1 && (
                <span className="absolute top-2 right-3 bg-white text-purple-700 text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center">
                  {selIndex + 1}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {selectedCards.length === pick && (
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-gray-950/90 backdrop-blur border-t border-gray-800">
          <button
            onClick={handleSubmit}
            className="w-full max-w-lg mx-auto block py-3 bg-green-600 hover:bg-green-700 rounded-lg font-semibold text-lg transition-colors"
          >
            Submit Card{pick > 1 ? "s" : ""}
          </button>
        </div>
      )}
    </div>
  );
}
