"use client";

import { useGameStore, type GameType } from "@/lib/store";
import { useSocket } from "@/lib/useSocket";
import { Icon } from "@iconify/react";
import { useMemo, useState, useRef, useCallback } from "react";
import CardPreview from "./CardPreview";

// Icons used for randomized-icon chaos effect
const CHAOS_ICONS = [
  "mdi:skull", "mdi:fire", "mdi:ghost", "mdi:alien", "mdi:robot",
  "mdi:lightning-bolt", "mdi:biohazard", "mdi:radioactive", "mdi:chess-rook",
  "mdi:shark", "mdi:ninja", "mdi:mushroom", "mdi:ufo", "mdi:bacteria",
];

export default function PlayerHand({
  blurred = false,
  iconsRandomized = false,
  onCardClick,
  singleSelect = false,
}: {
  blurred?: boolean;
  iconsRandomized?: boolean;
  onCardClick?: (cardId: string) => void;
  singleSelect?: boolean;
}) {
  const { hand, selectedCards, round, gameType } = useGameStore();
  const { toggleCardSelection } = useGameStore();
  const { submitCards } = useSocket();
  const pick = singleSelect ? 1 : (round?.chaosCard.pick || 1);

  // Stable randomized icon assignment per card (changes each render when iconsRandomized flips on)
  const cardIcons = useMemo(() => {
    if (!iconsRandomized) return {};
    return Object.fromEntries(
      hand.map((card) => [
        card.id,
        CHAOS_ICONS[Math.floor(Math.random() * CHAOS_ICONS.length)],
      ])
    );
  }, [iconsRandomized, hand]);

  const [previewText, setPreviewText] = useState<string | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggered = useRef(false);

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

  const handleSubmit = () => {
    if (selectedCards.length === pick) {
      submitCards(selectedCards);
    }
  };

  return (
    <div>
      {blurred && (
        <div className="mb-3 text-center text-yellow-400 text-sm font-semibold animate-pulse">
          Your hand is hidden! (Chaos effect)
        </div>
      )}
      {!onCardClick && (
        <p className="text-gray-400 text-sm mb-3 text-center">
          {gameType === "joking_hazard" && round?.isBonus
            ? "Pick 2 cards — Panel 1 (setup) then Panel 2 (build-up)"
            : pick > 1
              ? `Pick ${pick} cards in order (1st blank, 2nd blank)`
              : gameType === "joking_hazard"
                ? "Pick a card as Panel 3 (the punchline)"
                : "Pick a card from your hand"}
        </p>
      )}
      <div className={`grid grid-cols-1 gap-3 max-w-lg mx-auto transition-all duration-500 ${blurred ? "blur-md select-none pointer-events-none" : ""}`}>
        {hand.map((card) => {
          const selIndex = selectedCards.indexOf(card.id);
          const isSelected = selIndex !== -1;
          const chaosIcon = cardIcons[card.id];
          return (
            <button
              key={card.id}
              onClick={() => {
                if (longPressTriggered.current) return;
                if (onCardClick) {
                  onCardClick(card.id);
                } else {
                  toggleCardSelection(card.id, pick);
                }
              }}
              onTouchStart={() => startLongPress(card.text)}
              onTouchEnd={cancelLongPress}
              onTouchCancel={cancelLongPress}
              onMouseDown={() => startLongPress(card.text)}
              onMouseUp={cancelLongPress}
              onMouseLeave={cancelLongPress}
              className={`p-4 rounded-xl text-left transition-all relative ${
                isSelected
                  ? "bg-purple-600 border-2 border-purple-400 scale-[1.02]"
                  : "bg-gray-800 border-2 border-gray-700 hover:border-gray-500"
              }`}
            >
              {chaosIcon ? (
                <div className="flex items-center gap-2">
                  <Icon icon={chaosIcon} width={20} className="shrink-0 text-orange-400" />
                  <p className="font-medium">{card.text}</p>
                </div>
              ) : (
                <p className="font-medium">{card.text}</p>
              )}
              {isSelected && pick > 1 && (
                <span className="absolute top-2 right-3 bg-white text-purple-700 text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center">
                  {selIndex + 1}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {selectedCards.length === pick && !blurred && !onCardClick && (
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-gray-950/90 backdrop-blur border-t border-gray-800">
          <button
            onClick={handleSubmit}
            className="w-full max-w-lg mx-auto block py-3 bg-green-600 hover:bg-green-700 rounded-lg font-semibold text-lg transition-colors"
          >
            Submit Card{pick > 1 ? "s" : ""}
          </button>
        </div>
      )}

      {previewText && (
        <CardPreview text={previewText} onClose={() => setPreviewText(null)} />
      )}
    </div>
  );
}
