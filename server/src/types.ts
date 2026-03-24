export interface Player {
  id: string;
  name: string;
  isHost: boolean;
  score: number;
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
}

// ── Game Types ──

export interface ChaosCard {
  id: string;
  text: string;
  pick: number; // how many Knowledge cards to play (usually 1)
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

// Client -> Server game events
export interface ClientEvents {
  "lobby:create": (playerName: string, deckId: string, callback: (response: LobbyResponse) => void) => void;
  "lobby:join": (code: string, playerName: string, callback: (response: LobbyResponse) => void) => void;
  "lobby:leave": () => void;
  "lobby:start": (callback: (response: { success: boolean; error?: string }) => void) => void;
  "game:submit": (cardIds: string[], callback: (response: { success: boolean; error?: string }) => void) => void;
  "game:pick-winner": (playerId: string, callback: (response: { success: boolean; error?: string }) => void) => void;
  "game:next-round": () => void;
  "reaction:send": (emoji: string) => void;
  "chat:send": (message: string) => void;
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
    screen: "lobby" | "game";
  }) => void;
  "game:round-start": (view: PlayerGameView) => void;
  "game:player-submitted": (playerId: string) => void;
  "game:judging": (submissions: Submission[], chaosCard: ChaosCard) => void;
  "game:round-winner": (winnerId: string, winnerName: string, cards: KnowledgeCard[], scores: Record<string, number>) => void;
  "game:over": (scores: Record<string, number>) => void;
  "reaction:broadcast": (emoji: string, playerName: string) => void;
  "chat:message": (message: { id: string; playerName: string; text: string; timestamp: number }) => void;
  "error": (message: string) => void;
}
