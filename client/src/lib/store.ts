"use client";

import { create } from "zustand";

export interface PlayerInfo {
  id: string;
  name: string;
  isHost: boolean;
  score: number;
  connected: boolean;
  isBot?: boolean;
  isSpectator?: boolean;
}

export interface LobbyState {
  code: string;
  players: PlayerInfo[];
  hostId: string;
  deckId: string;
  deckName: string;
  gameType: string;
  winCondition: { mode: string; value: number };
  houseRules?: { unoStacking?: boolean };
  status: "waiting" | "playing" | "finished";
  maxPlayers: number;
  rematchVotes?: number;
  rematchVoters?: string[];
}

export interface KnowledgeCard {
  id: string;
  text: string;
  imageUrl?: string;
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
  bonus?: boolean;
  imageUrl?: string;
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
  phase: "czar_setup" | "submitting" | "judging" | "revealing";
  submissions: Submission[];
  winnerId: string | null;
  phaseDeadline?: number;
  czarSetupCard?: KnowledgeCard;
  isBonus?: boolean;
}

export type GameType = "cah" | "joking_hazard" | "apples_to_apples" | "uno" | "codenames" | "superfight";

export interface CodenamesPlayerView {
  grid: { word: string; color?: string; revealed: boolean }[];
  currentTeam: string;
  phase: string;
  clue: { word: string; count: number; team: string } | null;
  guessesRemaining: number;
  teams: { red: { spymaster?: string; guessers: string[] }; blue: { spymaster?: string; guessers: string[] } };
  scores: { red: number; blue: number };
  targets: { red: number; blue: number };
  myTeam?: string;
  isSpymaster: boolean;
  lastAction?: string;
  gameOver: boolean;
  winner?: string;
  gameType: "codenames";
}

export type UnoColor = "red" | "blue" | "green" | "yellow";
export type UnoCardType = "number" | "skip" | "reverse" | "draw_two" | "wild" | "wild_draw_four";

export interface UnoCard {
  id: string;
  color: UnoColor | null;
  type: UnoCardType;
  value: number | null;
  text: string;
  colorLabel?: string;
}

export interface UnoDeckTemplate {
  colorNames: Record<UnoColor, string>;
  actionNames?: {
    skip?: string;
    reverse?: string;
    draw_two?: string;
    wild?: string;
    wild_draw_four?: string;
  };
  themeDescription?: string;
}

export interface UnoTurnState {
  currentPlayerId: string;
  phase: "playing" | "choosing_color" | "round_over";
  direction: 1 | -1;
  discardTop: UnoCard;
  drawPileCount: number;
  activeColor: UnoColor;
  lastAction?: string;
  turnDeadline: number;
  playerCardCounts: Record<string, number>;
  unoCalledBy?: string;
  mustDraw: number;
  canChallenge?: string;
}

export interface UnoPlayerView {
  hand: UnoCard[];
  turn: UnoTurnState;
  scores: Record<string, number>;
  roundNumber: number;
  maxRounds: number;
  gameOver: boolean;
  playableCardIds: string[];
  gameType: "uno";
  deckTemplate: UnoDeckTemplate;
  winMode?: string;
  targetPoints?: number;
  stackingEnabled?: boolean;
}

export interface PlayerGameView {
  hand: KnowledgeCard[];
  round: RoundState | null;
  scores: Record<string, number>;
  roundNumber: number;
  maxRounds: number;
  gameOver: boolean;
  hasSubmitted: boolean;
  gameType?: GameType;
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

  // Game type
  gameType: GameType;

  // Chat
  chatMessages: ChatMessage[];
  chatOpen: boolean;
  unreadCount: number;

  // Sticker / GIF overlay
  activeSticker: { url: string; playerName: string } | null;
  activeGif: { url: string; playerName: string } | null;

  // Meta card effects
  activeMetaEffect: MetaEffectNotification | null;
  handBlurred: boolean;
  iconsRandomized: boolean;

  // Lobby countdown
  countdown: number | null;

  // Codenames state
  codenamesView: CodenamesPlayerView | null;

  // Uno state
  unoHand: UnoCard[];
  unoTurn: UnoTurnState | null;
  playableCardIds: string[];
  selectedUnoCard: string | null;
  choosingColor: boolean;
  unoDeckTemplate: UnoDeckTemplate | null;
  unoRoundWinner: { winnerId: string; winnerName: string; roundPoints: number } | null;
  unoWinMode: string;
  unoTargetPoints: number;
  unoStackingEnabled: boolean;

