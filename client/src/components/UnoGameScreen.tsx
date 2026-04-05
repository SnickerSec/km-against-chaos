"use client";

import { useRef, useState, useCallback } from "react";
import { Icon } from "@iconify/react";
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
  1: "mdi:rotate-right",
  [-1]: "mdi:rotate-left",
};

export default function UnoGameScreen() {
  const {
    unoHand, unoTurn, playableCardIds, selectedUnoCard, choosingColor,
    unoDeckTemplate, unoRoundWinner, lobby, roundNumber, maxRounds, scores,
    unoWinMode, unoTargetPoints, unoStackingEnabled,
  } = useGameStore();
  const { playUnoCard, drawUnoCard, callUno, challengeUno, unoNextRound, leaveLobby } = useSocket();
  const socket = getSocket();
  const myId = socket.id;

  // All hooks must be called before any early return
  const [dragCardId, setDragCardId] = useState<string | null>(null);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const [overDrop, setOverDrop] = useState(false);
  const discardRef = useRef<HTMLDivElement>(null);
  const dragOffset = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const isMyTurn = unoTurn ? unoTurn.currentPlayerId === myId : false;
  const isRoundOver = unoTurn ? unoTurn.phase === "round_over" || !!unoRoundWinner : false;

  const isOverDiscard = useCallback((px: number, py: number) => {
    if (!discardRef.current) return false;
    const r = discardRef.current.getBoundingClientRect();
    return px >= r.left - 24 && px <= r.right + 24 && py >= r.top - 24 && py <= r.bottom + 24;
  }, []);

  const handleCardClick = useCallback((cardId: string) => {
    if (!isMyTurn || isRoundOver) return;
    const card = unoHand.find(c => c.id === cardId);
    if (!card) return;
    if (card.type === "wild" || card.type === "wild_draw_four") {
      useGameStore.setState({ selectedUnoCard: cardId, choosingColor: true });
      return;
    }
    playUnoCard(cardId);
  }, [isMyTurn, isRoundOver, unoHand, playUnoCard]);

  const onDragStart = useCallback((cardId: string, e: React.PointerEvent) => {
    if (!isMyTurn || isRoundOver || !playableCardIds.includes(cardId)) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    dragOffset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    setDragCardId(cardId);
    setDragPos({ x: e.clientX, y: e.clientY });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, [isMyTurn, isRoundOver, playableCardIds]);

  const onDragMove = useCallback((e: React.PointerEvent) => {
    if (!dragCardId) return;
    setDragPos({ x: e.clientX, y: e.clientY });
    setOverDrop(isOverDiscard(e.clientX, e.clientY));
  }, [dragCardId, isOverDiscard]);

  const onDragEnd = useCallback(() => {
    if (!dragCardId || !dragPos) {
      setDragCardId(null);
      setDragPos(null);
      setOverDrop(false);
      return;
    }
    if (isOverDiscard(dragPos.x, dragPos.y)) {
      handleCardClick(dragCardId);
    }
    setDragCardId(null);
    setDragPos(null);
    setOverDrop(false);
  }, [dragCardId, dragPos, isOverDiscard, handleCardClick]);

  if (!unoTurn) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-400 text-lg">Starting Uno game...</p>
      </div>
    );
  }

  const currentPlayerName = lobby?.players.find(p => p.id === unoTurn.currentPlayerId)?.name || "???";

  const handleColorPick = (color: UnoColor) => {
    if (selectedUnoCard) {
      playUnoCard(selectedUnoCard, color);
    }
  };

  const handleCancelColor = () => {
    useGameStore.setState({ selectedUnoCard: null, choosingColor: false });
  };

  const dragCard = dragCardId ? unoHand.find(c => c.id === dragCardId) : null;

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
          <span title={unoTurn.direction === 1 ? "Clockwise" : "Counter-clockwise"}>
            <Icon icon={DIRECTION_ICON[unoTurn.direction] || "mdi:rotate-right"} className="text-2xl text-gray-300" />
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
            <Icon icon="mdi:cards" className="text-2xl text-gray-300" />
            <span className="text-xs text-gray-400 mt-1">{unoTurn.drawPileCount}</span>
            {isMyTurn && !isRoundOver && (
              <span className="text-[10px] text-purple-400 mt-0.5">Draw</span>
            )}
          </button>

          {/* Discard Pile */}
          <div ref={discardRef} className={`relative rounded-xl transition-all ${overDrop ? "ring-4 ring-purple-400 ring-offset-2 ring-offset-gray-900 scale-110" : ""}`}>
            <UnoCard card={unoTurn.discardTop} />
          </div>
        </div>

        {/* Stacking Pending Draw Indicator */}
        {unoStackingEnabled && unoTurn.mustDraw > 0 && (
          <div className="bg-red-600/20 border border-red-500 rounded-lg px-4 py-2 text-center animate-pulse">
            <span className="text-red-400 font-bold text-sm">
              Draw {unoTurn.mustDraw} pending! {isMyTurn ? "Stack or draw!" : ""}
            </span>
          </div>
        )}

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
            {unoHand.map((card) => {
              const isPlayable = isMyTurn && playableCardIds.includes(card.id);
              return (
                <div
                  key={card.id}
                  onPointerDown={(e) => onDragStart(card.id, e)}
                  onPointerMove={onDragMove}
                  onPointerUp={onDragEnd}
                  onPointerCancel={onDragEnd}
                  className={`touch-none ${dragCardId === card.id ? "opacity-30" : ""}`}
                >
                  <UnoCard
                    card={card}
                    playable={isPlayable}
                    selected={selectedUnoCard === card.id}
                    onClick={() => handleCardClick(card.id)}
                  />
                </div>
              );
            })}
          </div>

          {/* Drag ghost */}
          {dragCard && dragPos && (
            <div
              className="fixed pointer-events-none z-50"
              style={{
                left: dragPos.x - dragOffset.current.x,
                top: dragPos.y - dragOffset.current.y,
              }}
            >
              <UnoCard card={dragCard} playable />
            </div>
          )}
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
