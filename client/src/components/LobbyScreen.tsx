"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { Icon } from "@iconify/react";
import DeckPicker from "./DeckPicker";
import { useGameStore } from "@/lib/store";
import { useSocket } from "@/lib/useSocket";
import { getSocket } from "@/lib/socket";
import Chat from "./Chat";
import VoiceChat from "./VoiceChat";
import PlayerAvatar from "./PlayerAvatar";
import { Button } from "./ui/Button";

const GAME_TYPE_DISPLAY: Record<string, { label: string; icon: string; color: string }> = {
  cah:              { label: "Cards Against Humanity", icon: "mdi:cards",              color: "text-red-400" },
  joking_hazard:    { label: "Joking Hazard",         icon: "mdi:comment-text",        color: "text-orange-400" },
  apples_to_apples: { label: "Apples to Apples",      icon: "mdi:fruit-cherries",      color: "text-green-400" },
  uno:              { label: "Uno",                    icon: "mdi:cards-playing-outline",color: "text-yellow-400" },
  superfight:       { label: "Superfight",             icon: "mdi:arm-flex",             color: "text-pink-400" },
  blackjack:        { label: "Blackjack",              icon: "hugeicons:cards-01",       color: "text-emerald-400" },
};

function formatWinCondition(mode: string, value: number, gameType: string): string {
  if (gameType === "blackjack") {
    if (mode === "timed") return `${value}-minute round`;
    return "Last player with chips wins";
  }
  if (gameType === "uno") {
    if (mode === "single_round") return "Single round — first to empty hand wins";
    if (mode === "lowest_score") return `Lowest score wins (game ends at ${value} pts)`;
    return `First to ${value} points`;
  }
  if (mode === "points") return `First to ${value} point${value !== 1 ? "s" : ""}`;
  return `${value} round${value !== 1 ? "s" : ""}`;
}

