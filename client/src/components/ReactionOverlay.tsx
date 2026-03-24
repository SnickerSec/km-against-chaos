"use client";

import { useEffect, useState, useCallback } from "react";
import { getSocket } from "@/lib/socket";

interface FloatingEmoji {
  id: number;
  emoji: string;
  playerName: string;
  x: number;
}

let nextId = 0;

export default function ReactionOverlay() {
  const [emojis, setEmojis] = useState<FloatingEmoji[]>([]);

  const addEmoji = useCallback((emoji: string, playerName: string) => {
    const id = nextId++;
    const x = 10 + Math.random() * 80; // random horizontal position (10-90%)

    setEmojis((prev) => [...prev, { id, emoji, playerName, x }]);

    // Remove after animation completes
    setTimeout(() => {
      setEmojis((prev) => prev.filter((e) => e.id !== id));
    }, 2500);
  }, []);

  useEffect(() => {
    const socket = getSocket();

    const handler = (emoji: string, playerName: string) => {
      addEmoji(emoji, playerName);
    };

    socket.on("reaction:broadcast", handler);
    return () => {
      socket.off("reaction:broadcast", handler);
    };
  }, [addEmoji]);

  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden z-50">
      {emojis.map((e) => (
        <div
          key={e.id}
          className="absolute animate-float-up"
          style={{ left: `${e.x}%`, bottom: "10%" }}
        >
          <div className="flex flex-col items-center">
            <span className="text-4xl">{e.emoji}</span>
            <span className="text-xs text-white/60 mt-0.5 whitespace-nowrap">
              {e.playerName}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
