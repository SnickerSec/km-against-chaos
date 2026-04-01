"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { Icon } from "@iconify/react";
import { fetchDecks, toggleFavorite, getFavorites, DeckSummary } from "@/lib/api";
import { useAuthStore } from "@/lib/auth";
import GameTypeBadge from "./GameTypeBadge";
import StarRating from "./StarRating";

const GAME_TYPE_FILTERS = [
  ["all", "All Games", "mdi:cards-playing"],
  ["cah", "CAH", "mdi:cards"],
  ["joking_hazard", "Joking Hazard", "mdi:comic-bubble"],
  ["apples_to_apples", "A2A", "mdi:fruit-cherries"],
  ["uno", "Uno", "mdi:numeric"],
  ["superfight", "Superfight", "mdi:arm-flex"],
] as const;

const MATURITY_FILTERS = [
  ["all", "All Ages"],
  ["kid-friendly", "Kid-Friendly"],
  ["moderate", "Moderate"],
  ["adult", "Adult"],
  ["raunchy", "Raunchy"],
] as const;

const SORT_OPTIONS = [
  ["popular", "Most Played", "mdi:fire"],
  ["rating", "Top Rated", "mdi:star"],
  ["newest", "Newest", "mdi:clock-outline"],
  ["favorites", "Favorites", "mdi:heart"],
] as const;

type GameTypeFilter = typeof GAME_TYPE_FILTERS[number][0];
type MaturityFilter = typeof MATURITY_FILTERS[number][0];
type SortOption = typeof SORT_OPTIONS[number][0];

function TrendingCard({
  deck,
  rank,
  onSelect,
}: {
  deck: DeckSummary;
  rank: number;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      onClick={() => onSelect(deck.id)}
      className="group relative bg-gradient-to-br from-gray-800 to-gray-900 rounded-xl p-4 border border-gray-700 hover:border-purple-500 transition-all hover:shadow-lg hover:shadow-purple-900/20 text-left w-full"
    >
      <div className="absolute -top-2 -left-2 w-7 h-7 bg-purple-600 rounded-full flex items-center justify-center text-xs font-bold shadow-lg">
        #{rank}
      </div>
      <h3 className="font-bold text-white mb-1 pr-4 truncate">{deck.name}</h3>
      <div className="flex items-center gap-2 text-xs text-gray-400 mb-2">
        <GameTypeBadge gameType={deck.gameType} />
        {deck.ownerName && <span className="truncate">by {deck.ownerName}</span>}
      </div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 text-xs text-gray-500">
          <Icon icon="mdi:play-circle" width={14} />
          <span>{deck.playCount || 0} plays</span>
        </div>
        {(deck.avgRating || 0) > 0 && (
          <div className="flex items-center gap-1 text-xs">
            <span className="text-yellow-400">&#9733;</span>
            <span className="text-gray-400">{(deck.avgRating || 0).toFixed(1)}</span>
          </div>
        )}
      </div>
    </button>
  );
}

