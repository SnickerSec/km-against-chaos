import type {
  ChaosCard,
  KnowledgeCard,
  Submission,
  RoundState,
  GameState,
  PlayerGameView,
} from "./types.js";
import { CHAOS_CARDS, KNOWLEDGE_CARDS, shuffled } from "./deck.js";

const HAND_SIZE = 7;
const DEFAULT_MAX_ROUNDS = 10;

interface InternalGameState {
  lobbyCode: string;
  playerIds: string[];
  czarIndex: number;
  chaosDeck: ChaosCard[];
  knowledgeDeck: KnowledgeCard[];
  hands: Map<string, KnowledgeCard[]>;
  currentRound: InternalRound | null;
  scores: Map<string, number>;
  roundNumber: number;
  maxRounds: number;
  gameOver: boolean;
}

interface InternalRound {
  chaosCard: ChaosCard;
  czarId: string;
  phase: "submitting" | "judging" | "revealing";
  submissions: Map<string, KnowledgeCard[]>;
  winnerId: string | null;
}

const games = new Map<string, InternalGameState>();

export function createGame(
  lobbyCode: string,
  playerIds: string[],
  customChaos?: ChaosCard[],
  customKnowledge?: KnowledgeCard[]
): void {
  const chaosDeck = shuffled(customChaos || CHAOS_CARDS);
  const knowledgeDeck = shuffled(customKnowledge || KNOWLEDGE_CARDS);

  // Deal hands
  const hands = new Map<string, KnowledgeCard[]>();
  const scores = new Map<string, number>();
  for (const pid of playerIds) {
    hands.set(pid, knowledgeDeck.splice(0, HAND_SIZE));
    scores.set(pid, 0);
  }

  const game: InternalGameState = {
    lobbyCode,
    playerIds,
    czarIndex: 0,
    chaosDeck,
    knowledgeDeck,
    hands,
    currentRound: null,
    scores,
    roundNumber: 0,
    maxRounds: Math.min(DEFAULT_MAX_ROUNDS, chaosDeck.length),
    gameOver: false,
  };

  games.set(lobbyCode, game);
}

export function startRound(lobbyCode: string): RoundState | null {
  const game = games.get(lobbyCode);
  if (!game || game.gameOver) return null;

  game.roundNumber++;
  if (game.roundNumber > game.maxRounds || game.chaosDeck.length === 0) {
    game.gameOver = true;
    return null;
  }

  const czarId = game.playerIds[game.czarIndex % game.playerIds.length];
  const chaosCard = game.chaosDeck.pop()!;

  game.currentRound = {
    chaosCard,
    czarId,
    phase: "submitting",
    submissions: new Map(),
    winnerId: null,
  };

  return {
    roundNumber: game.roundNumber,
    czarId,
    chaosCard,
    phase: "submitting",
    submissions: [],
    winnerId: null,
  };
}

export function getPlayerView(lobbyCode: string, playerId: string): PlayerGameView | null {
  const game = games.get(lobbyCode);
  if (!game) return null;

  const hand = game.hands.get(playerId) || [];
  const round = game.currentRound;

  let roundState: RoundState | null = null;
  if (round) {
    roundState = {
      roundNumber: game.roundNumber,
      czarId: round.czarId,
      chaosCard: round.chaosCard,
      phase: round.phase,
      submissions:
        round.phase === "judging" || round.phase === "revealing"
          ? shuffled(Array.from(round.submissions.entries()).map(([pid, cards]) => ({
              playerId: round.phase === "revealing" ? pid : "", // anonymous during judging
              cards,
            })))
          : [],
      winnerId: round.winnerId,
    };
  }

  return {
    hand,
    round: roundState,
    scores: Object.fromEntries(game.scores),
    roundNumber: game.roundNumber,
    maxRounds: game.maxRounds,
    gameOver: game.gameOver,
    hasSubmitted: round ? round.submissions.has(playerId) : false,
  };
}

