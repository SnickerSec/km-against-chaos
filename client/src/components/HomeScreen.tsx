"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useGameStore } from "@/lib/store";
import { useSocket } from "@/lib/useSocket";
import { fetchDecks, DeckSummary } from "@/lib/api";

export default function HomeScreen() {
  const searchParams = useSearchParams();
  const codeFromUrl = searchParams.get("code");

  const [decks, setDecks] = useState<DeckSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [roomCode, setRoomCode] = useState(codeFromUrl?.toUpperCase() || "");
  const [selectedDeck, setSelectedDeck] = useState<string | null>(null);
  const { error, setError, setPlayerName } = useGameStore();
  const { createLobby, joinLobby } = useSocket();

  useEffect(() => {
    fetchDecks()
      .then(setDecks)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (codeFromUrl) {
      setRoomCode(codeFromUrl.toUpperCase());
    }
  }, [codeFromUrl]);

  const handleCreate = (deckId: string) => {
    if (!name.trim()) {
      setError("Enter your name first");
      return;
    }
    setPlayerName(name.trim());
    setSelectedDeck(deckId);
    createLobby(name.trim(), deckId);
  };

  const handleJoin = () => {
    if (!name.trim()) {
      setError("Enter your name first");
      return;
    }
    if (!roomCode.trim()) {
      setError("Enter the room code");
      return;
    }
    setPlayerName(name.trim());
    joinLobby(roomCode.trim().toUpperCase(), name.trim());
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 min-h-screen">
      {/* Header */}
      <div className="text-center mb-8">
        <h1 className="text-5xl font-bold mb-2">
          <span className="text-purple-400">Decked</span>
        </h1>
        <p className="text-gray-400">
          Create and play custom card games
        </p>
      </div>

      {/* Name input — always visible */}
      <div className="max-w-sm mx-auto mb-6">
        <input
          type="text"
          placeholder="Your name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          maxLength={20}
          className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-purple-500 text-center text-lg"
        />
      </div>

      {/* Join by Code — always visible */}
      <div className="max-w-sm mx-auto mb-8">
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Room Code"
            value={roomCode}
            onChange={(e) => {
              setRoomCode(e.target.value.toUpperCase());
              setError(null);
            }}
            maxLength={4}
            className="flex-1 px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-purple-500 text-center text-2xl tracking-[0.3em] font-mono"
          />
          <button
            onClick={handleJoin}
            className="shrink-0 px-6 py-3 bg-green-600 hover:bg-green-700 rounded-lg font-semibold transition-colors"
          >
            Join
          </button>
        </div>
      </div>

      {error && (
        <p className="text-red-400 text-center text-sm mb-4">{error}</p>
      )}

      {/* Host a Game */}
      <div>
        <h2 className="text-lg font-semibold text-gray-300 mb-3 text-center">Host a Game</h2>
        {loading ? (
          <p className="text-gray-400 text-center">Loading games...</p>
        ) : (
          <div className="space-y-3">
            {decks.map((deck) => (
              <div
                key={deck.id}
                className="bg-gray-900 rounded-xl p-5 border border-gray-800 hover:border-gray-700 transition-colors"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-bold text-lg">{deck.name}</h3>
                      {deck.builtIn && (
                        <span className="text-xs bg-purple-600/30 text-purple-300 px-2 py-0.5 rounded-full">
                          Featured
                        </span>
                      )}
                    </div>
                    {deck.description && (
                      <p className="text-gray-400 text-sm mb-2">{deck.description}</p>
                    )}
                    <p className="text-gray-600 text-xs">
                      {deck.chaosCount} prompts · {deck.knowledgeCount} answers · {
                        deck.winCondition?.mode === "points"
                          ? `First to ${deck.winCondition.value} pts`
                          : `${deck.winCondition?.value || 10} rounds`
                      }
                    </p>
                  </div>
                  <button
                    onClick={() => handleCreate(deck.id)}
                    className="shrink-0 px-5 py-2.5 bg-green-600 hover:bg-green-700 rounded-lg font-semibold text-sm transition-colors"
                  >
                    Host
                  </button>
                </div>
              </div>
            ))}

            {/* Create your own */}
            <Link
              href="/decks/new"
              className="block bg-gray-900 rounded-xl p-5 border-2 border-dashed border-gray-700 hover:border-purple-500 transition-colors text-center"
            >
              <p className="text-purple-400 font-semibold text-lg mb-1">
                + Create Your Own
              </p>
              <p className="text-gray-500 text-sm">
                Build a custom card game with your own prompts and answers
              </p>
            </Link>
          </div>
        )}
      </div>

      {/* Nav links */}
      <div className="flex justify-center mt-10">
        <Link
          href="/decks"
          className="text-gray-500 hover:text-purple-400 text-sm transition-colors"
        >
          Manage Decks
        </Link>
      </div>

      {/* Legal footer */}
      <div className="flex justify-center mt-6 pb-4">
        <Link
          href="/privacy"
          className="text-gray-700 hover:text-gray-500 text-xs transition-colors"
        >
          Privacy Policy
        </Link>
      </div>
    </div>
  );
}
