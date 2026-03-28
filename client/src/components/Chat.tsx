"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Icon } from "@iconify/react";
import { useGameStore } from "@/lib/store";
import { useSocket } from "@/lib/useSocket";
import { API_URL } from "@/lib/api";

const NAME_COLORS = [
  "text-purple-400",
  "text-green-400",
  "text-blue-400",
  "text-yellow-400",
  "text-pink-400",
  "text-cyan-400",
  "text-orange-400",
  "text-emerald-400",
  "text-rose-400",
  "text-indigo-400",
];

function nameToColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return NAME_COLORS[Math.abs(hash) % NAME_COLORS.length];
}

interface MediaResult {
  id: string;
  url: string;
  previewUrl: string;
  description: string;
}

export default function Chat() {
  const { chatMessages, chatOpen, unreadCount, setChatOpen } = useGameStore();
  const { sendChat, sendGif, sendSticker } = useSocket();
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // GIF/Sticker picker state
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerTab, setPickerTab] = useState<"gif" | "sticker">("gif");
  const [pickerQuery, setPickerQuery] = useState("");
  const [pickerResults, setPickerResults] = useState<MediaResult[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);

  const fetchMedia = useCallback(async (query: string, tab: "gif" | "sticker") => {
    setPickerLoading(true);
    try {
      const params = new URLSearchParams({ q: query, type: tab });
      const res = await fetch(`${API_URL}/api/gifs/find?${params}`);
      if (!res.ok) { setPickerResults([]); return; }
      const data = await res.json();
      setPickerResults(data.results || []);
    } catch {
      setPickerResults([]);
    } finally {
      setPickerLoading(false);
    }
  }, []);

  // Debounce search when pickerQuery changes
  useEffect(() => {
    if (!pickerOpen) return;
    const timer = setTimeout(() => {
      fetchMedia(pickerQuery, pickerTab);
    }, 300);
    return () => clearTimeout(timer);
  }, [pickerQuery, pickerTab, pickerOpen, fetchMedia]);

  // Re-fetch when picker opens or tab changes (with empty debounce)
  useEffect(() => {
    if (!pickerOpen) return;
    fetchMedia(pickerQuery, pickerTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickerOpen, pickerTab]);

  useEffect(() => {
    if (chatOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [chatMessages, chatOpen]);

  // '/' keyboard shortcut to open chat and focus input
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        e.preventDefault();
        setChatOpen(true);
        setTimeout(() => inputRef.current?.focus(), 0);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setChatOpen]);

  const handleSend = () => {
    const text = input.trim();
    if (!text) return;
    sendChat(text);
    setInput("");
  };

  if (!chatOpen) {
    return (
      <div className="fixed bottom-4 right-4 z-40">
        <button
          onClick={() => setChatOpen(true)}
          className="w-12 h-12 bg-purple-600 hover:bg-purple-700 rounded-full flex items-center justify-center shadow-lg transition-colors relative"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs w-5 h-5 rounded-full flex items-center justify-center font-bold">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>
      </div>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-40 w-80 h-96 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-700">
        <span className="font-semibold text-sm">Chat</span>
        <button
          onClick={() => setChatOpen(false)}
          className="text-gray-400 hover:text-white"
        >
          <Icon icon="mdi:close" width={20} />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5">
        {chatMessages.length === 0 && (
          <p className="text-gray-600 text-xs text-center mt-8">No messages yet</p>
        )}
        {chatMessages.map((msg) => (
          <div key={msg.id} className="text-sm">
            <span className={`font-semibold ${nameToColor(msg.playerName)}`}>{msg.playerName}</span>{" "}
            {msg.gifUrl ? (
              <img
                src={msg.gifUrl}
                alt={msg.playerName}
                className="max-w-full rounded-lg mt-1"
                style={{ maxHeight: "150px" }}
              />
            ) : (
              <span className="text-gray-300">{msg.text}</span>
            )}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="px-3 py-2 border-t border-gray-700">
        {/* GIF Picker */}
        {pickerOpen && (
          <div className="mb-2 bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
            {/* Tabs */}
            <div className="flex border-b border-gray-700">
              <button
                onClick={() => setPickerTab("gif")}
                className={`flex-1 py-1.5 text-xs font-semibold transition-colors ${pickerTab === "gif" ? "text-purple-400 border-b-2 border-purple-500" : "text-gray-500 hover:text-gray-300"}`}
              >
                GIFs
              </button>
              <button
                onClick={() => setPickerTab("sticker")}
                className={`flex-1 py-1.5 text-xs font-semibold transition-colors ${pickerTab === "sticker" ? "text-cyan-400 border-b-2 border-cyan-500" : "text-gray-500 hover:text-gray-300"}`}
              >
                Stickers
              </button>
            </div>
            {/* Search */}
            <div className="px-2 py-1.5">
              <input
                type="text"
                value={pickerQuery}
                onChange={(e) => setPickerQuery(e.target.value)}
                placeholder="Search..."
                className="w-full px-2 py-1 bg-gray-900 border border-gray-700 rounded text-white placeholder-gray-600 focus:outline-none focus:border-purple-500 text-xs"
              />
            </div>
            {/* Results grid */}
            <div className="h-40 overflow-y-auto px-2 pb-2">
              {pickerLoading ? (
                <p className="text-gray-500 text-xs text-center py-4">Loading...</p>
              ) : pickerResults.length === 0 ? (
                <p className="text-gray-600 text-xs text-center py-4">No results</p>
              ) : (
                <div className="grid grid-cols-4 gap-1">
                  {pickerResults.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => {
                        if (pickerTab === "gif") {
                          sendGif(item.url);
                        } else {
                          sendSticker(item.url);
                        }
                        setPickerOpen(false);
                        setPickerQuery("");
                      }}
                      className="aspect-square rounded overflow-hidden bg-gray-900 hover:ring-2 hover:ring-purple-500 transition-all"
                    >
                      <img
                        src={item.previewUrl}
                        alt={item.description}
                        className="w-full h-full object-cover"
                      />
                    </button>
                  ))}
                </div>
              )}
            </div>
            {/* Powered by Klipy */}
            <div className="px-2 pb-1.5 flex justify-end">
              <span className="text-gray-600 text-[10px]">Powered by Klipy</span>
            </div>
          </div>
        )}
        {/* Input row */}
        <div className="flex gap-2">
          <button
            onClick={() => setPickerOpen(!pickerOpen)}
            className={`p-1.5 rounded-lg border transition-colors ${pickerOpen ? "bg-purple-600 border-purple-500 text-white" : "bg-gray-800 border-gray-700 text-gray-400 hover:text-white"}`}
          >
            <Icon icon="mdi:gif" width={20} />
          </button>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            placeholder="Type a message..."
            maxLength={200}
            className="flex-1 px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-purple-500 text-sm"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim()}
            className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 disabled:text-gray-500 rounded-lg text-sm font-semibold transition-colors"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
