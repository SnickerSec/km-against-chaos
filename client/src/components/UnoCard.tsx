"use client";

import { Icon } from "@iconify/react";
import { UnoCard as UnoCardType } from "@/lib/store";

const COLOR_MAP: Record<string, { bg: string; border: string; text: string }> = {
  red:    { bg: "bg-red-600",    border: "border-red-500",    text: "text-red-100" },
  blue:   { bg: "bg-blue-600",   border: "border-blue-500",   text: "text-blue-100" },
  green:  { bg: "bg-green-600",  border: "border-green-500",  text: "text-green-100" },
  yellow: { bg: "bg-yellow-500", border: "border-yellow-400", text: "text-yellow-900" },
  wild:   { bg: "bg-gray-800",   border: "border-purple-500", text: "text-white" },
};

const TYPE_ICONS: Record<string, string> = {
  skip: "mdi:block-helper",
  reverse: "mdi:swap-horizontal",
  wild: "mdi:palette",
};

export default function UnoCard({
  card,
  playable,
  selected,
  small,
  onClick,
  onDoubleClick,
}: {
  card: UnoCardType;
  playable?: boolean;
  selected?: boolean;
  small?: boolean;
  onClick?: () => void;
  onDoubleClick?: () => void;
}) {
  const colorKey = card.color || "wild";
  const colors = COLOR_MAP[colorKey] || COLOR_MAP.wild;
  const icon = TYPE_ICONS[card.type];
  const symbol = card.type === "number" ? String(card.value)
    : card.type === "draw_two" ? "+2"
    : card.type === "wild_draw_four" ? "+4"
    : null;

  return (
    <button
      type="button"
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      disabled={playable === false}
      className={`
        relative flex flex-col items-center justify-center rounded-xl border-2 transition-all
        ${colors.bg} ${colors.border} ${colors.text}
        ${small ? "w-14 h-20 text-xs" : "w-20 h-28 text-sm"}
        ${playable === false ? "opacity-40 cursor-not-allowed" : "cursor-pointer hover:scale-105 hover:-translate-y-1"}
        ${selected ? "ring-2 ring-white ring-offset-2 ring-offset-gray-900 -translate-y-2 scale-105" : ""}
      `}
    >
      {icon ? (
        <Icon icon={icon} className={small ? "text-xl" : "text-3xl"} />
      ) : (
        <span className={`font-bold ${small ? "text-lg" : "text-2xl"} leading-none`}>{symbol}</span>
      )}
      {card.colorLabel && (
        <span className={`${small ? "text-[9px]" : "text-[10px]"} opacity-80 mt-1 truncate max-w-full px-1`}>
          {card.colorLabel}
        </span>
      )}
      {(card.type === "wild" || card.type === "wild_draw_four") && (
        <span className={`${small ? "text-[9px]" : "text-[10px]"} opacity-80 mt-0.5`}>{card.text}</span>
      )}
    </button>
  );
}
