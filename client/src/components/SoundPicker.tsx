"use client";

import { useState, useEffect, useRef } from "react";
import { Icon } from "@iconify/react";
import { searchSounds, fetchSavedSounds, saveSound, deleteSound, SavedSound } from "@/lib/api";
import { useAuthStore } from "@/lib/auth";

interface Props {
  onPlay: (mp3: string, title: string) => void;
  onClose: () => void;
}

export default function SoundPicker({ onPlay, onClose }: Props) {
  const { user } = useAuthStore();
  const [tab, setTab] = useState<"search" | "saved">("saved");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ title: string; mp3: string }[]>([]);
  const [saved, setSaved] = useState<SavedSound[]>([]);
  const [searching, setSearching] = useState(false);
  const [loadingSaved, setLoadingSaved] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [previewAudio, setPreviewAudio] = useState<HTMLAudioElement | null>(null);
  const [playingUrl, setPlayingUrl] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (tab === "saved" && user) loadSaved();
    if (tab === "search") setTimeout(() => inputRef.current?.focus(), 50);
  }, [tab, user]);

  async function loadSaved() {
    setLoadingSaved(true);
    try {
      setSaved(await fetchSavedSounds());
    } catch {}
    setLoadingSaved(false);
  }

  async function doSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setResults([]);
    try {
      const data = await searchSounds(query.trim());
      setResults(data.results);
    } catch {}
    setSearching(false);
  }

  function preview(mp3: string) {
    if (previewAudio) { previewAudio.pause(); previewAudio.currentTime = 0; }
    if (playingUrl === mp3) { setPlayingUrl(null); return; }
    const audio = new Audio(mp3);
    audio.volume = 0.7;
    audio.play().catch(() => {});
    audio.onended = () => setPlayingUrl(null);
    setPreviewAudio(audio);
    setPlayingUrl(mp3);
  }

  async function handleSave(title: string, mp3: string) {
    if (!user) return;
    setSavingId(mp3);
    try {
      const s = await saveSound(title, mp3);
      setSaved((prev) => [s, ...prev]);
    } catch {}
    setSavingId(null);
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      await deleteSound(id);
      setSaved((prev) => prev.filter((s) => s.id !== id));
    } catch {}
    setDeletingId(null);
  }

  function handlePlay(mp3: string, title: string) {
    if (previewAudio) { previewAudio.pause(); }
    setPlayingUrl(null);
    onPlay(mp3, title);
    onClose();
  }

  const savedMp3s = new Set(saved.map((s) => s.mp3));

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-end sm:items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-md flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-4 pb-2 border-b border-gray-800">
          <h2 className="font-bold text-white flex items-center gap-2">
            <Icon icon="mdi:music-note" className="text-purple-400" />
            Play a Sound
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
            <Icon icon="mdi:close" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-800">
          <button
            onClick={() => setTab("saved")}
            className={`flex-1 py-2 text-sm font-medium transition-colors ${tab === "saved" ? "text-white border-b-2 border-purple-500" : "text-gray-500 hover:text-gray-300"}`}
          >
            Saved
          </button>
          <button
            onClick={() => setTab("search")}
            className={`flex-1 py-2 text-sm font-medium transition-colors ${tab === "search" ? "text-white border-b-2 border-purple-500" : "text-gray-500 hover:text-gray-300"}`}
          >
            Search MyInstants
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {tab === "search" && (
            <div className="p-3">
              <form onSubmit={doSearch} className="flex gap-2 mb-3">
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search sounds..."
                  className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-purple-500"
                />
                <button
                  type="submit"
                  disabled={searching}
                  className="px-3 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  {searching ? <Icon icon="mdi:loading" className="animate-spin" /> : <Icon icon="mdi:magnify" />}
                </button>
              </form>

              {results.length === 0 && !searching && query && (
                <p className="text-center text-gray-500 text-sm py-4">No results found</p>
              )}

              <div className="space-y-1">
                {results.map((r) => {
                  const alreadySaved = savedMp3s.has(r.mp3);
                  return (
                    <div key={r.mp3} className="flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-gray-800 transition-colors">
                      <button
                        onClick={() => preview(r.mp3)}
                        className="text-gray-400 hover:text-white transition-colors shrink-0"
                        title="Preview"
                      >
                        <Icon icon={playingUrl === r.mp3 ? "mdi:stop" : "mdi:play"} />
                      </button>
                      <span className="flex-1 text-sm text-gray-200 truncate">{r.title}</span>
                      {user && !alreadySaved && (
                        <button
                          onClick={() => handleSave(r.title, r.mp3)}
                          disabled={savingId === r.mp3}
                          className="text-gray-500 hover:text-yellow-400 transition-colors shrink-0"
                          title="Save"
                        >
                          {savingId === r.mp3
                            ? <Icon icon="mdi:loading" className="animate-spin" />
                            : <Icon icon="mdi:bookmark-outline" />}
                        </button>
                      )}
                      {alreadySaved && <Icon icon="mdi:bookmark" className="text-yellow-400 shrink-0" />}
                      <button
                        onClick={() => handlePlay(r.mp3, r.title)}
                        className="px-2 py-1 bg-green-700 hover:bg-green-600 text-white rounded text-xs font-medium transition-colors shrink-0"
                      >
                        Play
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {tab === "saved" && (
            <div className="p-3">
              {!user && (
                <p className="text-center text-gray-500 text-sm py-6">Sign in to save sounds</p>
              )}
              {user && loadingSaved && (
                <div className="flex justify-center py-6">
                  <Icon icon="mdi:loading" className="animate-spin text-gray-400 text-xl" />
                </div>
              )}
              {user && !loadingSaved && saved.length === 0 && (
                <p className="text-center text-gray-500 text-sm py-6">No saved sounds yet — search to find some!</p>
              )}
              {user && !loadingSaved && saved.length > 0 && (
                <div className="space-y-1">
                  {saved.map((s) => (
                    <div key={s.id} className="flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-gray-800 transition-colors">
                      <button
                        onClick={() => preview(s.mp3)}
                        className="text-gray-400 hover:text-white transition-colors shrink-0"
                        title="Preview"
                      >
                        <Icon icon={playingUrl === s.mp3 ? "mdi:stop" : "mdi:play"} />
                      </button>
                      <span className="flex-1 text-sm text-gray-200 truncate">{s.title}</span>
                      <button
                        onClick={() => handleDelete(s.id)}
                        disabled={deletingId === s.id}
                        className="text-gray-600 hover:text-red-400 transition-colors shrink-0"
                        title="Remove"
                      >
                        {deletingId === s.id
                          ? <Icon icon="mdi:loading" className="animate-spin" />
                          : <Icon icon="mdi:delete-outline" />}
                      </button>
                      <button
                        onClick={() => handlePlay(s.mp3, s.title)}
                        className="px-2 py-1 bg-green-700 hover:bg-green-600 text-white rounded text-xs font-medium transition-colors shrink-0"
                      >
                        Play
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="px-4 py-2 border-t border-gray-800 text-center">
          <p className="text-xs text-gray-600">Sounds play for everyone in the lobby</p>
        </div>
      </div>
    </div>
  );
}
