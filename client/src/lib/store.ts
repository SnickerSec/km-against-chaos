"use client";

import { create } from "zustand";

export interface PlayerInfo {
  id: string;
  name: string;
  isHost: boolean;
  score: number;
  connected: boolean;
  isBot?: boolean;
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

export interface MetaEffect {
  type: "score_add" | "score_subtract" | "hide_cards" | "randomize_icons" | "hand_reset";
  value?: number;
  target: string;
  durationMs?: number;
}

export interface ChaosCard {
  id: string;
  text: string;
  pick: number;
  metaType?: string;
  metaEffect?: MetaEffect;
}

export interface MetaEffectNotification {
  effectType: string;
  value?: number;
  affectedPlayerIds: string[];
  description: string;
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

export interface ChatMessage {
  id: string;
  playerName: string;
  text: string;
  gifUrl?: string;
  timestamp: number;
}

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

  // Chat
  chatMessages: ChatMessage[];
  chatOpen: boolean;
  unreadCount: number;

  // Sticker overlay
  activeSticker: { url: string; playerName: string } | null;

  // Meta card effects
  activeMetaEffect: MetaEffectNotification | null;
  handBlurred: boolean;
  iconsRandomized: boolean;

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
  addChatMessage: (msg: ChatMessage) => void;
  setChatOpen: (open: boolean) => void;
  setActiveSticker: (sticker: { url: string; playerName: string } | null) => void;
  setActiveMetaEffect: (effect: MetaEffectNotification | null) => void;
  setHandBlurred: (v: boolean) => void;
  setIconsRandomized: (v: boolean) => void;
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
  chatMessages: [],
  chatOpen: false,
  unreadCount: 0,
  activeSticker: null,
  activeMetaEffect: null,
  handBlurred: false,
  iconsRandomized: false,

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
    } else {
      // At max picks — replace the last selection
      set({ selectedCards: [...current.slice(0, maxPick - 1), cardId] });
    }
  },

  setHasSubmitted: (v) => set({ hasSubmitted: v }),

  setWinnerInfo: (info) => set({ winnerInfo: info }),

  setScores: (scores) => set({ scores }),

  addChatMessage: (msg) => {
    const { chatMessages, chatOpen } = get();
    set({
      chatMessages: [...chatMessages.slice(-99), msg],
      unreadCount: chatOpen ? 0 : get().unreadCount + 1,
    });
  },

  setChatOpen: (open) => set({ chatOpen: open, unreadCount: open ? 0 : get().unreadCount }),

  setActiveSticker: (sticker) => set({ activeSticker: sticker }),

  setActiveMetaEffect: (effect) => set({ activeMetaEffect: effect }),
  setHandBlurred: (v) => set({ handBlurred: v }),
  setIconsRandomized: (v) => set({ iconsRandomized: v }),

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
      chatMessages: [],
      chatOpen: false,
      unreadCount: 0,
      activeSticker: null,
      activeMetaEffect: null,
      handBlurred: false,
      iconsRandomized: false,
    }),
}));
