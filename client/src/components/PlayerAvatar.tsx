"use client";

const AVATAR_COLORS = [
  "bg-red-500", "bg-orange-500", "bg-amber-500", "bg-yellow-500",
  "bg-lime-500", "bg-green-500", "bg-emerald-500", "bg-teal-500",
  "bg-cyan-500", "bg-sky-500", "bg-blue-500", "bg-indigo-500",
  "bg-violet-500", "bg-purple-500", "bg-fuchsia-500", "bg-pink-500",
];

function hashName(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = ((h << 5) - h + name.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export default function PlayerAvatar({
  name,
  isBot,
  size = "sm",
}: {
  name: string;
  isBot?: boolean;
  size?: "sm" | "md" | "lg";
}) {
  const color = AVATAR_COLORS[hashName(name) % AVATAR_COLORS.length];
  const initial = name.charAt(0).toUpperCase();
  const sizeClasses = {
    sm: "w-6 h-6 text-xs",
    md: "w-8 h-8 text-sm",
    lg: "w-10 h-10 text-base",
  };

  return (
    <span
      className={`${sizeClasses[size]} ${color} rounded-full inline-flex items-center justify-center font-bold text-white shrink-0`}
    >
      {isBot ? (
        <svg className="w-3/5 h-3/5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 2a2 2 0 012 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 017 7h1a1 1 0 110 2h-1v1a3 3 0 01-3 3H7a3 3 0 01-3-3v-1H3a1 1 0 110-2h1a7 7 0 017-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 012-2zm-3 12a1.5 1.5 0 100 3 1.5 1.5 0 000-3zm6 0a1.5 1.5 0 100 3 1.5 1.5 0 000-3z"/>
        </svg>
      ) : (
        initial
      )}
    </span>
  );
}