export default function LobbyScreen() {
  const { lobby, error, countdown } = useGameStore();
  const { leaveLobby, startGame, addBot, removeBot, kickPlayer, changeDeck, setHouseRules, setMaxPlayers } = useSocket();
  const [showDeckPicker, setShowDeckPicker] = useState(false);
  const [copied, setCopied] = useState(false);

  const getInviteUrl = () =>
    `${typeof window !== "undefined" ? window.location.origin : ""}?code=${lobby?.code}`;

  const copyInviteLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(getInviteUrl());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }, [lobby?.code]); // eslint-disable-line react-hooks/exhaustive-deps

  const shareInviteLink = useCallback(async () => {
    const url = getInviteUrl();
    if (navigator.share) {
      try {
        await navigator.share({ title: "Join my Decked game!", url });
      } catch {}
    } else {
      copyInviteLink();
    }
  }, [lobby?.code, copyInviteLink]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!lobby) return null;

  const socket = getSocket();
  const isHost = lobby.hostId === socket.id;
  const activePlayers = lobby.players.filter(p => !p.isSpectator);
  const isSpectator = lobby.players.find(p => p.id === socket.id)?.isSpectator;
  // Blackjack plays solo-vs-dealer; everything else needs a second player.
  const minPlayers = lobby.gameType === "blackjack" ? 1 : 2;

  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-4">
      {/* Game title + settings */}
      <p className="text-purple-400 font-semibold text-sm mb-1 uppercase tracking-wider">
        {lobby.deckName}
      </p>
      {lobby.gameType && (
        <div className="flex items-center gap-2 mb-2">
          <span className={`inline-flex items-center gap-1 text-xs font-medium ${GAME_TYPE_DISPLAY[lobby.gameType]?.color || "text-gray-400"}`}>
            <Icon icon={GAME_TYPE_DISPLAY[lobby.gameType]?.icon || "mdi:cards"} width={14} />
            {GAME_TYPE_DISPLAY[lobby.gameType]?.label || lobby.gameType}
          </span>
          <span className="text-gray-600">·</span>
          <span className="text-xs text-gray-400">
            {formatWinCondition(lobby.winCondition?.mode, lobby.winCondition?.value, lobby.gameType)}
          </span>
        {isHost && (
            <button
              onClick={() => setShowDeckPicker(true)}
              className="text-xs text-purple-400 hover:text-purple-300 transition-colors ml-1"
            >
              Change
            </button>
          )}
        </div>
      )}
      {lobby.gameType === "uno" && isHost && (
        <div className="flex items-center gap-2 mb-2">
          <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={lobby.houseRules?.unoStacking || false}
              onChange={(e) => setHouseRules({ ...lobby.houseRules, unoStacking: e.target.checked })}
              className="accent-purple-500 w-3.5 h-3.5"
            />
            Allow Stacking (+2/+4)
          </label>
        </div>
      )}
      {lobby.gameType === "uno" && !isHost && lobby.houseRules?.unoStacking && (
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs text-gray-400">Stacking (+2/+4) enabled</span>
        </div>
      )}
      {(lobby.gameType === "cah" || lobby.gameType === "joking_hazard" || lobby.gameType === "apples_to_apples") && isHost && (
        <div className="flex items-center gap-2 mb-2">
          <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={lobby.houseRules?.botCzar || false}
              onChange={(e) => setHouseRules({ ...lobby.houseRules, botCzar: e.target.checked })}
              className="accent-purple-500 w-3.5 h-3.5"
            />
            Bot card czar (requires &ge;1 bot)
          </label>
        </div>
      )}
      {(lobby.gameType === "cah" || lobby.gameType === "joking_hazard" || lobby.gameType === "apples_to_apples") && !isHost && lobby.houseRules?.botCzar && (
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs text-gray-400">Bot card czar enabled</span>
        </div>
      )}
      <h2 className="text-2xl font-bold mb-4">Lobby</h2>

      <div className="bg-gray-800 border border-purple-500/40 glow-purple px-6 py-4 rounded-lg mb-6 flex flex-col items-center">
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
        <p className="text-gray-400 text-xs mt-2">Scan to join on your phone</p>
        <div className="flex gap-2 mt-3">
          <Button onClick={copyInviteLink} variant="secondary" size="sm">
            {copied ? "Copied!" : "Copy Invite Link"}
          </Button>
          <Button onClick={shareInviteLink} variant="primary" size="sm">
            Share
          </Button>
          <Link
            href="/friends"
            className="inline-flex items-center justify-center gap-2 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded text-xs font-medium transition-colors"
          >
            Invite Friends
          </Link>
        </div>
      </div>

      <div className="w-full max-w-sm mb-6">
        <div className="flex items-center justify-between mb-2">
          <p className="text-gray-400 text-sm">
            Players ({lobby.players.length}/{lobby.maxPlayers})
          </p>
          {isHost && (
            <label className="flex items-center gap-1.5 text-xs text-gray-400">
              Max
              <select
                value={lobby.maxPlayers}
                onChange={(e) => setMaxPlayers(Number(e.target.value))}
                className="bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5 text-white text-xs focus:outline-none focus:border-purple-500"
              >
                {[2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50].map((n) => (
                  <option key={n} value={n} disabled={n < lobby.players.length}>{n}</option>
                ))}
              </select>
            </label>
          )}
        </div>
        <div className="space-y-2">
          {lobby.players.map((player) => (
            <div
              key={player.id}
              className={`flex items-center justify-between bg-gray-800 px-4 py-3 rounded-lg ${
                player.connected === false && !player.isBot ? "opacity-50" : ""
              }`}
            >
              <span className="font-medium inline-flex items-center gap-2">
                <PlayerAvatar name={player.name} isBot={player.isBot} size="md" />
                {player.name}
                {player.id === socket.id && (
                  <span className="text-gray-400 text-sm">(you)</span>
                )}
                {player.isBot && (
                  <span className="text-blue-400 text-sm">BOT</span>
                )}
                {player.isSpectator && (
                  <span className="text-yellow-400 text-sm">WATCHING</span>
                )}
                {player.connected === false && !player.isBot && (
                  <span className="text-yellow-500 text-sm">reconnecting...</span>
                )}
              </span>
              <div className="flex items-center gap-2">
                {player.isBot && isHost && (
                  <button
                    onClick={() => removeBot(player.id)}
                    className="text-xs text-red-400 hover:text-red-300 transition-colors"
                  >
                    Remove
                  </button>
                )}
                {!player.isBot && !player.isHost && isHost && player.id !== socket.id && (
                  <button
                    onClick={() => kickPlayer(player.id)}
                    className="text-xs text-red-400 hover:text-red-300 transition-colors"
                  >
                    Kick
                  </button>
                )}
                {player.isHost && (
                  <span className="text-xs bg-purple-600 px-2 py-1 rounded font-semibold">
                    HOST
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {isHost && lobby.players.length < lobby.maxPlayers && (
        <Button onClick={addBot} variant="secondary" size="md" fullWidth className="max-w-sm mb-4 text-blue-400">
          + Add Bot Player
        </Button>
      )}

      {error && (
        <p className="text-red-400 text-center text-sm mb-4">{error}</p>
      )}

      <div className="w-full max-w-sm mb-4">
        <VoiceChat />
      </div>

      <div className="w-full max-w-sm space-y-3">
        {isHost && (
          <Button onClick={startGame} disabled={activePlayers.length < minPlayers} variant="success" size="lg" fullWidth>
            {activePlayers.length < minPlayers
              ? `Need ${minPlayers - activePlayers.length} more player${minPlayers - activePlayers.length === 1 ? "" : "s"}`
              : "Start Game"}
          </Button>
        )}

        {!isHost && !isSpectator && (
          <p className="text-gray-400 text-center text-sm">
            Waiting for host to start the game...
          </p>
        )}

        {isSpectator && (
          <p className="text-yellow-400 text-center text-sm">
            You&apos;re watching this game
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

      {/* Deck picker modal */}
      {showDeckPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-gray-950 rounded-2xl border border-gray-700 w-full max-w-4xl max-h-[80vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">Change Deck</h3>
              <button
                onClick={() => setShowDeckPicker(false)}
                className="text-gray-400 hover:text-white text-sm"
              >
                Cancel
              </button>
            </div>
            <DeckPicker
              buttonLabel="Select"
              showCreateLink={false}
              onSelect={(deckId) => {
                changeDeck(deckId);
                setShowDeckPicker(false);
              }}
            />
          </div>
        </div>
      )}

      {/* Countdown overlay */}
      {countdown !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <span className="text-8xl font-bold text-purple-400 animate-bounce">
            {countdown}
          </span>
        </div>
      )}
    </div>
  );
}
