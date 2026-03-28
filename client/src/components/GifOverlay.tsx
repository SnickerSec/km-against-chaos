"use client";

import { useGameStore } from "@/lib/store";
import { useEffect, useState } from "react";

export default function GifOverlay() {
  const activeGif = useGameStore((s) => s.activeGif);
  const setActiveGif = useGameStore((s) => s.setActiveGif);
  const [visible, setVisible] = useState(false);
  const [src, setSrc] = useState("");
  const [sender, setSender] = useState("");

  useEffect(() => {
    if (activeGif) {
      setSrc(activeGif.url);
      setSender(activeGif.playerName);
      setVisible(true);
      const t = setTimeout(() => setActiveGif(null), 3000);
      return () => clearTimeout(t);
    } else {
      const t = setTimeout(() => setVisible(false), 300);
      return () => clearTimeout(t);
    }
  }, [activeGif, setActiveGif]);

  if (!src) return null;

  return (
    <div
      className="fixed inset-0 flex items-center justify-center pointer-events-none z-50 transition-opacity duration-300"
      style={{ opacity: activeGif ? 1 : 0 }}
    >
      <div className="flex flex-col items-center gap-2">
        <img
          src={src}
          alt={sender}
          className="max-w-[300px] max-h-[300px] rounded-lg drop-shadow-2xl"
        />
        <span className="text-white/70 text-sm font-medium bg-black/40 px-2 py-0.5 rounded-full">
          {sender}
        </span>
      </div>
    </div>
  );
}
