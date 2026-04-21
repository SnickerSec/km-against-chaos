"use client";

import { create } from "zustand";

export type Suit = "S" | "H" | "D" | "C" | "?";
export type Rank = "A" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K" | "?";
export interface Card { suit: Suit; rank: Rank }

export type BlackjackPhase = "betting" | "dealing" | "playing" | "dealer" | "settle" | "gameOver";

export interface Hand {
  cards: Card[];
  bet: number;
  doubled: boolean;
  resolved: boolean;
  fromSplit: boolean;
  surrendered?: boolean;
}

export interface Settlement {
  playerId: string;
  handIndex: number;
  outcome: "win" | "lose" | "push" | "blackjack" | "surrender";
  delta: number;
}

export interface BlackjackView {
  gameType: "blackjack";
  phase: BlackjackPhase;
  chips: Record<string, number>;
  bets: Record<string, number | "sitting_out" | null>;
  hands: Record<string, Hand[]>;
  dealerHand: Card[];
  playerIds: string[];
  config: { startingChips: number; minBet: number; maxBet: number };
  activePlayerId: string | null;
  activeHandIndex: number;
  roundNumber: number;
  phaseDeadline: number;
  shoeRemaining: number;
  lastSettlement?: Settlement[];
}

interface BlackjackStore {
  view: BlackjackView | null;
  setView: (v: BlackjackView | null) => void;
}

export const useBlackjackStore = create<BlackjackStore>((set) => ({
  view: null,
  setView: (view) => set({ view }),
}));
