"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { fetchDecks, DeckSummary } from "@/lib/api";

const GAME_TYPE_FILTERS = [
  ["all", "All"],
  ["cah", "Cards Against Humanity"],
  ["joking_hazard", "Joking Hazard"],
  ["apples_to_apples", "Apples to Apples"],
  ["uno", "Uno"],
  ["codenames", "Codenames"],
] as const;

type GameTypeFilter = typeof GAME_TYPE_FILTERS[number][0];

function DeckCard({ deck, onSelect, buttonLabel }: { deck: DeckSummary; onSelect: (id: string) => void; buttonLabel?: string }) {
  return (
    <div className="bg-gray-900 rounded-xl p-5 border border-gray-800 hover:border-gray-700 transition-colors">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h3 className="font-bold text-lg">{deck.name}</h3>
            <span className={`text-xs px-2 py-0.5 rounded-full ${
              deck.gameType === "joking_hazard"
                ? "bg-orange-600/30 text-orange-300"
                : deck.gameType === "apples_to_apples"
                ? "bg-green-600/30 text-green-300"
                : deck.gameType === "uno"
                ? "bg-blue-600/30 text-blue-300"
                : deck.gameType === "codenames"
                ? "bg-cyan-600/30 text-cyan-300"
                : "bg-red-600/30 text-red-300"
            }`}>
              {deck.gameType === "joking_hazard" ? "Joking Hazard" : deck.gameType === "apples_to_apples" ? "Apples to Apples" : deck.gameType === "uno" ? "Uno" : deck.gameType === "codenames" ? "Codenames" : "CAH"}
            </span>
          </div>
          {deck.description && (
            <p className="text-gray-400 text-sm mb-2">{deck.description}</p>
          )}
          <p className="text-gray-600 text-xs">
            {deck.ownerName && <span>by {deck.ownerName} · </span>}
            {deck.gameType === "uno"
              ? "108 cards"
              : deck.gameType === "codenames"
              ? `${deck.knowledgeCount} words`
              : `${deck.chaosCount} prompts · ${deck.knowledgeCount} answers`}
            {" · "}
            {deck.gameType === "codenames"
              ? "Team word-guessing"
              : deck.winCondition?.mode === "points"
              ? `First to ${deck.winCondition.value} pts`
              : deck.winCondition?.mode === "single_round"
              ? "Single round"
              : deck.winCondition?.mode === "lowest_score"
              ? `Lowest score (${deck.winCondition.value} limit)`
              : `${deck.winCondition?.value || 10} rounds`}
          </p>
        </div>
        <button
          onClick={() => onSelect(deck.id)}
          className="shrink-0 px-5 py-2.5 bg-green-600 hover:bg-green-700 rounded-lg font-semibold text-sm transition-colors"
        >
          {buttonLabel || "Host"}
        </button>
      </div>
    </div>
  );
}

function DeckListInner({ decks, filter, onSelect, buttonLabel, showCreateLink }: {
  decks: DeckSummary[];
  filter: GameTypeFilter;
  onSelect: (id: string) => void;
  buttonLabel?: string;
  showCreateLink?: boolean;
}) {
  const filtered = filter === "all" ? decks : decks.filter((d) => (d.gameType || "cah") === filter);
  const featured = filtered.filter((d) => d.builtIn);
  const community = filtered.filter((d) => !d.builtIn);

  return (
    <div className="space-y-6">
      {featured.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-purple-400 uppercase tracking-wider mb-2">Featured</h3>
          <div className="space-y-3">
            {featured.map((deck) => (
              <DeckCard key={deck.id} deck={deck} onSelect={onSelect} buttonLabel={buttonLabel} />
            ))}
          </div>
        </div>
      )}
      {community.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-2">Community</h3>
          <div className="space-y-3">
            {community.map((deck) => (
              <DeckCard key={deck.id} deck={deck} onSelect={onSelect} buttonLabel={buttonLabel} />
            ))}
          </div>
        </div>
      )}
      {filtered.length === 0 && (
        <p className="text-gray-500 text-center py-4">No decks found for this game type.</p>
      )}
      {showCreateLink && (
        <Link
          href="/decks/new"
          className="block bg-gray-900 rounded-xl p-5 border-2 border-dashed border-gray-700 hover:border-purple-500 transition-colors text-center"
        >
          <p className="text-purple-400 font-semibold text-lg mb-1">+ Create Your Own</p>
          <p className="text-gray-500 text-sm">Build a custom card game with your own prompts and answers</p>
        </Link>
      )}
    </div>
  );
}

export default function DeckPicker({ onSelect, buttonLabel, showCreateLink = true, title }: {
  onSelect: (deckId: string) => void;
  buttonLabel?: string;
  showCreateLink?: boolean;
  title?: string;
}) {
  const [decks, setDecks] = useState<DeckSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<GameTypeFilter>("all");

  useEffect(() => {
    fetchDecks()
      .then(setDecks)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      {title && <h2 className="text-lg font-semibold text-gray-300 mb-3 text-center">{title}</h2>}

      <div className="flex justify-center gap-2 mb-4 flex-wrap">
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

      {loading ? (
        <p className="text-gray-400 text-center">Loading games...</p>
      ) : (
        <DeckListInner
          decks={decks}
          filter={filter}
          onSelect={onSelect}
          buttonLabel={buttonLabel}
          showCreateLink={showCreateLink}
        />
      )}
    </div>
  );
}
