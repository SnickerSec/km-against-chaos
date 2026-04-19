"use client";

import { useEffect, useCallback } from "react";

interface Props {
  text: string;
  onClose: () => void;
}

export default function CardPreview({ text, onClose }: Props) {
  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [handleKey]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-6"
      onClick={onClose}
    >
      <div
        className="bg-gray-800 border-2 border-purple-500 rounded-2xl p-8 max-w-md w-full shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-xl font-medium leading-relaxed text-center">{text}</p>
        <p className="text-gray-400 text-xs text-center mt-4">Tap anywhere to close</p>
      </div>
    </div>
  );
}
