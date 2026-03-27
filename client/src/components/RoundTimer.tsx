"use client";

import { useState, useEffect } from "react";

export default function RoundTimer({ deadline }: { deadline: number }) {
  const [secondsLeft, setSecondsLeft] = useState(() =>
    Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
  );

  useEffect(() => {
    setSecondsLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (remaining <= 0) clearInterval(interval);
    }, 1000);
    return () => clearInterval(interval);
  }, [deadline]);

  const urgent = secondsLeft <= 10;

  return (
    <span
      className={`font-mono text-sm font-semibold tabular-nums ${
        urgent ? "text-red-400 animate-pulse" : "text-gray-400"
      }`}
    >
      {secondsLeft}s
    </span>
  );
}
