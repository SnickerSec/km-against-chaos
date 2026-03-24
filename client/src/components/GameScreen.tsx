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
import Chat from "./Chat";

export default function GameScreen() {
  const { round, hasSubmitted, winnerInfo, lobby, roundNumber, maxRounds } =
    useGameStore();
  const { nextRound, leaveLobby } = useSocket();
  const socket = getSocket();
  const isCzar = round?.czarId === socket.id;

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

      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-gray-900 border-b border-gray-800">
        <span className="text-sm text-gray-400">
          Round {roundNumber}/{maxRounds}
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

      {/* Chaos card */}
      <div className="px-4 pt-6 pb-4">
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
      </div>

      {/* Czar indicator */}
      <div className="text-center mb-4">
        {isCzar ? (
          <span className="inline-block bg-purple-600 text-sm px-3 py-1 rounded-full font-semibold">
            You are the Czar
          </span>
        ) : (
          <span className="text-gray-500 text-sm">
            Czar: <strong className="text-purple-400">{czarName}</strong>
          </span>
        )}
      </div>

      {/* Reaction bar */}
      <ReactionBar />

      {/* Main content area */}
      <div className="flex-1 px-4 pb-6">
        {winnerInfo ? (
          <RoundWinner
            winnerInfo={winnerInfo}
            onNext={nextRound}
            isHost={lobby?.hostId === socket.id}
          />
        ) : round.phase === "submitting" ? (
          isCzar ? (
            <WaitingForSubmissions />
          ) : hasSubmitted ? (
            <div className="text-center text-gray-400 mt-8">
              <p className="text-lg">Cards submitted!</p>
              <p className="text-sm mt-1">Waiting for other players...</p>
            </div>
          ) : (
            <PlayerHand />
          )
        ) : round.phase === "judging" ? (
          <CzarView isCzar={isCzar} />
        ) : null}
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
