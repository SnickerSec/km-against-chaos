"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { Icon } from "@iconify/react";
import { useGameStore } from "@/lib/store";
import { useSocket } from "@/lib/useSocket";
import { useAuthStore } from "@/lib/auth";
import GoogleSignIn from "@/components/GoogleSignIn";
import DeckPicker from "@/components/DeckPicker";

export default function HomeScreen() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const codeFromUrl = searchParams.get("code");
  const deckFromUrl = searchParams.get("deck");

  const nameRef = useRef<HTMLInputElement>(null);
  const roomCodeRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const mobileSearchRef = useRef<HTMLInputElement>(null);
  const authUser = useAuthStore((s) => s.user);

  const [name, setName] = useState("");
  const [roomCode, setRoomCode] = useState(codeFromUrl?.toUpperCase() || "");
  const [selectedDeck, setSelectedDeck] = useState<string | null>(null);
  const [deckSearch, setDeckSearch] = useState("");
  const { error, setError, setPlayerName } = useGameStore();
  const { createLobby, joinLobby, spectateGame } = useSocket();

  useEffect(() => {
    if (codeFromUrl) {
      setRoomCode(codeFromUrl.toUpperCase());
    }
  }, [codeFromUrl]);

  // Focus search bar on '/' key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((e.target as HTMLElement)?.isContentEditable) return;
      if (e.key === "/") {
        e.preventDefault();
        // Focus whichever search input is visible
        const desktop = searchRef.current;
        const mobile = mobileSearchRef.current;
        if (desktop && desktop.offsetParent !== null) desktop.focus();
        else mobile?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Auto-populate name from Google sign-in
  useEffect(() => {
    if (authUser?.name && !name) {
      setName(authUser.name.split(" ")[0]); // Use first name
    }
  }, [authUser]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-host when ?deck= param is present
  useEffect(() => {
    if (!deckFromUrl) return;
    // Clear the param from URL so it doesn't re-trigger
    router.replace("/", { scroll: false });
    if (name.trim()) {
      handleCreate(deckFromUrl);
    } else {
      // Pre-select deck, prompt for name
      setSelectedDeck(deckFromUrl);
      setError("Enter your name to host this deck");
      nameRef.current?.focus();
    }
  }, [deckFromUrl]); // eslint-disable-line react-hooks/exhaustive-deps

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
    <div className="max-w-4xl mx-auto px-4 py-8 min-h-screen">
      {/* Header */}
      <div className="flex flex-col items-start mb-8">
        <div className="flex items-center justify-between w-full mb-2">
          <h1>
            <svg viewBox="0 0 520 160" className="w-80 h-auto block -ml-3" aria-label="Decked" fill="none">
            <defs>
              <linearGradient id="cardGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#A855F7" stopOpacity="0.55"/>
                <stop offset="100%" stopColor="#6D28D9" stopOpacity="0.45"/>
              </linearGradient>
              <linearGradient id="eckedGrad" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#C084FC"/>
                <stop offset="100%" stopColor="#A855F7"/>
              </linearGradient>
              <filter id="cardGlow" filterUnits="userSpaceOnUse" x="0" y="0" width="240" height="160">
                <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur"/>
                <feMerge>
                  <feMergeNode in="blur"/>
                  <feMergeNode in="SourceGraphic"/>
                </feMerge>
              </filter>
              <filter id="sepGlow" filterUnits="userSpaceOnUse" x="280" y="30" width="40" height="80">
                <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur1"/>
                <feMerge>
                  <feMergeNode in="blur1"/>
                  <feMergeNode in="blur1"/>
                  <feMergeNode in="SourceGraphic"/>
                </feMerge>
              </filter>
              <filter id="textGlow" filterUnits="userSpaceOnUse" x="60" y="30" width="260" height="80">
                <feGaussianBlur in="SourceGraphic" stdDeviation="1.5" result="blur"/>
                <feMerge>
                  <feMergeNode in="blur"/>
                  <feMergeNode in="SourceGraphic"/>
                </feMerge>
              </filter>
            </defs>
            {/* Card stack — translucent neon */}
            <g filter="url(#cardGlow)">
              <rect x="28" y="18" width="85" height="115" rx="10" fill="url(#cardGrad)" stroke="#C084FC" strokeOpacity="0.6" strokeWidth="1.5" transform="rotate(-12 70 75)"/>
              <rect x="38" y="15" width="85" height="115" rx="10" fill="url(#cardGrad)" stroke="#C084FC" strokeOpacity="0.75" strokeWidth="1.5" transform="rotate(-6 80 72)"/>
              <rect x="48" y="14" width="85" height="115" rx="10" fill="url(#cardGrad)" stroke="#E9D5FF" strokeOpacity="0.9" strokeWidth="1.5"/>
            </g>
            {/* Outlined D on front card */}
            <text x="90" y="72" fontFamily="Arial, Helvetica, sans-serif" fontSize="58" fontWeight="bold" fill="none" stroke="#E9D5FF" strokeWidth="2" textAnchor="middle" dominantBaseline="central" filter="url(#textGlow)">D</text>
            {/* "ecked" gradient text with glow */}
            <text x="140" y="72" fontFamily="Arial, Helvetica, sans-serif" fontSize="48" fontWeight="bold" fill="url(#eckedGrad)" letterSpacing="2" dominantBaseline="central" filter="url(#textGlow)">ecked</text>
            {/* Separator — cyan neon */}
            <line x1="300" y1="42" x2="300" y2="98" stroke="#22D3EE" strokeWidth="3" strokeLinecap="round" filter="url(#sepGlow)" className="logo-sep-pulse"/>
            {/* Subtitle — gold */}
            <text x="315" y="75" fontFamily="Arial, Helvetica, sans-serif" fontSize="9" fontWeight="400" fill="#D4A84C" letterSpacing="3" dominantBaseline="central">DIGITAL CARD EXPERIENCE</text>
          </svg>
          </h1>
          <div className="flex items-center gap-3">
            <div className="relative hidden sm:block">
              <Icon icon="mdi:magnify" className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" width={18} />
              <input
                ref={searchRef}
                type="text"
                placeholder="Search decks..."
                value={deckSearch}
                onChange={(e) => setDeckSearch(e.target.value)}
                className="w-64 pl-10 pr-4 py-2 bg-gray-800 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-purple-500 text-sm"
              />
            </div>
            <GoogleSignIn />
          </div>
        </div>
        {/* Mobile search — visible only on small screens */}
        <div className="relative w-full mt-3 sm:hidden">
          <Icon icon="mdi:magnify" className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" width={18} />
          <input
            ref={mobileSearchRef}
            type="text"
            placeholder="Search decks..."
            value={deckSearch}
            onChange={(e) => setDeckSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-gray-800 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-purple-500 text-sm"
          />
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
            if (e.key === "Enter") {
              if (selectedDeck) handleCreate(selectedDeck);
              else if (roomCode.trim()) handleJoin();
            }
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
      <DeckPicker title="Host a Game" onSelect={handleCreate} search={deckSearch} onSearchChange={setDeckSearch} />

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