export function submitCards(
  lobbyCode: string,
  playerId: string,
  cardIds: string[]
): { success: boolean; allSubmitted: boolean; error?: string } {
  const game = games.get(lobbyCode);
  if (!game) return { success: false, allSubmitted: false, error: "Game not found" };

  const round = game.currentRound;
  if (!round || round.phase !== "submitting") {
    return { success: false, allSubmitted: false, error: "Not in submission phase" };
  }

  if (playerId === round.czarId) {
    return { success: false, allSubmitted: false, error: "The Czar doesn't submit cards" };
  }

  if (round.submissions.has(playerId)) {
    return { success: false, allSubmitted: false, error: "Already submitted" };
  }

  if (cardIds.length !== round.chaosCard.pick) {
    return { success: false, allSubmitted: false, error: `Must submit exactly ${round.chaosCard.pick} card(s)` };
  }

  const hand = game.hands.get(playerId);
  if (!hand) return { success: false, allSubmitted: false, error: "Player not in game" };

  // Remove cards from hand
  const playedCards: KnowledgeCard[] = [];
  for (const cid of cardIds) {
    const idx = hand.findIndex((c) => c.id === cid);
    if (idx === -1) {
      return { success: false, allSubmitted: false, error: "Card not in your hand" };
    }
    playedCards.push(hand.splice(idx, 1)[0]);
  }

  // Draw replacements
  for (let i = 0; i < playedCards.length; i++) {
    if (game.knowledgeDeck.length > 0) {
      hand.push(game.knowledgeDeck.pop()!);
    }
  }

  round.submissions.set(playerId, playedCards);

  // Check if all non-czar players have submitted
  const expectedCount = game.playerIds.filter((id) => id !== round.czarId).length;
  const allSubmitted = round.submissions.size >= expectedCount;

  if (allSubmitted) {
    round.phase = "judging";
  }

  return { success: true, allSubmitted };
}

export function getJudgingData(lobbyCode: string): {
  submissions: Submission[];
  chaosCard: ChaosCard;
} | null {
  const game = games.get(lobbyCode);
  if (!game?.currentRound || game.currentRound.phase !== "judging") return null;

  const round = game.currentRound;
  // Shuffle submissions so czar can't guess by order
  const submissions = shuffled(
    Array.from(round.submissions.entries()).map(([playerId, cards]) => ({
      playerId,
      cards,
    }))
  );

  return { submissions, chaosCard: round.chaosCard };
}

export function pickWinner(
  lobbyCode: string,
  czarId: string,
  winnerId: string
): { success: boolean; error?: string } {
  const game = games.get(lobbyCode);
  if (!game) return { success: false, error: "Game not found" };

  const round = game.currentRound;
  if (!round || round.phase !== "judging") {
    return { success: false, error: "Not in judging phase" };
  }

  if (czarId !== round.czarId) {
    return { success: false, error: "Only the Czar can pick the winner" };
  }

  if (!round.submissions.has(winnerId)) {
    return { success: false, error: "Invalid winner" };
  }

  round.winnerId = winnerId;
  round.phase = "revealing";
  game.scores.set(winnerId, (game.scores.get(winnerId) || 0) + 1);

  return { success: true };
}

export function getWinnerCards(lobbyCode: string): KnowledgeCard[] | null {
  const game = games.get(lobbyCode);
  if (!game?.currentRound) return null;
  const winnerId = game.currentRound.winnerId;
  if (!winnerId) return null;
  return game.currentRound.submissions.get(winnerId) || null;
}

export function advanceRound(lobbyCode: string): void {
  const game = games.get(lobbyCode);
  if (!game) return;
  game.czarIndex++;
  game.currentRound = null;
}

export function getScores(lobbyCode: string): Record<string, number> | null {
  const game = games.get(lobbyCode);
  if (!game) return null;
  return Object.fromEntries(game.scores);
}

export function isGameOver(lobbyCode: string): boolean {
  const game = games.get(lobbyCode);
  if (!game) return true;
  return game.gameOver || game.roundNumber >= game.maxRounds;
}

export function endGame(lobbyCode: string): void {
  const game = games.get(lobbyCode);
  if (game) game.gameOver = true;
}

export function cleanupGame(lobbyCode: string): void {
  games.delete(lobbyCode);
}

export function getPlayerIds(lobbyCode: string): string[] {
  return games.get(lobbyCode)?.playerIds || [];
}

export function getCzarId(lobbyCode: string): string | undefined {
  return games.get(lobbyCode)?.currentRound?.czarId;
}
