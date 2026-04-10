"use client";

import { useState, useEffect, useCallback } from "react";
import { Icon } from "@iconify/react";
import { browseCardLibrary, trackCardLibraryUse, type CardLibraryEntry } from "@/lib/api";

const GAME_TYPES = [
  { id: "", label: "All" },
  { id: "cah", label: "CAH" },
  { id: "joking_hazard", label: "Joking Hazard" },
  { id: "apples_to_apples", label: "Apples to Apples" },
  { id: "superfight", label: "Superfight" },
];

const CARD_TYPES = [
  { id: "", label: "All Cards" },
  { id: "chaos", label: "Prompts" },
  { id: "knowledge", label: "Answers" },
];

interface Props {
  open: boolean;
  onClose: () => void;
  onImport: (cards: { text: string; pick?: number; type: "chaos" | "knowledge" }[]) => void;
  gameType?: string;
}

export default function CardLibraryBrowser({ open, onClose, onImport, gameType: initialGameType }: Props) {
  const [query, setQuery] = useState("");
  const [gameType, setGameType] = useState("");
  const [cardType, setCardType] = useState("");
  const [results, setResults] = useState<CardLibraryEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const search = useCallback(async (p: number = 1) => {
    setLoading(true);
    try {
      const data = await browseCardLibrary({ q: query || undefined, gameType: gameType || undefined, cardType: cardType || undefined, page: p, limit: 50 });
      setResults(data.results);
      setTotal(data.total);
      setPage(data.page);
      setPages(data.pages);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [query, gameType, cardType]);

  useEffect(() => {
    if (open) {
      search(1);
      setSelected(new Set());
    }
  }, [open, search]);

  const toggleCard = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleImport = () => {
    const cards = results
      .filter(r => selected.has(r.id))
      .map(r => ({ text: r.text, pick: r.pick, type: r.cardType }));
    if (cards.length > 0) {
      trackCardLibraryUse(Array.from(selected));
      onImport(cards);
    }
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70" />
      <div
        className="relative bg-gray-900 rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden border border-gray-700"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <div>
            <h2 className="text-lg font-bold text-white">Card Library</h2>
            <p className="text-gray-400 text-xs mt-0.5">
              {total} AI-generated cards — select cards to add to your deck
            </p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors p-1">
            <Icon icon="mdi:close" width={22} />
          </button>
        </div>

        {/* Search + filters */}
        <div className="px-5 py-3 border-b border-gray-800 space-y-2">
          <div className="flex gap-2">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && search(1)}
              placeholder="Search cards..."
              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500"
            />
            <button
              onClick={() => search(1)}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg text-sm font-medium transition-colors"
            >
              Search
            </button>
          </div>
          <div className="flex gap-3">
            <div className="flex flex-wrap gap-1">
              {GAME_TYPES.map((gt) => (
                <button
                  key={gt.id}
                  onClick={() => { setGameType(gt.id); setTimeout(() => search(1), 0); }}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    gameType === gt.id ? "bg-purple-600 text-white" : "bg-gray-800 text-gray-400 hover:text-white"
                  }`}
                >
                  {gt.label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1">
              {CARD_TYPES.map((ct) => (
                <button
                  key={ct.id}
                  onClick={() => { setCardType(ct.id); setTimeout(() => search(1), 0); }}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    cardType === ct.id ? "bg-cyan-600 text-white" : "bg-gray-800 text-gray-400 hover:text-white"
                  }`}
                >
                  {ct.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Card list */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading && results.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-gray-500">
              <Icon icon="mdi:loading" className="animate-spin mr-2" width={20} />
              Loading...
            </div>
          ) : results.length === 0 ? (
            <div className="text-center py-12">
              <Icon icon="mdi:cards-outline" className="text-gray-600 mx-auto mb-2" width={40} />
              <p className="text-gray-500 text-sm">No cards found</p>
              <p className="text-gray-600 text-xs mt-1">Generate cards with AI and they will appear here for reuse</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {results.map((card) => (
                <button
                  key={card.id}
                  onClick={() => toggleCard(card.id)}
                  className={`w-full text-left px-3 py-2.5 rounded-lg border transition-all flex items-start gap-3 ${
                    selected.has(card.id)
                      ? "bg-purple-600/20 border-purple-500"
                      : "bg-gray-800/50 border-gray-700 hover:border-gray-600"
                  }`}
                >
                  <div className={`w-4 h-4 mt-0.5 rounded border-2 flex-shrink-0 flex items-center justify-center ${
                    selected.has(card.id) ? "border-purple-500 bg-purple-600" : "border-gray-600"
                  }`}>
                    {selected.has(card.id) && <Icon icon="mdi:check" className="text-white" width={12} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white">{card.text}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                        card.cardType === "chaos" ? "bg-red-600/20 text-red-400" : "bg-blue-600/20 text-blue-400"
                      }`}>
                        {card.cardType === "chaos" ? "Prompt" : "Answer"}
                      </span>
                      {card.pick > 1 && (
                        <span className="text-[10px] text-gray-500">Pick {card.pick}</span>
                      )}
                      {card.useCount > 0 && (
                        <span className="text-[10px] text-gray-600">Used {card.useCount}x</span>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer — pagination + import */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-gray-800">
          <div className="flex items-center gap-2">
            {pages > 1 && (
              <>
                <button
                  onClick={() => search(page - 1)}
                  disabled={page <= 1}
                  className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 disabled:opacity-30 rounded-lg text-sm transition-colors"
                >
                  Prev
                </button>
                <span className="text-gray-400 text-sm">
                  {page}/{pages}
                </span>
                <button
                  onClick={() => search(page + 1)}
                  disabled={page >= pages}
                  className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 disabled:opacity-30 rounded-lg text-sm transition-colors"
                >
                  Next
                </button>
              </>
            )}
          </div>
          <button
            onClick={handleImport}
            disabled={selected.size === 0}
            className="px-5 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-sm font-semibold transition-colors"
          >
            {selected.size > 0 ? `Import ${selected.size} Card${selected.size !== 1 ? "s" : ""}` : "Select cards to import"}
          </button>
        </div>
      </div>
    </div>
  );
}