  // Actions
  setPlayerName: (name: string) => void;
  setLobby: (lobby: LobbyState | null) => void;
  setConnected: (connected: boolean) => void;
  setError: (error: string | null) => void;
  setScreen: (screen: Screen) => void;
  setGameView: (view: PlayerGameView) => void;
  setGameType: (gameType: GameType) => void;
  setRoundPhase: (phase: "czar_setup" | "submitting" | "judging" | "revealing") => void;
  setSubmissions: (submissions: Submission[]) => void;
  addSubmittedPlayer: (playerId: string) => void;
  toggleCardSelection: (cardId: string, maxPick: number) => void;
  setHasSubmitted: (v: boolean) => void;
  setWinnerInfo: (info: { winnerId: string; winnerName: string; cards: KnowledgeCard[] } | null) => void;
  setScores: (scores: Record<string, number>) => void;
  addChatMessage: (msg: ChatMessage) => void;
  setChatOpen: (open: boolean) => void;
  setActiveSticker: (sticker: { url: string; playerName: string } | null) => void;
  setActiveGif: (gif: { url: string; playerName: string } | null) => void;
  setActiveMetaEffect: (effect: MetaEffectNotification | null) => void;
  setHandBlurred: (v: boolean) => void;
  setIconsRandomized: (v: boolean) => void;
  setCountdown: (v: number | null) => void;
  setCodenamesView: (view: CodenamesPlayerView) => void;
  setUnoGameView: (view: UnoPlayerView) => void;
  setUnoTurn: (turn: UnoTurnState) => void;
  selectUnoCard: (cardId: string | null) => void;
  setChoosingColor: (v: boolean) => void;
  setUnoRoundWinner: (info: { winnerId: string; winnerName: string; roundPoints: number } | null) => void;
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
  activeGif: null,
  activeMetaEffect: null,
  handBlurred: false,
  iconsRandomized: false,
  countdown: null,
  gameType: "cah",
  codenamesView: null,
  unoHand: [],
  unoTurn: null,
  playableCardIds: [],
  selectedUnoCard: null,
  choosingColor: false,
  unoDeckTemplate: null,
  unoRoundWinner: null,
  unoWinMode: "rounds",
  unoTargetPoints: Infinity,
  unoStackingEnabled: false,

  setPlayerName: (name) => set({ playerName: name }),
  setLobby: (lobby) => set({ lobby }),
  setConnected: (connected) => set({ connected }),
  setError: (error) => set({ error }),
  setScreen: (screen) => set({ screen }),

  setGameType: (gameType) => set({ gameType }),

  setGameView: (view) =>
    set({
      hand: view.hand,
      round: view.round,
      scores: view.scores,
      roundNumber: view.roundNumber,
      maxRounds: view.maxRounds,
      hasSubmitted: view.hasSubmitted,
      gameType: view.gameType || "cah",
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
    const { chatMessages, chatOpen, screen } = get();
    const updates: Partial<GameStore> = {
      chatMessages: [...chatMessages.slice(-99), msg],
      unreadCount: chatOpen ? 0 : get().unreadCount + 1,
    };
    // Show GIF overlay on game screen
    if (msg.gifUrl && screen === "game") {
      updates.activeGif = { url: msg.gifUrl, playerName: msg.playerName };
    }
    set(updates);
  },

  setChatOpen: (open) => set({ chatOpen: open, unreadCount: open ? 0 : get().unreadCount }),

  setActiveSticker: (sticker) => set({ activeSticker: sticker }),
  setActiveGif: (gif) => set({ activeGif: gif }),

  setActiveMetaEffect: (effect) => set({ activeMetaEffect: effect }),
  setHandBlurred: (v) => set({ handBlurred: v }),
  setIconsRandomized: (v) => set({ iconsRandomized: v }),
  setCountdown: (v) => set({ countdown: v }),

  setCodenamesView: (view) => set({ codenamesView: view, gameType: "codenames" }),

  setUnoGameView: (view) =>
    set({
      unoHand: view.hand,
      unoTurn: view.turn,
      scores: view.scores,
      roundNumber: view.roundNumber,
      maxRounds: view.maxRounds,
      playableCardIds: view.playableCardIds,
      gameType: "uno",
      unoDeckTemplate: view.deckTemplate,
      unoWinMode: view.winMode || "rounds",
      unoTargetPoints: view.targetPoints || Infinity,
      unoStackingEnabled: view.stackingEnabled || false,
      selectedUnoCard: null,
      choosingColor: false,
    }),

  setUnoTurn: (turn) => set({ unoTurn: turn }),

  selectUnoCard: (cardId) => set({ selectedUnoCard: cardId }),

  setChoosingColor: (v) => set({ choosingColor: v }),

  setUnoRoundWinner: (info) => set({ unoRoundWinner: info }),

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
      activeGif: null,
      activeMetaEffect: null,
      handBlurred: false,
      iconsRandomized: false,
      countdown: null,
      gameType: "cah",
      codenamesView: null,
      unoHand: [],
      unoTurn: null,
      playableCardIds: [],
      selectedUnoCard: null,
      choosingColor: false,
      unoDeckTemplate: null,
      unoRoundWinner: null,
      unoWinMode: "rounds",
      unoTargetPoints: Infinity,
      unoStackingEnabled: false,
    }),
}));
