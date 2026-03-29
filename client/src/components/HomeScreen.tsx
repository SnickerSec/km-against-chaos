"use client";

import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useGameStore } from "@/lib/store";
import { useSocket } from "@/lib/useSocket";
import { useAuthStore } from "@/lib/auth";
import GoogleSignIn from "@/components/GoogleSignIn";
import DeckPicker from "@/components/DeckPicker";

export default function HomeScreen() {
  const searchParams = useSearchParams();
  const codeFromUrl = searchParams.get("code");

  const nameRef = useRef<HTMLInputElement>(null);
  const roomCodeRef = useRef<HTMLInputElement>(null);
  const authUser = useAuthStore((s) => s.user);

  const [name, setName] = useState("");
  const [roomCode, setRoomCode] = useState(codeFromUrl?.toUpperCase() || "");
  const [selectedDeck, setSelectedDeck] = useState<string | null>(null);
  const { error, setError, setPlayerName } = useGameStore();
  const { createLobby, joinLobby, spectateGame } = useSocket();

  useEffect(() => {
    if (codeFromUrl) {
      setRoomCode(codeFromUrl.toUpperCase());
    }
  }, [codeFromUrl]);

  // Auto-populate name from Google sign-in
  useEffect(() => {
    if (authUser?.name && !name) {
      setName(authUser.name.split(" ")[0]); // Use first name
    }
  }, [authUser]); // eslint-disable-line react-hooks/exhaustive-deps

  const focusName = () => {
    setError("Enter your name first");
    nameRef.current?.focus();
  };

  const handleCreate = (deckId: string) => {
    if (!name.trim()) {
      focusName();
      return;
    }
    setPlayerName(name.trim());
    setSelectedDeck(deckId);
    createLobby(name.trim(), deckId);
  };

  const handleJoin = () => {
    if (!name.trim()) {
      focusName();
      return;
    }
    if (!roomCode.trim()) {
      setError("Enter the room code");
      roomCodeRef.current?.focus();
      return;
    }
    setPlayerName(name.trim());
    joinLobby(roomCode.trim().toUpperCase(), name.trim());
  };

  const handleSpectate = () => {
    if (!name.trim()) {
      focusName();
      return;
    }
    if (!roomCode.trim()) {
      setError("Enter the room code");
      roomCodeRef.current?.focus();
      return;
    }
    setPlayerName(name.trim());
    spectateGame(roomCode.trim().toUpperCase(), name.trim());
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 min-h-screen">
      {/* Header */}
      <div className="flex flex-col items-start mb-8">
        <div className="flex items-center justify-between w-full mb-2">
          <h1>
            <svg viewBox="-10 0 240 58" className="w-64 h-auto block -ml-3" aria-label="Decked">
            {/* Back card */}
            <rect x="2" y="4" width="34" height="46" rx="5" fill="#6b21a8" stroke="#a855f7" strokeWidth="1.5" transform="rotate(-12 19 27)"/>
            {/* Middle card */}
            <rect x="8" y="2" width="34" height="46" rx="5" fill="#4c1d95" stroke="#a855f7" strokeWidth="1.5" transform="rotate(-4 25 25)"/>
            {/* Front card */}
            <rect x="14" y="4" width="34" height="46" rx="5" fill="#1f2937" stroke="#a855f7" strokeWidth="2"/>
            {/* D on front card */}
            <text x="31" y="34" textAnchor="middle" fontFamily="Arial,sans-serif" fontWeight="bold" fontSize="24" fill="#a855f7">D</text>
            {/* "ecked" text */}
            <text x="58" y="42" fontFamily="Arial,sans-serif" fontWeight="bold" fontSize="42" fill="#c084fc" letterSpacing="2">ecked</text>
          </svg>
          </h1>
          <GoogleSignIn />
        </div>
        <div className="flex items-center gap-4">
          <p className="text-gray-400">
            Create and play custom card games
          </p>
          <Link href="/friends" className="text-gray-400 hover:text-white text-sm transition-colors">Friends</Link>
          <Link href="/stats" className="text-gray-400 hover:text-white text-sm transition-colors">Stats</Link>
        </div>
      </div>

      {/* Name input — always visible */}
      <div className="max-w-sm mx-auto mb-6">
        <input
          ref={nameRef}
          type="text"
          placeholder="Your name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && roomCode.trim()) handleJoin();
          }}
          maxLength={20}
          className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-purple-500 text-lg"
        />
      </div>

      {/* Join by Code — always visible */}
      <div className="max-w-sm mx-auto mb-8">
        <div className="flex gap-2">
          <input
            ref={roomCodeRef}
            type="text"
            placeholder="Room Code"
            value={roomCode}
            onChange={(e) => {
              setRoomCode(e.target.value.toUpperCase());
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleJoin();
            }}
            maxLength={4}
            className="min-w-0 flex-1 px-2 sm:px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-purple-500 text-lg"
          />
          <button
            onClick={handleJoin}
            className="shrink-0 px-6 py-3 bg-green-600 hover:bg-green-700 rounded-lg font-semibold transition-colors"
          >
            Join
          </button>
          <button
            onClick={handleSpectate}
            className="shrink-0 px-4 py-3 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg text-sm font-medium transition-colors"
            title="Watch the game without playing"
          >
            Watch
          </button>
        </div>
      </div>

      {error && (
        <p className="text-red-400 text-center text-sm mb-4">{error}</p>
      )}

      {/* Host a Game */}
      <DeckPicker title="Host a Game" onSelect={handleCreate} />

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

