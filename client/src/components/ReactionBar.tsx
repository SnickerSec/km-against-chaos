"use client";

import { getSocket } from "@/lib/socket";

const EMOJIS = ["😂", "🔥", "💀", "👏", "😱", "🤮", "❤️", "🧠", "💩", "🖕"];

export default function ReactionBar() {
  const handleReaction = (emoji: string) => {
    const socket = getSocket();
    if (socket.connected) {
      socket.emit("reaction:send", emoji);
    }
  };

  return (
    <div className="flex gap-1 justify-center py-2">
      {EMOJIS.map((emoji) => (
        <button
          key={emoji}
          onClick={() => handleReaction(emoji)}
          className="w-10 h-10 text-xl rounded-lg bg-gray-800 hover:bg-gray-700 active:scale-90 transition-all"
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}
