"use client";

import { useGameStore } from "@/lib/store";
import { useSocket } from "@/lib/useSocket";
import { getSocket } from "@/lib/socket";
import PlayerHand from "./PlayerHand";
import CzarView from "./CzarView";
import RoundWinner from "./RoundWinner";
import ScoreBar from "./ScoreBar";
import ReactionBar from "./ReactionBar";
import ReactionOverlay from "./ReactionOverlay";
import StickerOverlay from "./StickerOverlay";
import MetaEffectOverlay from "./MetaEffectOverlay";
import VoiceChat from "./VoiceChat";
import RoundTimer from "./RoundTimer";
import Chat from "./Chat";

export default function GameScreen() {
  const { round, hasSubmitted, winnerInfo, lobby, roundNumber, maxRounds, handBlurred, iconsRandomized, gameType } =
    useGameStore();
  const { nextRound, leaveLobby, czarSetup } = useSocket();
  const socket = getSocket();
  const isCzar = round?.czarId === socket.id;
  const isSpectator = lobby?.players.find(p => p.id === socket.id)?.isSpectator;
  const isJH = gameType === "joking_hazard";

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
      <MetaEffectOverlay />

      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-gray-900 border-b border-gray-800">
        <span className="text-sm text-gray-400 inline-flex items-center gap-2">
          Round {roundNumber}/{maxRounds}
          {round.phaseDeadline && round.phase !== "revealing" && !winnerInfo && (
            <RoundTimer deadline={round.phaseDeadline} />
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

      {/* Card display — comic strip for JH, single card for CAH */}
      <div className="px-4 pt-6 pb-4">
        {isJH ? (
          <div className="flex gap-3 max-w-2xl mx-auto">
            {/* Panel 1 — from deck */}
            <div className="flex-1 bg-gray-900 border-2 border-red-500 rounded-xl p-4">
              <p className="text-xs text-red-400 font-semibold mb-2 uppercase tracking-wider">Panel 1</p>
              <p className="text-base font-medium leading-relaxed">{round.chaosCard.text}</p>
            </div>
            {/* Panel 2 — czar's setup card */}
            <div className={`flex-1 bg-gray-900 border-2 rounded-xl p-4 ${
              round.czarSetupCard ? "border-purple-500" : "border-gray-700 border-dashed"
            }`}>
              <p className="text-xs text-purple-400 font-semibold mb-2 uppercase tracking-wider">Panel 2</p>
              {round.czarSetupCard ? (
                <p className="text-base font-medium leading-relaxed">{round.czarSetupCard.text}</p>
              ) : (
                <p className="text-gray-600 text-sm italic">Waiting for Judge...</p>
              )}
            </div>
            {/* Panel 3 — placeholder during setup/submitting */}
            <div className="flex-1 bg-gray-900 border-2 border-gray-700 border-dashed rounded-xl p-4">
              <p className="text-xs text-green-400 font-semibold mb-2 uppercase tracking-wider">Panel 3</p>
              <p className="text-gray-600 text-sm italic">Your punchline</p>
            </div>
          </div>
        ) : (
          <div className="bg-gray-900 border-2 border-red-500 rounded-xl p-5 max-w-lg mx-auto">
            <p className="text-xs text-red-400 font-semibold mb-2 uppercase tracking-wider">
              Chaos Card
            </p>
            <p className="text-lg font-medium leading-relaxed">
              {round.chaosCard.text}
            </p>
            {round.chaosCard.pick > 1 && (
              <p className="text-xs text-red-300 mt-2">
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
            {isJH ? "You are the Judge" : "You are the Czar"}
          </span>
        ) : (
          <span className="text-gray-500 text-sm">
            {isJH ? "Judge" : "Czar"}: <strong className="text-purple-400">{czarName}</strong>
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
            <WaitingForSubmissions />
          ) : isCzar ? (
            <WaitingForSubmissions />
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

      {/* Voice chat — collapsed by default in game, user expands */}
      <div className="px-4 pb-2">
        <VoiceChat />
      </div>

      <Chat />
    </div>
  );
}

function WaitingForSubmissions() {
  const { submittedPlayers, lobby, round } = useGameStore();
  const totalPlayers = (lobby?.players.length || 0) - 1; // minus czar
  const submitted = submittedPlayers.size;

  return (
    <div className="text-center mt-8">
      <p className="text-gray-400 text-lg mb-2">Waiting for players...</p>
      <p className="text-gray-500">
        {submitted} / {totalPlayers} submitted
      </p>
    </div>
  );
}
