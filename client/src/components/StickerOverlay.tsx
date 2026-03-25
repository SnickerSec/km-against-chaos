"use client";

import { useGameStore } from "@/lib/store";
import { useEffect, useState } from "react";

export default function StickerOverlay() {
  const activeSticker = useGameStore((s) => s.activeSticker);
  const [visible, setVisible] = useState(false);
  const [src, setSrc] = useState("");
  const [sender, setSender] = useState("");

  useEffect(() => {
    if (activeSticker) {
      setSrc(activeSticker.url);
      setSender(activeSticker.playerName);
      setVisible(true);
    } else {
      // fade out
      const t = setTimeout(() => setVisible(false), 300);
      return () => clearTimeout(t);
    }
  }, [activeSticker]);

  if (!src) return null;

  return (
    <div
      className="fixed inset-0 flex items-center justify-center pointer-events-none z-50 transition-opacity duration-300"
      style={{ opacity: activeSticker ? 1 : 0 }}
    >
      <div className="flex flex-col items-center gap-2">
        <img
          src={src}
          alt={sender}
          className="max-w-[240px] max-h-[240px] drop-shadow-2xl"
        />
        <span className="text-white/70 text-sm font-medium bg-black/40 px-2 py-0.5 rounded-full">
          {sender}
        </span>
      </div>
    </div>
  );
}
