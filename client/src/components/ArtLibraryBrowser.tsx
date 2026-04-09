"use client";

import { useState, useEffect, useCallback } from "react";
import { Icon } from "@iconify/react";
import { browseArtLibrary, artLibraryThumbUrl, artLibraryImageUrl, trackArtUse, type ArtLibraryEntry } from "@/lib/api";

const GAME_TYPES = [
  { id: "", label: "All" },
  { id: "cah", label: "CAH" },
  { id: "joking_hazard", label: "Joking Hazard" },
  { id: "apples_to_apples", label: "Apples to Apples" },
  { id: "superfight", label: "Superfight" },
  { id: "codenames", label: "Codenames" },
];

interface Props {
  open: boolean;
  onClose: () => void;
  onSelect: (imageUrl: string, artId: string) => void;
  gameType?: string;
}

export default function ArtLibraryBrowser({ open, onClose, onSelect, gameType: initialGameType }: Props) {
  const [query, setQuery] = useState("");
  const [gameType, setGameType] = useState(initialGameType || "");
  const [results, setResults] = useState<ArtLibraryEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const search = useCallback(async (p: number = 1) => {
    setLoading(true);
    try {
      const data = await browseArtLibrary({ q: query || undefined, gameType: gameType || undefined, page: p, limit: 24 });
      setResults(data.results);
      setTotal(data.total);
      setPage(data.page);
      setPages(data.pages);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [query, gameType]);

  useEffect(() => {
    if (open) {
      search(1);
    }
  }, [open, search]);

  const handleSelect = (entry: ArtLibraryEntry) => {
    setSelected(entry.id);
    trackArtUse(entry.id);
    onSelect(artLibraryImageUrl(entry.id), entry.id);
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70" />
      <div
        className="relative bg-gray-900 rounded-2xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden border border-gray-700"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <div>
            <h2 className="text-lg font-bold text-white">Art Library</h2>
            <p className="text-gray-400 text-xs mt-0.5">
              {total} community art pieces — select one for your card
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
              placeholder="Search by keyword..."
              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500"
            />
            <button
              onClick={() => search(1)}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg text-sm font-medium transition-colors"
            >
              Search
            </button>
          </div>
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
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading && results.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-gray-500">
              <Icon icon="mdi:loading" className="animate-spin mr-2" width={20} />
              Loading...
            </div>
          ) : results.length === 0 ? (
            <div className="text-center py-12">
              <Icon icon="mdi:image-off-outline" className="text-gray-600 mx-auto mb-2" width={40} />
              <p className="text-gray-500 text-sm">No art found</p>
              <p className="text-gray-600 text-xs mt-1">Generate art for your cards and it will appear here for everyone</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
              {results.map((entry) => (
                <button
                  key={entry.id}
                  onClick={() => handleSelect(entry)}
                  className={`group relative rounded-lg overflow-hidden border-2 transition-all hover:scale-105 ${
                    selected === entry.id ? "border-purple-500 ring-2 ring-purple-500/50" : "border-gray-700 hover:border-gray-500"
                  }`}
                >
                  <img
                    src={artLibraryThumbUrl(entry.id)}
                    alt={entry.sourceCardText || "Card art"}
                    loading="lazy"
                    className="w-full aspect-[5/7] object-cover bg-gray-800"
                  />
                  {/* Hover overlay */}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/60 transition-colors flex items-end">
                    <div className="p-1.5 opacity-0 group-hover:opacity-100 transition-opacity w-full">
                      <p className="text-white text-[10px] leading-tight line-clamp-2">
                        {entry.sourceCardText || entry.prompt.slice(0, 60)}
                      </p>
                    </div>
                  </div>
                  {entry.useCount > 0 && (
                    <span className="absolute top-1 right-1 text-[9px] bg-black/60 text-gray-300 px-1 rounded">
                      {entry.useCount}x
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Pagination */}
        {pages > 1 && (
          <div className="flex items-center justify-center gap-2 px-5 py-3 border-t border-gray-800">
            <button
              onClick={() => search(page - 1)}
              disabled={page <= 1}
              className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 disabled:opacity-30 rounded-lg text-sm transition-colors"
            >
              Prev
            </button>
            <span className="text-gray-400 text-sm">
              Page {page} of {pages}
            </span>
            <button
              onClick={() => search(page + 1)}
              disabled={page >= pages}
              className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 disabled:opacity-30 rounded-lg text-sm transition-colors"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
