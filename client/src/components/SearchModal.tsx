"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@iconify/react";
import { fetchDecks, DeckSummary } from "@/lib/api";
import GameTypeBadge from "./GameTypeBadge";

export default function SearchModal() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DeckSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();

  // Listen for '/' key to open
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't trigger when typing in an input/textarea/select
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((e.target as HTMLElement)?.isContentEditable) return;

      if (e.key === "/") {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Focus input when modal opens
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setQuery("");
      setResults([]);
      setSelectedIdx(0);
    }
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  const search = useCallback((q: string) => {
    if (!q.trim()) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    fetchDecks({ search: q, sort: "popular" })
      .then((decks) => {
        setResults(decks.slice(0, 8));
        setSelectedIdx(0);
      })
      .catch(() => setResults([]))
      .finally(() => setLoading(false));
  }, []);

  const handleInput = (val: string) => {
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(val), 250);
  };

  const selectDeck = (deck: DeckSummary) => {
    setOpen(false);
    router.push(`/?deck=${deck.id}`);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && results[selectedIdx]) {
      e.preventDefault();
      selectDeck(results[selectedIdx]);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => setOpen(false)}
      />

      {/* Modal */}
      <div className="relative w-full max-w-lg mx-4 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl overflow-hidden">
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-800">
          <Icon icon="mdi:magnify" className="text-gray-500 shrink-0" width={20} />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search decks, creators..."
            value={query}
            onChange={(e) => handleInput(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 bg-transparent text-white placeholder-gray-500 focus:outline-none text-sm"
          />
          <kbd className="hidden sm:inline-block px-1.5 py-0.5 bg-gray-800 border border-gray-700 rounded text-[10px] text-gray-500 font-mono">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-[50vh] overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center py-6">
              <Icon icon="mdi:loading" className="text-purple-400 animate-spin" width={20} />
            </div>
          )}

          {!loading && query && results.length === 0 && (
            <div className="py-6 text-center text-gray-500 text-sm">
              No decks found for &ldquo;{query}&rdquo;
            </div>
          )}

          {!loading && results.length > 0 && (
            <div className="py-1">
              {results.map((deck, i) => (
                <button
                  key={deck.id}
                  onClick={() => selectDeck(deck)}
                  onMouseEnter={() => setSelectedIdx(i)}
                  className={`w-full text-left px-4 py-3 flex items-center gap-3 transition-colors ${
                    i === selectedIdx ? "bg-gray-800" : "hover:bg-gray-800/50"
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="font-medium text-white text-sm truncate">{deck.name}</span>
                      {deck.builtIn && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-600/30 text-purple-300">
                          Featured
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <GameTypeBadge gameType={deck.gameType} />
                      {deck.ownerName && <span>by {deck.ownerName}</span>}
                      {(deck.playCount || 0) > 0 && (
                        <span>{deck.playCount} plays</span>
                      )}
                      {(deck.avgRating || 0) > 0 && (
                        <span className="flex items-center gap-0.5">
                          <span className="text-yellow-400">&#9733;</span>
                          {(deck.avgRating || 0).toFixed(1)}
                        </span>
                      )}
                    </div>
                  </div>
                  <Icon icon="mdi:arrow-right" className="text-gray-600 shrink-0" width={16} />
                </button>
              ))}
            </div>
          )}

          {!loading && !query && (
            <div className="py-6 text-center text-gray-600 text-sm">
              Type to search by deck name, description, or creator
            </div>
          )}
        </div>

        {/* Footer hint */}
        <div className="px-4 py-2 border-t border-gray-800 flex items-center gap-4 text-[10px] text-gray-600">
          <span className="flex items-center gap-1">
            <kbd className="px-1 bg-gray-800 border border-gray-700 rounded font-mono">&uarr;</kbd>
            <kbd className="px-1 bg-gray-800 border border-gray-700 rounded font-mono">&darr;</kbd>
            navigate
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1 bg-gray-800 border border-gray-700 rounded font-mono">Enter</kbd>
            select
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1 bg-gray-800 border border-gray-700 rounded font-mono">Esc</kbd>
            close
          </span>
        </div>
      </div>
    </div>
  );
}