function DeckCard({
  deck,
  isLoggedIn,
  isFavorited,
  onToggleFavorite,
  onSelect,
  buttonLabel,
}: {
  deck: DeckSummary;
  isLoggedIn: boolean;
  isFavorited: boolean;
  onToggleFavorite: (deckId: string) => void;
  onSelect: (id: string) => void;
  buttonLabel?: string;
}) {
  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 hover:border-gray-700 transition-all overflow-hidden">
      <div className="p-4">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-bold text-white truncate">{deck.name}</h3>
              {deck.builtIn && (
                <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-purple-600/30 text-purple-300 font-medium">
                  Featured
                </span>
              )}
              {deck.artTier === "premium" && (
                <span title="Has AI art"><Icon icon="mdi:palette" className="shrink-0 text-purple-400" width={14} /></span>
              )}
            </div>
            {deck.description && (
              <p className="text-gray-400 text-xs line-clamp-2 mb-2">{deck.description}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs text-gray-500 flex-wrap mb-3">
          <GameTypeBadge gameType={deck.gameType} />
          {deck.ownerName && <span>by {deck.ownerName}</span>}
          <span className="text-gray-700">|</span>
          <span>
            {deck.gameType === "uno"
              ? "108 cards"
              : deck.gameType === "superfight"
              ? `${deck.chaosCount}C / ${deck.knowledgeCount}A`
              : `${deck.chaosCount}P / ${deck.knowledgeCount}A`}
          </span>
          {deck.maturity && deck.maturity !== "adult" && (
            <>
              <span className="text-gray-700">|</span>
              <span className={
                deck.maturity === "kid-friendly" ? "text-green-400"
                : deck.maturity === "raunchy" ? "text-red-400"
                : "text-gray-400"
              }>
                {deck.maturity === "kid-friendly" ? "Kid-Friendly"
                  : deck.maturity === "moderate" ? "Moderate"
                  : "Raunchy"}
              </span>
            </>
          )}
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 text-xs text-gray-500">
              <Icon icon="mdi:play-circle" width={14} />
              <span>{deck.playCount || 0}</span>
            </div>
            <StarRating
              value={deck.avgRating || 0}
              readonly
              size="text-sm"
            />
            {(deck.avgRating || 0) > 0 && (
              <span className="text-xs text-gray-500">{(deck.avgRating || 0).toFixed(1)}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {isLoggedIn && (
              <button
                onClick={() => onToggleFavorite(deck.id)}
                className={`p-1.5 rounded-lg transition-colors ${
                  isFavorited
                    ? "text-red-400 hover:text-red-300"
                    : "text-gray-600 hover:text-gray-400"
                }`}
                title={isFavorited ? "Remove from favorites" : "Add to favorites"}
              >
                <Icon icon={isFavorited ? "mdi:heart" : "mdi:heart-outline"} width={16} />
              </button>
            )}
            <Link
              href={`/decks/new?remixOf=${deck.id}`}
              className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-xs text-gray-300 transition-colors"
              title="Remix this deck"
            >
              <Icon icon="svg-spinners:blocks-shuffle-3" width={14} />
            </Link>
            <button
              onClick={() => onSelect(deck.id)}
              className="px-4 py-1.5 bg-green-600 hover:bg-green-700 rounded-lg font-semibold text-xs text-white transition-colors"
            >
              {buttonLabel || "Host"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DeckPicker({ onSelect, title, buttonLabel, showCreateLink = true, search: externalSearch, onSearchChange }: {
  onSelect: (deckId: string) => void;
  title?: string;
  buttonLabel?: string;
  showCreateLink?: boolean;
  search?: string;
  onSearchChange?: (val: string) => void;
}) {
  const [decks, setDecks] = useState<DeckSummary[]>([]);
  const [trending, setTrending] = useState<DeckSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [internalSearch, setInternalSearch] = useState("");
  const search = externalSearch ?? internalSearch;
  const [filter, setFilter] = useState<GameTypeFilter>("all");
  const [maturity, setMaturity] = useState<MaturityFilter>("all");
  const [sort, setSort] = useState<SortOption>("popular");
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  const authUser = useAuthStore((s) => s.user);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load favorites when logged in
  useEffect(() => {
    if (authUser) {
      getFavorites()
        .then((ids) => setFavoriteIds(new Set(ids)))
        .catch(() => {});
    }
  }, [authUser]);

  // Load trending on mount
  useEffect(() => {
    fetchDecks({ sort: "popular" })
      .then((all) => setTrending(all.filter(d => (d.playCount || 0) > 0).slice(0, 3)))
      .catch(() => {});
  }, []);

  const loadDecks = useCallback(
    (searchVal: string, gameType: GameTypeFilter, sortVal: SortOption, maturityVal: MaturityFilter) => {
      setLoading(true);
      fetchDecks({
        search: searchVal || undefined,
        gameType: gameType === "all" ? undefined : gameType,
        sort: sortVal,
        maturity: maturityVal === "all" ? undefined : maturityVal,
      })
        .then(setDecks)
        .catch(() => setDecks([]))
        .finally(() => setLoading(false));
    },
    []
  );

  useEffect(() => {
    loadDecks(search, filter, sort, maturity);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, sort, maturity]);

  // Initial load
  useEffect(() => {
    loadDecks("", "all", "popular", "all");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced reload when external search prop changes
  useEffect(() => {
    if (externalSearch === undefined) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      loadDecks(externalSearch, filter, sort, maturity);
    }, 350);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalSearch]);

  const handleSearchChange = (val: string) => {
    setInternalSearch(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      loadDecks(val, filter, sort, maturity);
    }, 350);
  };

  const handleToggleFavorite = async (deckId: string) => {
    try {
      const { favorited } = await toggleFavorite(deckId);
      setFavoriteIds((prev) => {
        const next = new Set(prev);
        if (favorited) next.add(deckId);
        else next.delete(deckId);
        return next;
      });
    } catch {}
  };

  const hasActiveFilters = search || filter !== "all" || maturity !== "all";
  const showFavorites = sort === "favorites";
  const displayDecks = showFavorites ? decks.filter(d => favoriteIds.has(d.id)) : decks;

  return (
    <div>
      {title && <h2 className="text-lg font-semibold text-gray-300 mb-3 text-center">{title}</h2>}

      {/* Search — only render inline when not externally controlled */}
      {!onSearchChange && (
        <div className="relative mb-4">
          <Icon icon="mdi:magnify" className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" width={18} />
          <input
            type="text"
            placeholder="Search by name or description..."
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="w-full pl-10 pr-4 py-3 bg-gray-800 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-purple-500 text-sm"
          />
        </div>
      )}

      {/* Trending section — hide when searching/filtering */}
      {!hasActiveFilters && trending.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-purple-400 uppercase tracking-wider mb-3 flex items-center gap-2">
            <Icon icon="mdi:trending-up" width={16} />
            Trending
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {trending.map((deck, i) => (
              <TrendingCard key={deck.id} deck={deck} rank={i + 1} onSelect={onSelect} />
            ))}
          </div>
        </div>
      )}

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 mb-2">
        {GAME_TYPE_FILTERS.map(([value, label, icon]) => (
          <button
            key={value}
            onClick={() => setFilter(value)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              filter === value
                ? "bg-purple-600 text-white"
                : "bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700"
            }`}
          >
            <Icon icon={icon} width={14} />
            {label}
          </button>
        ))}
      </div>

      {/* Maturity + sort row */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
        {MATURITY_FILTERS.map(([value, label]) => (
          <button
            key={value}
            onClick={() => setMaturity(value)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              maturity === value
                ? "bg-gray-600 text-white"
                : "bg-gray-800/50 text-gray-500 hover:text-gray-300 hover:bg-gray-800"
            }`}
          >
            {label}
          </button>
        ))}

        <div className="ml-auto flex items-center gap-1">
          {SORT_OPTIONS.filter(([value]) => value !== "favorites" || authUser).map(([value, label, icon]) => (
            <button
              key={value}
              onClick={() => setSort(value)}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                sort === value
                  ? "bg-gray-700 text-white"
                  : "text-gray-500 hover:text-gray-300"
              }`}
              title={label}
            >
              <Icon icon={icon} width={14} />
              <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Deck grid */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Icon icon="mdi:loading" className="text-2xl text-purple-400 animate-spin" />
        </div>
      ) : displayDecks.length === 0 ? (
        <div className="text-center py-12">
          <Icon icon={showFavorites ? "mdi:heart-outline" : "mdi:cards-playing-outline"} className="text-4xl text-gray-700 mx-auto mb-3" />
          <p className="text-gray-500">
            {showFavorites ? "No favorites yet. Heart some decks to save them here." : "No decks found. Try a different search or filter."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {displayDecks.map((deck) => (
            <DeckCard
              key={deck.id}
              deck={deck}
              isLoggedIn={!!authUser}
              isFavorited={favoriteIds.has(deck.id)}
              onToggleFavorite={handleToggleFavorite}
              onSelect={onSelect}
              buttonLabel={buttonLabel}
            />
          ))}
        </div>
      )}

      {/* Create CTA */}
      {showCreateLink && <Link
        href="/decks/new"
        className="block mt-6 bg-gray-900 rounded-xl p-6 border-2 border-dashed border-gray-700 hover:border-purple-500 transition-colors text-center group"
      >
        <Icon icon="mdi:plus-circle-outline" className="text-3xl text-purple-400 mx-auto mb-2 group-hover:scale-110 transition-transform" />
        <p className="text-purple-400 font-semibold text-lg">Create Your Own</p>
        <p className="text-gray-500 text-sm mt-1">Build a custom card game with your own prompts and answers</p>
      </Link>}
    </div>
  );
}
