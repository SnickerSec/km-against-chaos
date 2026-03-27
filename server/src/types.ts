export interface Player {
  id: string;
  name: string;
  isHost: boolean;
  score: number;
  connected: boolean;
  isBot?: boolean;
  isSpectator?: boolean;
}

export interface Lobby {
  code: string;
  players: Map<string, Player>;
  hostId: string;
  deckId: string;
  deckName: string;
  status: "waiting" | "playing" | "finished";
  maxPlayers: number;
  createdAt: Date;
}

export interface LobbyResponse {
  success: boolean;
  lobby?: LobbyState;
  error?: string;
}

export interface LobbyState {
  code: string;
  players: PlayerInfo[];
  hostId: string;
  deckId: string;
  deckName: string;
  status: "waiting" | "playing" | "finished";
}

export interface PlayerInfo {
  id: string;
  name: string;
  isHost: boolean;
  score: number;
  connected: boolean;
  isBot?: boolean;
  isSpectator?: boolean;
}

// ── Game Types ──

export type MetaEffectType = "score_add" | "score_subtract" | "hide_cards" | "randomize_icons" | "hand_reset";
export type MetaTarget = "winner" | "loser" | "all_others" | "czar" | "all";

export interface MetaEffect {
  type: MetaEffectType;
  value?: number; // for score_add / score_subtract
  target: MetaTarget;
  durationMs?: number; // for UI effects (hide_cards, randomize_icons)
}

export interface ChaosCard {
  id: string;
  text: string;
  pick: number; // how many Knowledge cards to play (usually 1)
  metaType?: "score_manipulation" | "ui_interference" | "hand_reset";
  metaEffect?: MetaEffect;
}

export interface MetaEffectPayload {
  effectType: MetaEffectType;
  value?: number;
  affectedPlayerIds: string[];
  description: string;
}

export interface KnowledgeCard {
  id: string;
  text: string;
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
  submissions: Submission[];       // only visible during judging/revealing
  winnerId: string | null;
  phaseDeadline?: number;          // Unix ms timestamp for countdown
}

export interface GameState {
  lobbyCode: string;
  rounds: number;
  maxRounds: number;
  currentRound: RoundState | null;
  scores: Record<string, number>;
  gameOver: boolean;
}

// What each player sees (hand is private)
export interface PlayerGameView {
  hand: KnowledgeCard[];
  round: RoundState | null;
  scores: Record<string, number>;
  roundNumber: number;
  maxRounds: number;
  gameOver: boolean;
  hasSubmitted: boolean;
}

// ── Voice Chat (WebRTC signaling) ──

export interface VoiceUser {
  id: string;
  name: string;
}

// Client -> Server game events
export interface ClientEvents {
  "lobby:create": (playerName: string, deckId: string, callback: (response: LobbyResponse) => void) => void;
  "lobby:join": (code: string, playerName: string, callback: (response: LobbyResponse) => void) => void;
  "lobby:leave": () => void;
  "lobby:start": (callback: (response: { success: boolean; error?: string }) => void) => void;
  "voice:join": (callback: (response: { voiceUsers: VoiceUser[] }) => void) => void;
  "voice:leave": () => void;
  "voice:offer": (targetId: string, sdp: RTCSessionDescriptionInit) => void;
  "voice:answer": (targetId: string, sdp: RTCSessionDescriptionInit) => void;
  "voice:ice-candidate": (targetId: string, candidate: RTCIceCandidateInit) => void;
  "game:submit": (cardIds: string[], callback: (response: { success: boolean; error?: string }) => void) => void;
  "game:pick-winner": (playerId: string, callback: (response: { success: boolean; error?: string }) => void) => void;
  "game:next-round": () => void;
  "reaction:send": (emoji: string) => void;
  "chat:send": (message: string) => void;
  "chat:gif": (gifUrl: string) => void;
  "media:sticker": (url: string) => void;
}

// Server -> Client game events
export interface ServerEvents {
  "lobby:updated": (state: LobbyState) => void;
  "lobby:player-joined": (player: PlayerInfo) => void;
  "lobby:player-left": (playerId: string) => void;
  "lobby:host-changed": (newHostId: string) => void;
  "lobby:player-disconnecting": (playerId: string) => void;
  "lobby:player-reconnected": (playerId: string) => void;
  "lobby:started": () => void;
  "session:reconnected": (data: {
    lobby: LobbyState;
    gameView: PlayerGameView | null;
    chatHistory: { id: string; playerName: string; text: string; gifUrl?: string; timestamp: number }[];
    screen: "lobby" | "game";
  }) => void;
  "game:round-start": (view: PlayerGameView) => void;
  "game:player-submitted": (playerId: string) => void;
  "game:judging": (submissions: Submission[], chaosCard: ChaosCard) => void;
  "game:round-winner": (winnerId: string, winnerName: string, cards: KnowledgeCard[], scores: Record<string, number>) => void;
  "game:meta-effect": (payload: MetaEffectPayload) => void;
  "game:hand-updated": (hand: KnowledgeCard[]) => void;
  "game:over": (scores: Record<string, number>) => void;
  "voice:user-joined": (user: VoiceUser) => void;
  "voice:user-left": (userId: string) => void;
  "voice:offer": (fromId: string, sdp: RTCSessionDescriptionInit) => void;
  "voice:answer": (fromId: string, sdp: RTCSessionDescriptionInit) => void;
  "voice:ice-candidate": (fromId: string, candidate: RTCIceCandidateInit) => void;
  "reaction:broadcast": (emoji: string, playerName: string) => void;
  "chat:message": (message: { id: string; playerName: string; text: string; gifUrl?: string; timestamp: number }) => void;
  "media:sticker": (url: string, playerName: string) => void;
  "error": (message: string) => void;
}
