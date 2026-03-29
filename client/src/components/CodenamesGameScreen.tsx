"use client";

import { useState } from "react";
import { useGameStore, type CodenamesPlayerView } from "@/lib/store";
import { useSocket } from "@/lib/useSocket";
import { getSocket } from "@/lib/socket";
import ReactionOverlay from "./ReactionOverlay";
import StickerOverlay from "./StickerOverlay";
import GifOverlay from "./GifOverlay";

const COLOR_STYLES: Record<string, string> = {
  red: "bg-red-600 text-white",
  blue: "bg-blue-600 text-white",
  neutral: "bg-amber-800/60 text-amber-200",
  assassin: "bg-gray-900 text-white border-2 border-red-500",
};

const UNREVEALED_STYLE = "bg-gray-700 hover:bg-gray-600 text-white cursor-pointer";

export default function CodenamesGameScreen() {
  const { codenamesView, lobby } = useGameStore();
  const { codenamesJoinTeam, codenamesStartRound, codenamesGiveClue, codenamesGuess, codenamesPass, leaveLobby } = useSocket();
  const [clueWord, setClueWord] = useState("");
  const [clueCount, setClueCount] = useState(1);
  const socket = getSocket();
  const myId = socket.id;

  if (!codenamesView) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-400 text-lg">Starting Codenames...</p>
      </div>
    );
  }

  const v = codenamesView;
  const isHost = lobby?.hostId === myId;
  const getPlayerName = (id: string) => lobby?.players.find(p => p.id === id)?.name || "???";

  // Team Pick Phase
  if (v.phase === "team_pick") {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen px-4 gap-6">
        <ReactionOverlay />
        <h1 className="text-2xl font-bold">Pick Your Team</h1>
        <p className="text-gray-400 text-sm">Each team needs a Spymaster and at least 1 guesser</p>

        <div className="grid grid-cols-2 gap-6 w-full max-w-lg">
          {(["red", "blue"] as const).map((team) => (
            <div key={team} className={`rounded-xl p-4 border-2 ${team === "red" ? "border-red-600 bg-red-600/10" : "border-blue-600 bg-blue-600/10"}`}>
              <h3 className={`font-bold text-lg mb-3 ${team === "red" ? "text-red-400" : "text-blue-400"}`}>
                {team === "red" ? "Red Team" : "Blue Team"}
              </h3>

              <div className="space-y-2 mb-3">
                <p className="text-xs text-gray-400 uppercase">Spymaster</p>
                {v.teams[team].spymaster ? (
                  <p className="text-sm font-medium">{getPlayerName(v.teams[team].spymaster!)}</p>
                ) : (
                  <button
                    onClick={() => codenamesJoinTeam(team, true)}
                    className={`w-full py-2 rounded-lg text-sm font-medium transition-colors ${
                      team === "red" ? "bg-red-600 hover:bg-red-700" : "bg-blue-600 hover:bg-blue-700"
                    }`}
                  >
                    Be Spymaster
                  </button>
                )}
              </div>

              <div className="space-y-2">
                <p className="text-xs text-gray-400 uppercase">Guessers</p>
                {v.teams[team].guessers.map((id) => (
                  <p key={id} className="text-sm">{getPlayerName(id)}</p>
                ))}
                <button
                  onClick={() => codenamesJoinTeam(team, false)}
                  className="w-full py-1.5 bg-gray-700 hover:bg-gray-600 rounded-lg text-xs transition-colors"
                >
                  Join as Guesser
                </button>
              </div>
            </div>
          ))}
        </div>

        {isHost && (
          <button
            onClick={codenamesStartRound}
            className="px-8 py-3 bg-green-600 hover:bg-green-700 rounded-lg font-semibold text-lg transition-colors"
          >
            Start Game
          </button>
        )}

        <button onClick={() => { if (confirm("Leave?")) leaveLobby(); }} className="text-gray-500 hover:text-red-400 text-sm">
          Leave
        </button>
      </div>
    );
  }

  // Main Game Phase
  const canGuess = v.phase === "guessing" && !v.isSpymaster && v.myTeam === v.currentTeam;
  const canGiveClue = v.phase === "spymaster_clue" && v.isSpymaster && v.myTeam === v.currentTeam;

  return (
    <div className="flex flex-col min-h-screen">
      <ReactionOverlay />
      <StickerOverlay />
      <GifOverlay />

      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-gray-900 border-b border-gray-800">
        <div className="flex items-center gap-3">
          <span className={`text-sm font-bold ${v.currentTeam === "red" ? "text-red-400" : "text-blue-400"}`}>
            {v.currentTeam === "red" ? "Red" : "Blue"}&apos;s Turn
          </span>
          <span className="text-gray-500 text-xs">
            Red: {v.scores.red}/{v.targets.red} &middot; Blue: {v.scores.blue}/{v.targets.blue}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500">
            {v.isSpymaster ? "Spymaster" : "Guesser"} &middot; {v.myTeam === "red" ? "Red" : "Blue"}
          </span>
          <button onClick={() => { if (confirm("Leave?")) leaveLobby(); }} className="text-gray-500 hover:text-red-400 text-xs">Leave</button>
        </div>
      </div>

      {/* Clue display */}
      {v.clue && (
        <div className="text-center py-2 bg-gray-800">
          <span className={`font-bold ${v.clue.team === "red" ? "text-red-400" : "text-blue-400"}`}>
            Clue: &quot;{v.clue.word}&quot; for {v.clue.count}
          </span>
          {v.phase === "guessing" && (
            <span className="text-gray-400 text-sm ml-2">({v.guessesRemaining} guesses left)</span>
          )}
        </div>
      )}

      {/* Grid */}
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="grid grid-cols-5 gap-2 w-full max-w-2xl">
          {v.grid.map((cell, i) => {
            const style = cell.revealed
              ? COLOR_STYLES[cell.color || "neutral"]
              : cell.color && v.isSpymaster
              ? `${COLOR_STYLES[cell.color]} opacity-70`
              : UNREVEALED_STYLE;

            return (
              <button
                key={i}
                onClick={() => canGuess && !cell.revealed ? codenamesGuess(i) : undefined}
                disabled={!canGuess || cell.revealed}
                className={`aspect-[4/3] rounded-lg flex items-center justify-center text-xs sm:text-sm font-medium p-1 transition-all ${style} ${
                  canGuess && !cell.revealed ? "hover:scale-105 hover:ring-2 hover:ring-white/30" : ""
                } ${cell.revealed ? "opacity-80" : ""}`}
              >
                {cell.word}
              </button>
            );
          })}
        </div>
      </div>

      {/* Last action */}
      {v.lastAction && (
        <p className="text-center text-sm text-gray-400 py-1">{v.lastAction}</p>
      )}

      {/* Bottom bar: clue input or pass button */}
      <div className="px-4 py-3 bg-gray-900 border-t border-gray-800">
        {v.gameOver ? (
          <p className="text-center text-lg font-bold">
            <span className={v.winner === "red" ? "text-red-400" : "text-blue-400"}>
              {v.winner === "red" ? "Red" : "Blue"} Team Wins!
            </span>
          </p>
        ) : canGiveClue ? (
          <div className="flex items-center gap-2 max-w-lg mx-auto">
            <input
              type="text"
              value={clueWord}
              onChange={(e) => setClueWord(e.target.value.replace(/\s/g, ""))}
              placeholder="One-word clue"
              className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-purple-500"
            />
            <select
              value={clueCount}
              onChange={(e) => setClueCount(parseInt(e.target.value))}
              className="px-2 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm"
            >
              {[0,1,2,3,4,5,6,7,8,9].map(n => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
            <button
              onClick={() => { codenamesGiveClue(clueWord, clueCount); setClueWord(""); }}
              disabled={!clueWord.trim()}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-40 rounded-lg font-semibold text-sm transition-colors"
            >
              Give Clue
            </button>
          </div>
        ) : canGuess ? (
          <div className="text-center">
            <button
              onClick={codenamesPass}
              className="px-6 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm font-medium transition-colors"
            >
              End Turn
            </button>
          </div>
        ) : v.phase === "spymaster_clue" && !canGiveClue ? (
          <p className="text-center text-gray-500 text-sm">
            Waiting for {v.currentTeam === "red" ? "Red" : "Blue"} Spymaster to give a clue...
          </p>
        ) : v.phase === "guessing" && !canGuess ? (
          <p className="text-center text-gray-500 text-sm">
            {v.currentTeam === "red" ? "Red" : "Blue"} team is guessing...
          </p>
        ) : null}
      </div>
    </div>
  );
}
