"use client";

import { useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import { useGameStore } from "@/lib/store";
import { fetchDeck, API_URL } from "@/lib/api";
import { useSocket } from "@/lib/useSocket";
import { getSocket } from "@/lib/socket";
import PlayerHand from "./PlayerHand";
import CzarView from "./CzarView";
import RoundWinner from "./RoundWinner";
import ComicPanel from "./ComicPanel";
import ScoreBar from "./ScoreBar";
import ReactionBar from "./ReactionBar";
import { useSounds } from "@/lib/useSounds";
import SoundPicker from "./SoundPicker";
import ReactionOverlay from "./ReactionOverlay";
import StickerOverlay from "./StickerOverlay";
import GifOverlay from "./GifOverlay";
import MetaEffectOverlay from "./MetaEffectOverlay";
import VoiceChat from "./VoiceChat";
import RoundTimer from "./RoundTimer";
import Chat from "./Chat";
import UnoGameScreen from "./UnoGameScreen";
import CodenamesGameScreen from "./CodenamesGameScreen";

export default function GameScreen() {
  const { round, hasSubmitted, winnerInfo, lobby, roundNumber, maxRounds, handBlurred, iconsRandomized, gameType } =
    useGameStore();
  const { nextRound, leaveLobby, czarSetup, playLobbySound } = useSocket();
  useSounds();
  const [soundPickerOpen, setSoundPickerOpen] = useState(false);
  const [cardBackUrl, setCardBackUrl] = useState<string | null>(null);
  const deckId = lobby?.deckId;
  useEffect(() => {
    if (!deckId) { setCardBackUrl(null); return; }
    let cancelled = false;
    fetchDeck(deckId)
      .then((d) => { if (!cancelled) setCardBackUrl(d.cardBackUrl || null); })
      .catch(() => { if (!cancelled) setCardBackUrl(null); });
    return () => { cancelled = true; };
  }, [deckId]);
  const cardBackSrc = cardBackUrl ? (cardBackUrl.startsWith("http") ? cardBackUrl : `${API_URL}${cardBackUrl}`) : null;

  if (gameType === "codenames") return <CodenamesGameScreen />;
  if (gameType === "uno") return <UnoGameScreen />;
  const socket = getSocket();
  const isCzar = round?.czarId === socket.id;
  const isSpectator = lobby?.players.find(p => p.id === socket.id)?.isSpectator;
  const isJH = gameType === "joking_hazard";
  const isA2A = gameType === "apples_to_apples";
  const isSF = gameType === "superfight";

  if (!round) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-400 text-lg">Starting round...</p>
      </div>
    );
  }

  const czarName =
    lobby?.players.find((p) => p.id === round.czarId)?.name || "???";

  return (
    <div className="flex flex-col min-h-screen">
      <ReactionOverlay />
      <StickerOverlay />
      <GifOverlay />
      <MetaEffectOverlay />

      {/* Top bar */}
      <div className="relative flex items-center justify-between px-4 py-3 bg-gray-900 border-b border-gray-800">
        <div className="absolute bottom-0 left-0 right-0 h-px accent-line-cyan pointer-events-none" />
        <span className="text-sm text-gray-400 inline-flex items-center gap-2 shrink-0">
          Round {roundNumber}/{maxRounds}
          {round.phaseDeadline && round.phase !== "revealing" && !winnerInfo && (
            <RoundTimer deadline={round.phaseDeadline} />
          )}
        </span>
        <div className="flex items-center gap-3 min-w-0 overflow-hidden">
          <ScoreBar />
          <button
            onClick={() => { if (confirm("Leave the game?")) leaveLobby(); }}
            className="text-gray-500 hover:text-red-400 text-xs transition-colors"
          >
            Leave
          </button>
        </div>
      </div>
      {soundPickerOpen && (
        <SoundPicker
          onPlay={(mp3, title) => playLobbySound(mp3, title)}
          onClose={() => setSoundPickerOpen(false)}
        />
      )}

      {/* Card display — comic strip for JH, single card for CAH */}
      <div className="px-4 pt-6 pb-4 relative">
        {cardBackSrc && !isJH && !isSF && (
          <div className="hidden sm:block absolute right-4 top-4 pointer-events-none" aria-hidden>
            <div className="relative w-16 h-24">
              <div className="absolute inset-0 rounded-md border border-gray-700 bg-gray-800 overflow-hidden translate-x-1.5 translate-y-1.5 opacity-60">
                <img src={cardBackSrc} alt="" className="w-full h-full object-cover" />
              </div>
              <div className="absolute inset-0 rounded-md border border-gray-700 bg-gray-800 overflow-hidden translate-x-0.5 translate-y-0.5 opacity-80">
                <img src={cardBackSrc} alt="" className="w-full h-full object-cover" />
              </div>
              <div className="absolute inset-0 rounded-md border border-gray-600 bg-gray-800 overflow-hidden shadow-lg">
                <img src={cardBackSrc} alt="Deck back" className="w-full h-full object-cover" />
              </div>
            </div>
          </div>
        )}
        {isJH ? (
          round.isBonus ? (
            /* BONUS ROUND — red card is Panel 3, players submit Panels 1+2 */
            <div>
              <div className="text-center mb-3">
                <span className="inline-block bg-red-600 text-white text-xs px-3 py-1 rounded-full font-bold uppercase tracking-wider">
                  Bonus Round — 2 Points
                </span>
              </div>
              <div className="flex gap-2 sm:gap-3 max-w-2xl mx-auto">
                <ComicPanel empty borderColor="gray" label="Panel 1" labelColor="text-blue-400" emptyText="Your setup" />
                <ComicPanel empty borderColor="gray" label="Panel 2" labelColor="text-blue-400" emptyText="Your setup" />
                <ComicPanel text={round.chaosCard.text} cardId={round.chaosCard.id} imageUrl={round.chaosCard.imageUrl} borderColor="red" label="Panel 3" labelColor="text-red-400" />
              </div>
            </div>
          ) : (
            /* REGULAR ROUND — drawn card is Panel 1, judge plays Panel 2, players submit Panel 3 */
            <div className="flex gap-2 sm:gap-3 max-w-2xl mx-auto">
              <ComicPanel text={round.chaosCard.text} cardId={round.chaosCard.id} imageUrl={round.chaosCard.imageUrl} borderColor="black" label="Panel 1" labelColor="text-gray-400" />
              {round.czarSetupCard ? (
                <ComicPanel text={round.czarSetupCard.text} cardId={round.czarSetupCard.id} imageUrl={round.czarSetupCard.imageUrl} borderColor="purple" label="Panel 2" labelColor="text-purple-400" />
              ) : (
                <ComicPanel empty borderColor="gray" label="Panel 2" labelColor="text-purple-400" emptyText="Waiting for Judge..." />
              )}
              <ComicPanel empty borderColor="gray" label="Panel 3" labelColor="text-green-400" emptyText="Your punchline" />
            </div>
          )
        ) : isSF ? (
          <div className="bg-gradient-to-r from-pink-900/40 to-purple-900/40 border-2 border-pink-500 rounded-xl p-5 max-w-lg mx-auto text-center">
            <p className="text-xs text-pink-400 font-semibold mb-2 uppercase tracking-wider">Superfight</p>
            <p className="text-lg font-bold leading-relaxed">Pick 1 Character + 1 Attribute to build your fighter!</p>
            <p className="text-xs text-pink-300 mt-2">Then debate who would win</p>
          </div>
        ) : (
          <div className={`bg-gray-900 border-2 ${isA2A ? "border-green-500" : "border-red-500"} rounded-xl p-5 max-w-lg mx-auto`}>
            <p className={`text-xs ${isA2A ? "text-green-400" : "text-red-400"} font-semibold mb-2 uppercase tracking-wider`}>
              {isA2A ? "Green Card" : "Chaos Card"}
            </p>
            <p className="text-lg font-medium leading-relaxed">
              {round.chaosCard.text}
            </p>
            {round.chaosCard.pick > 1 && (
              <p className={`text-xs ${isA2A ? "text-green-300" : "text-red-300"} mt-2`}>
                Pick {round.chaosCard.pick}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Czar indicator */}
      <div className="text-center mb-4">
        {isCzar ? (
          <span className="inline-block bg-purple-600 text-sm px-3 py-1 rounded-full font-semibold">
            {isJH || isA2A || isSF ? "You are the Judge" : "You are the Czar"}
          </span>
        ) : (
          <span className="text-gray-500 text-sm">
            {isJH || isA2A || isSF ? "Judge" : "Czar"}: <strong className="text-purple-400">{czarName}</strong>
          </span>
        )}
      </div>

      {/* Reaction bar */}
      <ReactionBar />

      {/* Spectator banner */}
      {isSpectator && (
        <div className="text-center mb-2">
          <span className="inline-block bg-yellow-600/20 text-yellow-400 text-xs px-3 py-1 rounded-full font-semibold">
            Spectating
          </span>
        </div>
      )}

      {/* Main content area */}
      <div className="flex-1 px-4 pb-6">
        {winnerInfo ? (
          <RoundWinner
            winnerInfo={winnerInfo}
            onNext={nextRound}
            isHost={lobby?.hostId === socket.id}
          />
        ) : round.phase === "czar_setup" ? (
          isSpectator ? (
            <div className="text-center text-gray-400 mt-8">
              <p className="text-lg">The Judge is picking a setup card...</p>
            </div>
          ) : isCzar ? (
            <div>
              <p className="text-center text-purple-400 text-sm font-semibold mb-3">
                Pick a card from your hand as Panel 2 (the setup)
              </p>
              <PlayerHand
                blurred={false}
                iconsRandomized={false}
                onCardClick={(cardId) => czarSetup(cardId)}
                singleSelect
              />
            </div>
          ) : (
            <div className="text-center text-gray-400 mt-8">
              <p className="text-lg">The Judge is picking a setup card...</p>
            </div>
          )
        ) : round.phase === "submitting" ? (
          isSpectator ? (
            <WaitingForSubmissions cardBackSrc={cardBackSrc} />
          ) : isCzar ? (
            <WaitingForSubmissions cardBackSrc={cardBackSrc} />
          ) : hasSubmitted ? (
            <div className="text-center text-gray-400 mt-8">
              <p className="text-lg">Cards submitted!</p>
              <p className="text-sm mt-1">Waiting for other players...</p>
            </div>
          ) : (
            <PlayerHand blurred={handBlurred} iconsRandomized={iconsRandomized} />
          )
        ) : round.phase === "judging" ? (
          <CzarView isCzar={isCzar && !isSpectator} />
        ) : null}
      </div>

      <VoiceChat floating />
      {/* Floating sound button — sits above the chat bubble */}
      <button
        onClick={() => setSoundPickerOpen(true)}
        className="fixed bottom-20 right-4 z-40 w-12 h-12 bg-purple-600 hover:bg-purple-700 rounded-full flex items-center justify-center shadow-lg transition-colors"
        title="Soundboard"
      >
        <Icon icon="entypo:sound-mix" className="text-xl" />
      </button>
      <Chat />
    </div>
  );
}

function WaitingForSubmissions({ cardBackSrc }: { cardBackSrc?: string | null }) {
  const { submittedPlayers, lobby, round } = useGameStore();
  const totalPlayers = (lobby?.players.length || 0) - 1; // minus czar
  const submitted = submittedPlayers.size;

  return (
    <div className="text-center mt-8">
      <p className="text-gray-400 text-lg mb-2">Waiting for players...</p>
      <p className="text-gray-500 mb-4">
        {submitted} / {totalPlayers} submitted
      </p>
      {cardBackSrc && submitted > 0 && (
        <div className="flex justify-center gap-2 flex-wrap max-w-md mx-auto">
          {Array.from({ length: submitted }).map((_, i) => (
            <div key={i} className="w-16 h-24 rounded-md border border-gray-700 bg-gray-800 overflow-hidden shadow-md">
              <img src={cardBackSrc} alt="" aria-hidden className="w-full h-full object-cover" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
