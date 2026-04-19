"use client";

import { useEffect, useRef, useState } from "react";
import { useGameStore, type KnowledgeCard } from "@/lib/store";
import ComicPanel from "./ComicPanel";
import { fetchDeck, API_URL, ttsSpeak } from "@/lib/api";
import { Button } from "./ui/Button";

interface Props {
  winnerInfo: {
    winnerId: string;
    winnerName: string;
    cards: KnowledgeCard[];
    audiencePick?: string | null;
  };
  onNext: () => void;
  isHost: boolean;
}

export default function RoundWinner({ winnerInfo, onNext, isHost }: Props) {
  const { gameType, round, lobby, voteTally } = useGameStore();
  const isJH = gameType === "joking_hazard";
  const audiencePick = winnerInfo.audiencePick;
  const audiencePickName = audiencePick ? lobby?.players.find(p => p.id === audiencePick)?.name : null;
  const showAudiencePick = audiencePick && audiencePick !== winnerInfo.winnerId && audiencePickName;

  // Bot-czar vote reveal: shown instead of "Audience Pick" when the round was
  // decided by votes. Sorted high-to-low so the winning tally reads naturally.
  const tallyRows = voteTally
    ? Object.entries(voteTally)
        .map(([pid, count]) => {
          const name = lobby?.players.find((p) => p.id === pid)?.name || "???";
          return { pid, name, count };
        })
        .sort((a, b) => b.count - a.count)
    : [];
  const totalVotes = tallyRows.reduce((n, r) => n + r.count, 0);

  const [cardBackUrl, setCardBackUrl] = useState<string | null>(null);
  const [voiceId, setVoiceId] = useState<string | null>(null);
  const [flipped, setFlipped] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const deckId = lobby?.deckId;
  useEffect(() => {
    if (!deckId) return;
    let cancelled = false;
    fetchDeck(deckId).then((d) => {
      if (cancelled) return;
      setCardBackUrl(d.cardBackUrl || null);
      setVoiceId(d.voiceId || null);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [deckId]);
  useEffect(() => {
    const t = setTimeout(() => setFlipped(true), 450);
    return () => clearTimeout(t);
  }, [winnerInfo.winnerId]);
  useEffect(() => {
    const ttsMuted = typeof window !== "undefined" && localStorage.getItem("tts_muted") === "1";
    if (ttsMuted) return;
    const text = winnerInfo.cards.map((c) => c.text).join(". ");
    if (!text) return;
    // Wait for the card flip animation (1150ms) *and* the win/lose sound
    // effect (airhorn/trombone, ~2–3s) to finish before the TTS starts —
    // otherwise ElevenLabs narration steps on the sound effects.
    const t = setTimeout(() => {
      ttsSpeak(text, voiceId || undefined).then((url) => {
        if (!url) return;
        if (audioRef.current) audioRef.current.pause();
        const audio = new Audio(url);
        audioRef.current = audio;
        audio.play().catch(() => {});
      });
    }, 3500);
    return () => clearTimeout(t);
  }, [winnerInfo.winnerId, voiceId]);
  const cardBackSrc = cardBackUrl ? (cardBackUrl.startsWith("http") ? cardBackUrl : `${API_URL}${cardBackUrl}`) : null;

  return (
    <div className="text-center mt-4 max-w-2xl mx-auto">
      <p className="text-green-400 text-xl font-bold mb-2">
        {winnerInfo.winnerName} wins the round!
      </p>

      {showAudiencePick && (
        <p className="text-yellow-400 text-sm mb-3">
          <span className="inline-block bg-yellow-600/20 px-3 py-1 rounded-full">
            Audience Pick: <strong>{audiencePickName}</strong>
          </span>
        </p>
      )}

      {voteTally && tallyRows.length > 0 && (
        <div className="mb-4 inline-block bg-purple-600/10 border border-purple-600/30 rounded-lg px-4 py-2 text-left">
          <p className="text-xs text-purple-300 uppercase tracking-wider mb-1 text-center">
            Vote Tally ({totalVotes})
          </p>
          <ul className="text-sm space-y-0.5">
            {tallyRows.map((r) => (
              <li
                key={r.pid}
                className={`flex justify-between gap-4 ${r.pid === winnerInfo.winnerId ? "text-green-400 font-semibold" : "text-gray-300"}`}
              >
                <span>{r.name}</span>
                <span className="tabular-nums">{r.count}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

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
              <ComicPanel text={winnerInfo.cards[0]?.text || ""} cardId={winnerInfo.cards[0]?.id} imageUrl={winnerInfo.cards[0]?.imageUrl} borderColor="green" label="Panel 1" labelColor="text-green-400" />
              <ComicPanel text={winnerInfo.cards[1]?.text || ""} cardId={winnerInfo.cards[1]?.id} imageUrl={winnerInfo.cards[1]?.imageUrl} borderColor="green" label="Panel 2" labelColor="text-green-400" />
              <ComicPanel text={round.chaosCard.text} cardId={round.chaosCard.id} imageUrl={round.chaosCard.imageUrl} borderColor="red" label="Panel 3" labelColor="text-red-400" />
            </div>
          </div>
        ) : (
          /* Regular round reveal: drawn card = Panel 1, judge = Panel 2, winner = Panel 3 */
          <div className="flex gap-2 sm:gap-3 mb-6">
            <ComicPanel text={round.chaosCard.text} cardId={round.chaosCard.id} imageUrl={round.chaosCard.imageUrl} borderColor="black" label="Panel 1" labelColor="text-gray-400" />
            <ComicPanel text={round.czarSetupCard?.text || ""} cardId={round.czarSetupCard?.id} imageUrl={round.czarSetupCard?.imageUrl} borderColor="purple" label="Panel 2" labelColor="text-purple-400" />
            <ComicPanel text={winnerInfo.cards[0]?.text || ""} cardId={winnerInfo.cards[0]?.id} imageUrl={winnerInfo.cards[0]?.imageUrl} borderColor="green" label="Panel 3" labelColor="text-green-400" />
          </div>
        )
      ) : cardBackSrc ? (
        <div className="mb-6 max-w-lg mx-auto" style={{ perspective: "1200px" }}>
          <div
            className="relative w-full transition-transform duration-700 ease-out"
            style={{ transformStyle: "preserve-3d", transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)", minHeight: "10rem" }}
          >
            <div
              className="absolute inset-0 rounded-xl border-2 border-gray-700 overflow-hidden shadow-xl"
              style={{ backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden" }}
            >
              <img src={cardBackSrc} alt="" aria-hidden className="w-full h-full object-cover" />
            </div>
            <div
              className="bg-green-900/30 border-2 border-green-600 rounded-xl p-5"
              style={{ backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
            >
              {winnerInfo.cards.map((card, i) => (
                <p key={i} className="text-lg font-medium">{card.text}</p>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-green-900/30 border-2 border-green-500 glow-green rounded-xl p-5 mb-6 max-w-lg mx-auto">
          {winnerInfo.cards.map((card, i) => (
            <p key={i} className="text-lg font-medium">
              {card.text}
            </p>
          ))}
        </div>
      )}

      {isHost && (
        <Button onClick={onNext} variant="primary" size="lg">
          Next Round
        </Button>
      )}

      {!isHost && (
        <p className="text-gray-400 text-sm">
          Waiting for host to start next round...
        </p>
      )}
    </div>
  );
}
