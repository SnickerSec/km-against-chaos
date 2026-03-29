"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { fetchDecks, rateDeck, DeckSummary } from "@/lib/api";
import { useAuthStore } from "@/lib/auth";
import GoogleSignIn from "@/components/GoogleSignIn";

const GAME_TYPE_FILTERS = [
  ["all", "All"],
  ["cah", "CAH"],
  ["joking_hazard", "Joking Hazard"],
  ["apples_to_apples", "A2A"],
  ["uno", "Uno"],
] as const;

const SORT_OPTIONS = [
  ["newest", "Newest"],
  ["popular", "Most Played"],
  ["rating", "Top Rated"],
] as const;

type GameTypeFilter = typeof GAME_TYPE_FILTERS[number][0];
type SortOption = typeof SORT_OPTIONS[number][0];

function StarRating({
  value,
  onChange,
  readonly,
}: {
  value: number;
  onChange?: (rating: number) => void;
  readonly?: boolean;
}) {
  const [hover, setHover] = useState(0);

  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          disabled={readonly}
          onClick={() => onChange?.(star)}
          onMouseEnter={() => !readonly && setHover(star)}
          onMouseLeave={() => !readonly && setHover(0)}
          className={`text-lg ${readonly ? "cursor-default" : "cursor-pointer hover:scale-110"} transition-transform`}
          title={readonly ? `${value.toFixed(1)} stars` : `Rate ${star} star${star > 1 ? "s" : ""}`}
        >
          <span
            className={
              (hover || value) >= star
                ? "text-yellow-400"
                : "text-gray-600"
            }
          >
            &#9733;
          </span>
        </button>
      ))}
    </div>
  );
}

function gameTypeBadge(gameType?: string) {
  switch (gameType) {
    case "joking_hazard":
      return { label: "Joking Hazard", classes: "bg-orange-600/30 text-orange-300" };
    case "apples_to_apples":
      return { label: "Apples to Apples", classes: "bg-green-600/30 text-green-300" };
    case "uno":
      return { label: "Uno", classes: "bg-blue-600/30 text-blue-300" };
    default:
      return { label: "CAH", classes: "bg-red-600/30 text-red-300" };
  }
}

function BrowseDeckCard({
  deck,
  isLoggedIn,
  onRate,
}: {
  deck: DeckSummary;
  isLoggedIn: boolean;
  onRate: (deckId: string, rating: number) => void;
}) {
  const badge = gameTypeBadge(deck.gameType);

  return (
    <div className="bg-gray-900 rounded-xl p-5 border border-gray-800 hover:border-gray-700 transition-colors">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h3 className="font-bold text-lg text-white">{deck.name}</h3>
            <span className={`text-xs px-2 py-0.5 rounded-full ${badge.classes}`}>
              {badge.label}
            </span>
            {deck.builtIn && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-purple-600/30 text-purple-300">Featured</span>
            )}
          </div>
          {deck.description && (
            <p className="text-gray-400 text-sm mb-2 line-clamp-2">{deck.description}</p>
          )}
          <div className="flex items-center gap-3 text-xs text-gray-500 flex-wrap">
            {deck.ownerName && <span>by {deck.ownerName}</span>}
            <span>
              {deck.gameType === "uno"
                ? "108 cards"
                : `${deck.chaosCount} prompts / ${deck.knowledgeCount} answers`}
            </span>
            <span className="flex items-center gap-1">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {deck.playCount || 0} plays
            </span>
          </div>
          <div className="flex items-center gap-2 mt-2">
            <StarRating
              value={deck.avgRating || 0}
              onChange={isLoggedIn ? (r) => onRate(deck.id, r) : undefined}
              readonly={!isLoggedIn}
            />
            {(deck.avgRating || 0) > 0 && (
              <span className="text-xs text-gray-500">{(deck.avgRating || 0).toFixed(1)}</span>
            )}
          </div>
        </div>
        <Link
          href={`/?deck=${deck.id}`}
          className="shrink-0 px-5 py-2.5 bg-green-600 hover:bg-green-700 rounded-lg font-semibold text-sm text-white transition-colors"
        >
          Host
        </Link>
      </div>
    </div>
  );
}

export default function BrowseDecksPage() {
  const [decks, setDecks] = useState<DeckSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<GameTypeFilter>("all");
  const [sort, setSort] = useState<SortOption>("newest");
  const authUser = useAuthStore((s) => s.user);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadDecks = useCallback(
    (searchVal: string, gameType: GameTypeFilter, sortVal: SortOption) => {
      setLoading(true);
      fetchDecks({
        search: searchVal || undefined,
        gameType: gameType === "all" ? undefined : gameType,
        sort: sortVal,
      })
        .then(setDecks)
        .catch(() => setDecks([]))
        .finally(() => setLoading(false));
    },
    []
  );

  // Initial load
  useEffect(() => {
    loadDecks(search, filter, sort);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reload when filter/sort change (immediate)
  useEffect(() => {
    loadDecks(search, filter, sort);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, sort]);

  // Debounced search
  const handleSearchChange = (val: string) => {
    setSearch(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      loadDecks(val, filter, sort);
    }, 350);
  };

  const handleRate = async (deckId: string, rating: number) => {
    try {
      await rateDeck(deckId, rating);
      // Refresh the list to get updated rating
      loadDecks(search, filter, sort);
    } catch {
      // silently fail
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 min-h-screen">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <Link href="/" className="text-gray-400 hover:text-white text-sm transition-colors mb-1 inline-block">
            &larr; Back to Home
          </Link>
          <h1 className="text-2xl font-bold text-white">Browse Decks</h1>
          <p className="text-gray-400 text-sm">Discover and play community-created card games</p>
        </div>
        <GoogleSignIn />
      </div>

      {/* Search bar */}
      <div className="mb-4">
        <input
          type="text"
          placeholder="Search decks..."
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-purple-500 text-sm"
        />
      </div>

      {/* Filters row */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        {/* Game type filter */}
        <div className="flex gap-2 flex-wrap">
          {GAME_TYPE_FILTERS.map(([value, label]) => (
            <button
              key={value}
              onClick={() => setFilter(value)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                filter === value
                  ? "bg-purple-600 text-white"
                  : "bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Sort dropdown */}
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortOption)}
          className="ml-auto px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-300 focus:outline-none focus:border-purple-500"
        >
          {SORT_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {/* Deck list */}
      {loading ? (
        <p className="text-gray-400 text-center py-8">Loading decks...</p>
      ) : decks.length === 0 ? (
        <p className="text-gray-500 text-center py-8">No decks found. Try a different search or filter.</p>
      ) : (
        <div className="space-y-3">
          {decks.map((deck) => (
            <BrowseDeckCard
              key={deck.id}
              deck={deck}
              isLoggedIn={!!authUser}
              onRate={handleRate}
            />
          ))}
        </div>
      )}

      {/* Create your own CTA */}
      <Link
        href="/decks/new"
        className="block mt-6 bg-gray-900 rounded-xl p-5 border-2 border-dashed border-gray-700 hover:border-purple-500 transition-colors text-center"
      >
        <p className="text-purple-400 font-semibold text-lg mb-1">+ Create Your Own</p>
        <p className="text-gray-500 text-sm">Build a custom card game with your own prompts and answers</p>
      </Link>
    </div>
  );
}
