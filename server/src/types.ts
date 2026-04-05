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
  gameType: GameType;
  winCondition: { mode: string; value: number };
  houseRules?: { unoStacking?: boolean };
  status: "waiting" | "playing" | "finished";
  maxPlayers: number;
  createdAt: Date;
  rematchVotes: Set<string>;
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
  gameType: GameType;
  winCondition: { mode: string; value: number };
  houseRules?: { unoStacking?: boolean };
  status: "waiting" | "playing" | "finished";
  maxPlayers: number;
  rematchVotes: number;
  rematchVoters: string[];
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

export type GameType = "cah" | "joking_hazard" | "apples_to_apples" | "uno" | "codenames" | "superfight";

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
  bonus?: boolean; // Joking Hazard: red-bordered card — becomes Panel 3, players submit 2 cards, 2 points
  imageUrl?: string;
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
  imageUrl?: string;
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
  submissions: Submission[];       // only visible during judging/revealing
  winnerId: string | null;
  phaseDeadline?: number;          // Unix ms timestamp for countdown
  czarSetupCard?: KnowledgeCard;   // Joking Hazard: card played by czar as panel 2
  isBonus?: boolean;               // Joking Hazard: red card bonus round (card = Panel 3, submit 2)
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
  gameType?: GameType;
}

// ── Uno Types ──

export type UnoColor = "red" | "blue" | "green" | "yellow";
export type UnoCardType = "number" | "skip" | "reverse" | "draw_two" | "wild" | "wild_draw_four";

export interface UnoCard {
  id: string;
  color: UnoColor | null;       // null for wild cards (unplayed)
  type: UnoCardType;
  value: number | null;          // 0-9 for number cards, null for action/wild
  text: string;                  // Display text (themed)
  colorLabel?: string;           // Themed color name, e.g. "Fire" instead of "red"
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
  mustDraw: number;              // Pending draw-two/draw-four penalty
  canChallenge?: string;         // Player ID that can be challenged (has 1 card, didn't call Uno)
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
  winMode: "rounds" | "points" | "single_round" | "lowest_score";
  targetPoints: number;
  stackingEnabled: boolean;
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
  "game:czar-setup": (cardId: string, callback: (response: { success: boolean; error?: string }) => void) => void;
  "game:submit": (cardIds: string[], callback: (response: { success: boolean; error?: string }) => void) => void;
  "game:pick-winner": (playerId: string, callback: (response: { success: boolean; error?: string }) => void) => void;
  "game:next-round": () => void;
  "reaction:send": (emoji: string) => void;
  "chat:send": (message: string) => void;
  "chat:gif": (gifUrl: string) => void;
  "media:sticker": (url: string) => void;
  "uno:play-card": (cardId: string, chosenColor: UnoColor | null, callback: (response: { success: boolean; error?: string }) => void) => void;
  "uno:draw-card": (callback: (response: { success: boolean; drawnCard?: UnoCard; autoPlayed?: boolean; error?: string }) => void) => void;
  "uno:call-uno": (callback: (response: { success: boolean; error?: string }) => void) => void;
  "uno:challenge-uno": (targetId: string, callback: (response: { success: boolean; penalized?: boolean; error?: string }) => void) => void;
  "uno:next-round": () => void;
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
  "server_restart": (data: { message: string }) => void;
  "uno:turn-update": (view: UnoPlayerView) => void;
  "uno:card-played": (playerId: string, playerName: string, card: UnoCard, newColor?: UnoColor) => void;
  "uno:player-drew": (playerId: string, playerName: string, newCount: number) => void;
  "uno:uno-called": (playerId: string, playerName: string) => void;
  "uno:uno-penalty": (playerId: string, playerName: string) => void;
  "uno:round-over": (winnerId: string, winnerName: string, scores: Record<string, number>, roundPoints: number) => void;
  "uno:game-over": (scores: Record<string, number>) => void;
}
