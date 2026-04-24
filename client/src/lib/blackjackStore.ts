"use client";

import { create } from "zustand";

export type Suit = "S" | "H" | "D" | "C" | "?";
export type Rank = "A" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K" | "?";
export interface Card { suit: Suit; rank: Rank }

export type BlackjackPhase = "betting" | "dealing" | "insurance" | "playing" | "dealer" | "settle" | "gameOver";

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

export interface InsuranceSettlement {
  playerId: string;
  amount: number;
  outcome: "won" | "lost" | "declined";
  delta: number;
}

export interface SideBets {
  perfectPairs: number;
  twentyOnePlusThree: number;
}

export type PerfectPairsOutcome = "none" | "mixed" | "colored" | "perfect";
export type TwentyOnePlusThreeOutcome =
  | "none" | "flush" | "straight" | "trips" | "straight_flush" | "suited_trips";

export interface SideBetSettlement {
  playerId: string;
  perfectPairs: { stake: number; outcome: PerfectPairsOutcome; delta: number };
  twentyOnePlusThree: { stake: number; outcome: TwentyOnePlusThreeOutcome; delta: number };
}

export interface BlackjackView {
  gameType: "blackjack";
  phase: BlackjackPhase;
  chips: Record<string, number>;
  bets: Record<string, number | "sitting_out" | null>;
  sideBets: Record<string, SideBets>;
  hands: Record<string, Hand[]>;
  dealerHand: Card[];
  playerIds: string[];
  names: Record<string, string>;
  config: { startingChips: number; minBet: number; maxBet: number };
  activePlayerId: string | null;
  activeHandIndex: number;
  roundNumber: number;
  phaseDeadline: number;
  shoeRemaining: number;
  lastSettlement?: Settlement[];
  sideBetSettlement?: SideBetSettlement[];
  insuranceDecisions?: Record<string, "insured" | "declined" | null>;
  insuranceSettlement?: InsuranceSettlement[];
}

interface BlackjackStore {
  view: BlackjackView | null;
  setView: (v: BlackjackView | null) => void;
}

export const useBlackjackStore = create<BlackjackStore>((set) => ({
  view: null,
  setView: (view) => set({ view }),
}));
