"use client";

import { create } from "zustand";

export interface PlayerInfo {
  id: string;
  name: string;
  isHost: boolean;
  score: number;
}

export interface LobbyState {
  code: string;
  players: PlayerInfo[];
  hostId: string;
  deckId: string;
  deckName: string;
  status: "waiting" | "playing" | "finished";
}

export interface KnowledgeCard {
  id: string;
  text: string;
}

export interface ChaosCard {
  id: string;
  text: string;
  pick: number;
}

export interface Submission {
  playerId: string;
  cards: KnowledgeCard[];
}

export interface RoundState {
  roundNumber: number;
  czarId: string;
  chaosCard: ChaosCard;
  phase: "submitting" | "judging" | "revealing";
  submissions: Submission[];
  winnerId: string | null;
}

export interface PlayerGameView {
  hand: KnowledgeCard[];
  round: RoundState | null;
  scores: Record<string, number>;
  roundNumber: number;
  maxRounds: number;
  gameOver: boolean;
  hasSubmitted: boolean;
}

export type Screen = "home" | "lobby" | "game" | "gameover";

interface GameStore {
  // Connection
  playerName: string;
  connected: boolean;
  error: string | null;

  // Lobby
  lobby: LobbyState | null;

  // Game
  screen: Screen;
  hand: KnowledgeCard[];
  round: RoundState | null;
  scores: Record<string, number>;
  roundNumber: number;
  maxRounds: number;
  hasSubmitted: boolean;
  submittedPlayers: Set<string>;
  selectedCards: string[];
  winnerInfo: { winnerId: string; winnerName: string; cards: KnowledgeCard[] } | null;

  // Actions
  setPlayerName: (name: string) => void;
  setLobby: (lobby: LobbyState | null) => void;
  setConnected: (connected: boolean) => void;
  setError: (error: string | null) => void;
  setScreen: (screen: Screen) => void;
  setGameView: (view: PlayerGameView) => void;
  setRoundPhase: (phase: "submitting" | "judging" | "revealing") => void;
  setSubmissions: (submissions: Submission[]) => void;
  addSubmittedPlayer: (playerId: string) => void;
  toggleCardSelection: (cardId: string, maxPick: number) => void;
  setHasSubmitted: (v: boolean) => void;
  setWinnerInfo: (info: { winnerId: string; winnerName: string; cards: KnowledgeCard[] } | null) => void;
  setScores: (scores: Record<string, number>) => void;
  reset: () => void;
}

export const useGameStore = create<GameStore>((set, get) => ({
  playerName: "",
  connected: false,
  error: null,
  lobby: null,
  screen: "home",
  hand: [],
  round: null,
  scores: {},
  roundNumber: 0,
  maxRounds: 0,
  hasSubmitted: false,
  submittedPlayers: new Set(),
  selectedCards: [],
  winnerInfo: null,

  setPlayerName: (name) => set({ playerName: name }),
  setLobby: (lobby) => set({ lobby }),
  setConnected: (connected) => set({ connected }),
  setError: (error) => set({ error }),
  setScreen: (screen) => set({ screen }),

  setGameView: (view) =>
    set({
      hand: view.hand,
      round: view.round,
      scores: view.scores,
      roundNumber: view.roundNumber,
      maxRounds: view.maxRounds,
      hasSubmitted: view.hasSubmitted,
      submittedPlayers: new Set(),
      selectedCards: [],
      winnerInfo: null,
    }),

  setRoundPhase: (phase) => {
    const round = get().round;
    if (round) {
      set({ round: { ...round, phase } });
    }
  },

  setSubmissions: (submissions) => {
    const round = get().round;
    if (round) {
      set({ round: { ...round, phase: "judging", submissions } });
    }
  },

  addSubmittedPlayer: (playerId) => {
    const next = new Set(get().submittedPlayers);
    next.add(playerId);
    set({ submittedPlayers: next });
  },

  toggleCardSelection: (cardId, maxPick) => {
    const current = get().selectedCards;
    if (current.includes(cardId)) {
      set({ selectedCards: current.filter((id) => id !== cardId) });
    } else if (current.length < maxPick) {
      set({ selectedCards: [...current, cardId] });
    }
  },

  setHasSubmitted: (v) => set({ hasSubmitted: v }),

  setWinnerInfo: (info) => set({ winnerInfo: info }),

  setScores: (scores) => set({ scores }),

  reset: () =>
    set({
      playerName: "",
      lobby: null,
      error: null,
      screen: "home",
      hand: [],
      round: null,
      scores: {},
      roundNumber: 0,
      maxRounds: 0,
      hasSubmitted: false,
      submittedPlayers: new Set(),
      selectedCards: [],
      winnerInfo: null,
    }),
}));
