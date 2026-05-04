"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useGameStore, type GameType } from "@/lib/store";
import { useSocket } from "@/lib/useSocket";
import { getSocket } from "@/lib/socket";
import CardPreview from "./CardPreview";
import { fetchDeck, API_URL } from "@/lib/api";
import { Icon } from "@iconify/react";
import { Button } from "./ui/Button";

export default function CzarView({ isCzar }: { isCzar: boolean }) {
  const { round, gameType, lobby, votedPlayers } = useGameStore();
  const { pickWinner, spectatorVote } = useSocket();
  const isJH = gameType === "joking_hazard";
  const isSF = gameType === "superfight";
  const [selected, setSelected] = useState<string | null>(null);
  const [hasVoted, setHasVoted] = useState(false);
  const [previewText, setPreviewText] = useState<string | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggered = useRef(false);

  const socket = getSocket();
  const isSpectator = lobby?.players.find(p => p.id === socket.id)?.isSpectator;
  const botCzarMode = !!lobby?.houseRules?.botCzar;
  // In bot-czar mode, every non-czar player + spectator gets to vote.
  // In normal mode, only spectators vote (czar still picks the winner).
  const canVote = !isCzar && !hasVoted && (isSpectator || botCzarMode);

  const [cardBackUrl, setCardBackUrl] = useState<string | null>(null);
  const deckId = lobby?.deckId;
  useEffect(() => {
    if (!deckId) return;
    let cancelled = false;
    fetchDeck(deckId).then((d) => {
      if (cancelled) return;
      setCardBackUrl(d.cardBackUrl || null);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [deckId]);
  const cardBackSrc = cardBackUrl ? (cardBackUrl.startsWith("http") ? cardBackUrl : `${API_URL}${cardBackUrl}`) : null;

  const submissionCount = round?.submissions.length || 0;
  const roundKey = round?.roundNumber ?? 0;
  const [flippedCount, setFlippedCount] = useState(0);
  useEffect(() => {
    if (!cardBackSrc || submissionCount === 0) { setFlippedCount(submissionCount); return; }
    setFlippedCount(0);
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let i = 0; i < submissionCount; i++) {
      timers.push(setTimeout(() => setFlippedCount((n) => Math.max(n, i + 1)), 350 + i * 400));
    }
    return () => { timers.forEach(clearTimeout); };
  }, [roundKey, submissionCount, cardBackSrc]);

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
            ? botCzarMode
              ? "Voted! Waiting for the rest..."
              : "Voted! Waiting for the " + (isJH ? "Judge" : "Czar") + " to decide..."
            : canVote
              ? "Vote for your favorite!"
              : isJH ? "The Judge is choosing a winner..." : "The Czar is choosing a winner..."}
      </p>
      {botCzarMode && (() => {
        // Live tally: non-czar in-game players only (czar is a bot, bots judge/vote too).
        const nonCzarPlayers = (lobby?.players || []).filter((p) => !p.isSpectator && p.id !== round.czarId);
        const expected = nonCzarPlayers.length;
        const voted = votedPlayers.size + (hasVoted ? 1 : 0);
        if (expected === 0) return null;
        return (
          <p className="text-center text-xs text-purple-300 mb-4" aria-live="polite">
            {voted} of {expected} voted
          </p>
        );
      })()}

      <div className="grid grid-cols-1 gap-3 max-w-lg mx-auto">
        {round.submissions.map((sub, i) => {
          const isFlipped = !cardBackSrc || i < flippedCount;
          // Voters can't pick their own submission. Czars (judges) still can,
          // since the czar in normal mode never has a submission anyway, and
          // in bot-czar mode the czar branch isn't selectable here.
          const isOwnSubmission = !isCzar && canVote && sub.playerId === socket.id;
          const selectable = canSelect && isFlipped && !isOwnSubmission;
          return (
            <div key={i} style={{ perspective: "1200px" }}>
              <div
                className="relative w-full transition-transform duration-500 ease-out"
                style={{ transformStyle: "preserve-3d", transform: isFlipped ? "rotateY(180deg)" : "rotateY(0deg)", minHeight: "5rem" }}
              >
                {cardBackSrc && (
                  <div
                    className="absolute inset-0 rounded-xl border-2 border-gray-700 bg-gray-800 overflow-hidden"
                    style={{ backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden" }}
                    aria-hidden
                  >
                    <img src={cardBackSrc} alt="" className="w-full h-full object-cover" />
                  </div>
                )}
                <button
                  disabled={!selectable}
                  onClick={() => {
                    if (longPressTriggered.current) return;
                    if (selectable) setSelected(sub.playerId);
                  }}
                  onTouchStart={() => startLongPress(sub.cards.map(c => c.text).join(" / "))}
                  onTouchEnd={cancelLongPress}
                  onTouchCancel={cancelLongPress}
                  onMouseDown={() => startLongPress(sub.cards.map(c => c.text).join(" / "))}
                  onMouseUp={cancelLongPress}
                  onMouseLeave={cancelLongPress}
                  style={{ backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
                  className={`w-full p-4 rounded-xl text-left transition-colors ${
                    cardBackSrc ? "relative" : ""
                  } ${
                    selected === sub.playerId
                      ? isCzar
                        ? "bg-purple-600 border-2 border-purple-400"
                        : "bg-yellow-600 border-2 border-yellow-400"
                      : isOwnSubmission
                        ? "bg-gray-800 border-2 border-gray-700 opacity-60 cursor-not-allowed"
                        : selectable
                          ? "bg-gray-800 border-2 border-gray-700 hover:border-gray-500"
                          : "bg-gray-800 border-2 border-gray-700"
                  }`}
                >
                  {isOwnSubmission && (
                    <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Your submission</p>
                  )}
                  {sub.cards.map((card, j) => {
                    const label = isSF
                      ? (card.role === "character" ? "Character" : "Attribute")
                      : isJH && round?.isBonus
                        ? `Panel ${j + 1}`
                        : `#${j + 1}`;
                    const labelColor = isSF
                      ? (card.role === "character" ? "text-pink-300" : "text-purple-300")
                      : "text-purple-300";
                    return (
                      <p key={j} className="font-medium">
                        {sub.cards.length > 1 && (
                          <span className={`text-xs ${labelColor} mr-2`}>{label}</span>
                        )}
                        {card.text}
                      </p>
                    );
                  })}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {isCzar && selected && (
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-gray-950/90 backdrop-blur border-t border-gray-800 flex justify-center">
          <Button onClick={handlePick} variant="primary" size="lg" fullWidth className="max-w-lg">
            Pick Winner
          </Button>
        </div>
      )}

      {canVote && selected && (
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-gray-950/90 backdrop-blur border-t border-gray-800 flex justify-center">
          <Button onClick={handleSpectatorVote} variant="vote" size="lg" fullWidth className="max-w-lg">
            Cast Vote
          </Button>
        </div>
      )}

      {previewText && (
        <CardPreview text={previewText} onClose={() => setPreviewText(null)} />
      )}
    </div>
  );
}
