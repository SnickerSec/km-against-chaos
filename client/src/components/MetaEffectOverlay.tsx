"use client";

import { useGameStore } from "@/lib/store";
import { Icon } from "@iconify/react";

const EFFECT_ICONS: Record<string, string> = {
  score_add: "mdi:plus-circle",
  score_subtract: "mdi:minus-circle",
  hide_cards: "mdi:eye-off",
  randomize_icons: "mdi:shuffle-variant",
  hand_reset: "mdi:refresh",
};

const EFFECT_COLORS: Record<string, string> = {
  score_add: "text-green-400 border-green-500/60 bg-green-900/40",
  score_subtract: "text-red-400 border-red-500/60 bg-red-900/40",
  hide_cards: "text-yellow-400 border-yellow-500/60 bg-yellow-900/40",
  randomize_icons: "text-cyan-400 border-cyan-500/60 bg-cyan-900/40",
  hand_reset: "text-purple-400 border-purple-500/60 bg-purple-900/40",
};

export default function MetaEffectOverlay() {
  const activeMetaEffect = useGameStore((s) => s.activeMetaEffect);

  if (!activeMetaEffect) return null;

  const icon = EFFECT_ICONS[activeMetaEffect.effectType] || "mdi:lightning-bolt";
  const colorClass = EFFECT_COLORS[activeMetaEffect.effectType] || "text-orange-400 border-orange-500/60 bg-orange-900/40";

  return (
    <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 pointer-events-none animate-bounce-in">
      <div className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border backdrop-blur-sm shadow-lg ${colorClass}`}>
        <Icon icon="mdi:lightning-bolt" width={16} className="shrink-0" />
        <span className="text-sm font-bold uppercase tracking-wide mr-1">CHAOS!</span>
        <Icon icon={icon} width={16} className="shrink-0" />
        <span className="text-sm font-medium">{activeMetaEffect.description}</span>
      </div>
    </div>
  );
}
