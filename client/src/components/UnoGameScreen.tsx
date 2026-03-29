"use client";

import { useGameStore, UnoColor } from "@/lib/store";
import { useSocket } from "@/lib/useSocket";
import { getSocket } from "@/lib/socket";
import UnoCard from "./UnoCard";
import UnoColorPicker from "./UnoColorPicker";
import UnoPlayerRing from "./UnoPlayerRing";
import ScoreBar from "./ScoreBar";
import RoundTimer from "./RoundTimer";
import ReactionBar from "./ReactionBar";
import ReactionOverlay from "./ReactionOverlay";
import StickerOverlay from "./StickerOverlay";
import GifOverlay from "./GifOverlay";
import VoiceChat from "./VoiceChat";
import Chat from "./Chat";

const ACTIVE_COLOR_STYLE: Record<string, string> = {
  red: "bg-red-600",
  blue: "bg-blue-600",
  green: "bg-green-600",
  yellow: "bg-yellow-500",
};

const DIRECTION_ICON: Record<number, string> = {
  1: "\u27F3",   // clockwise
  [-1]: "\u27F2", // counterclockwise
};

export default function UnoGameScreen() {
  const {
    unoHand, unoTurn, playableCardIds, selectedUnoCard, choosingColor,
    unoDeckTemplate, unoRoundWinner, lobby, roundNumber, maxRounds, scores,
    unoWinMode, unoTargetPoints,
  } = useGameStore();
  const { playUnoCard, drawUnoCard, callUno, challengeUno, unoNextRound, leaveLobby } = useSocket();
  const socket = getSocket();
  const myId = socket.id;

  if (!unoTurn) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-400 text-lg">Starting Uno game...</p>
      </div>
    );
  }

  const isMyTurn = unoTurn.currentPlayerId === myId;
  const currentPlayerName = lobby?.players.find(p => p.id === unoTurn.currentPlayerId)?.name || "???";
  const isRoundOver = unoTurn.phase === "round_over" || !!unoRoundWinner;

  const handleCardClick = (cardId: string) => {
    if (!isMyTurn || isRoundOver) return;

    const card = unoHand.find(c => c.id === cardId);
    if (!card) return;

    // If it's a wild card, show color picker
    if (card.type === "wild" || card.type === "wild_draw_four") {
      useGameStore.setState({ selectedUnoCard: cardId, choosingColor: true });
      return;
    }

    playUnoCard(cardId);
  };

  const handleColorPick = (color: UnoColor) => {
    if (selectedUnoCard) {
      playUnoCard(selectedUnoCard, color);
    }
  };

  const handleCancelColor = () => {
    useGameStore.setState({ selectedUnoCard: null, choosingColor: false });
  };

  return (
    <div className="flex flex-col min-h-screen">
      <ReactionOverlay />
      <StickerOverlay />
      <GifOverlay />

      {/* Color Picker Modal */}
      {choosingColor && (
        <UnoColorPicker template={unoDeckTemplate} onPick={handleColorPick} onCancel={handleCancelColor} />
      )}

      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-gray-900 border-b border-gray-800">
        <span className="text-sm text-gray-400 inline-flex items-center gap-2">
          {unoWinMode === "single_round"
            ? "Single Round"
            : unoWinMode === "points"
            ? `Round ${roundNumber} \u00B7 First to ${unoTargetPoints}`
            : unoWinMode === "lowest_score"
            ? `Round ${roundNumber} \u00B7 Lowest Score Wins`
            : `Round ${roundNumber}/${maxRounds}`}
          {unoTurn.turnDeadline && !isRoundOver && (
            <RoundTimer deadline={unoTurn.turnDeadline} />
          )}
        </span>
        <div className="flex items-center gap-3">
          <ScoreBar />
          <button
            onClick={() => { if (confirm("Leave the game?")) leaveLobby(); }}
            className="text-gray-500 hover:text-red-400 text-xs transition-colors"
          >
            Leave
          </button>
        </div>
      </div>

      {/* Game Table */}
      <div className="flex-1 flex flex-col items-center justify-center gap-4 px-4 py-6">

        {/* Player Ring */}
        <UnoPlayerRing />

        {/* Direction + Active Color */}
        <div className="flex items-center gap-4">
          <span className="text-2xl" title={unoTurn.direction === 1 ? "Clockwise" : "Counter-clockwise"}>
            {DIRECTION_ICON[unoTurn.direction] || "\u27F3"}
          </span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">Active:</span>
            <span className={`w-6 h-6 rounded-full ${ACTIVE_COLOR_STYLE[unoTurn.activeColor]}`} />
            <span className="text-xs text-gray-300">
              {unoDeckTemplate?.colorNames?.[unoTurn.activeColor] || unoTurn.activeColor}
            </span>
          </div>
        </div>

        {/* Discard + Draw Piles */}
        <div className="flex items-center gap-8">
          {/* Draw Pile */}
          <button
            onClick={isMyTurn && !isRoundOver ? drawUnoCard : undefined}
            disabled={!isMyTurn || isRoundOver}
            className={`
              w-20 h-28 rounded-xl border-2 border-gray-600 bg-gray-800 flex flex-col items-center justify-center
              ${isMyTurn && !isRoundOver ? "cursor-pointer hover:border-purple-500 hover:scale-105" : "opacity-60 cursor-not-allowed"}
              transition-all
            `}
          >
            <span className="text-2xl">🂠</span>
            <span className="text-xs text-gray-400 mt-1">{unoTurn.drawPileCount}</span>
            {isMyTurn && !isRoundOver && (
              <span className="text-[10px] text-purple-400 mt-0.5">Draw</span>
            )}
          </button>

          {/* Discard Pile */}
          <div className="relative">
            <UnoCard card={unoTurn.discardTop} />
          </div>
        </div>

        {/* Last Action */}
        {unoTurn.lastAction && (
          <p className="text-sm text-gray-400 text-center max-w-md">{unoTurn.lastAction}</p>
        )}

        {/* Turn Indicator */}
        <div className="text-center">
          {isRoundOver ? (
            unoRoundWinner && (
              <div className="space-y-3">
                <p className="text-lg font-bold text-yellow-400">
                  {unoWinMode === "single_round"
                    ? `${unoRoundWinner.winnerName} wins!`
                    : unoWinMode === "lowest_score"
                    ? `${unoRoundWinner.winnerName} emptied their hand! Others add card points.`
                    : `${unoRoundWinner.winnerName} wins the round! (+${unoRoundWinner.roundPoints} pts)`}
                </p>
                {unoWinMode === "lowest_score" && (
                  <div className="text-sm text-gray-300 space-y-1">
                    {lobby?.players.map(p => (
                      <div key={p.id} className="flex justify-between max-w-xs mx-auto">
                        <span>{p.name}</span>
                        <span className={scores[p.id] >= unoTargetPoints ? "text-red-400 font-bold" : "text-gray-400"}>
                          {scores[p.id] || 0} pts
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {unoWinMode !== "single_round" && (
                  <button
                    onClick={unoNextRound}
                    className="px-6 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-full font-medium transition-colors"
                  >
                    Next Round
                  </button>
                )}
              </div>
            )
          ) : isMyTurn ? (
            <span className="inline-block bg-purple-600 text-sm px-3 py-1 rounded-full font-semibold">
              Your turn!
            </span>
          ) : (
            <span className="text-gray-500 text-sm">
              Waiting for <strong className="text-purple-400">{currentPlayerName}</strong>
            </span>
          )}
        </div>

        {/* Uno Call + Challenge Buttons */}
        {!isRoundOver && (
          <div className="flex gap-3">
            {unoHand.length <= 2 && isMyTurn && (
              <button
                onClick={callUno}
                className="px-4 py-2 bg-yellow-500 hover:bg-yellow-400 text-black font-bold rounded-full text-sm transition-colors animate-pulse"
              >
                UNO!
              </button>
            )}
            {unoTurn.canChallenge && (
              <button
                onClick={() => challengeUno(unoTurn.canChallenge!)}
                className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white font-bold rounded-full text-sm transition-colors"
              >
                Challenge!
              </button>
            )}
          </div>
        )}
      </div>

      {/* Reaction bar */}
      <ReactionBar />

      {/* Hand */}
      {!isRoundOver && (
        <div className="bg-gray-900 border-t border-gray-800 px-4 py-4">
          <div className="flex gap-2 overflow-x-auto pb-2 justify-center flex-wrap">
            {unoHand.map((card) => (
              <UnoCard
                key={card.id}
                card={card}
                playable={isMyTurn && playableCardIds.includes(card.id)}
                selected={selectedUnoCard === card.id}
                onClick={() => handleCardClick(card.id)}
              />
            ))}
          </div>
          {unoHand.length === 0 && (
            <p className="text-center text-gray-500 text-sm">No cards in hand</p>
          )}
        </div>
      )}

      {/* Floating components */}
      <VoiceChat floating />
      <Chat />
    </div>
  );
}
