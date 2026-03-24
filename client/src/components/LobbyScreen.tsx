"use client";

import { QRCodeSVG } from "qrcode.react";
import { useGameStore } from "@/lib/store";
import { useSocket } from "@/lib/useSocket";
import { getSocket } from "@/lib/socket";
import Chat from "./Chat";

export default function LobbyScreen() {
  const { lobby, error } = useGameStore();
  const { leaveLobby, startGame } = useSocket();

  if (!lobby) return null;

  const socket = getSocket();
  const isHost = lobby.hostId === socket.id;

  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-4">
      {/* Game title */}
      <p className="text-purple-400 font-semibold text-sm mb-1 uppercase tracking-wider">
        {lobby.deckName}
      </p>
      <h2 className="text-2xl font-bold mb-4">Lobby</h2>

      <div className="bg-gray-800 px-6 py-4 rounded-lg mb-6 flex flex-col items-center">
        <p className="text-gray-400 text-sm text-center">Room Code</p>
        <p className="text-4xl font-mono font-bold tracking-[0.3em] text-purple-400 text-center mb-3">
          {lobby.code}
        </p>
        <div className="bg-white p-2 rounded-lg">
          <QRCodeSVG
            value={`${typeof window !== "undefined" ? window.location.origin : ""}?code=${lobby.code}`}
            size={120}
            level="M"
          />
        </div>
        <p className="text-gray-500 text-xs mt-2">Scan to join on your phone</p>
      </div>

      <div className="w-full max-w-sm mb-6">
        <p className="text-gray-400 text-sm mb-2">
          Players ({lobby.players.length}/10)
        </p>
        <div className="space-y-2">
          {lobby.players.map((player) => (
            <div
              key={player.id}
              className="flex items-center justify-between bg-gray-800 px-4 py-3 rounded-lg"
            >
              <span className="font-medium">
                {player.name}
                {player.id === socket.id && (
                  <span className="text-gray-500 text-sm ml-2">(you)</span>
                )}
              </span>
              {player.isHost && (
                <span className="text-xs bg-purple-600 px-2 py-1 rounded font-semibold">
                  HOST
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {error && (
        <p className="text-red-400 text-center text-sm mb-4">{error}</p>
      )}

      <div className="w-full max-w-sm space-y-3">
        {isHost && (
          <button
            onClick={startGame}
            disabled={lobby.players.length < 2}
            className="w-full py-3 bg-green-600 hover:bg-green-700 disabled:bg-gray-700 disabled:text-gray-500 rounded-lg font-semibold text-lg transition-colors"
          >
            {lobby.players.length < 2
              ? `Need ${2 - lobby.players.length} more player${2 - lobby.players.length === 1 ? "" : "s"}`
              : "Start Game"}
          </button>
        )}

        {!isHost && (
          <p className="text-gray-400 text-center text-sm">
            Waiting for host to start the game...
          </p>
        )}

        <button
          onClick={leaveLobby}
          className="w-full py-2 text-gray-400 hover:text-red-400 text-sm transition-colors"
        >
          Leave Lobby
        </button>
      </div>

      <Chat />
    </div>
  );
}
