import type {
  ChaosCard,
  KnowledgeCard,
  Submission,
  RoundState,
  GameState,
  PlayerGameView,
  MetaEffect,
  MetaTarget,
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
  winMode: "rounds" | "points";
  targetPoints: number;
  gameOver: boolean;
}

const SUBMIT_TIME_MS = 60_000; // 60s for submissions
const JUDGE_TIME_MS = 30_000;  // 30s for czar to pick

interface InternalRound {
  chaosCard: ChaosCard;
  czarId: string;
  phase: "submitting" | "judging" | "revealing";
  submissions: Map<string, KnowledgeCard[]>;
  winnerId: string | null;
  phaseDeadline: number; // Date.now() + time limit
}

const games = new Map<string, InternalGameState>();

export function createGame(
  lobbyCode: string,
  playerIds: string[],
  customChaos?: ChaosCard[],
  customKnowledge?: KnowledgeCard[],
  winCondition?: { mode: "rounds" | "points"; value: number }
): void {
  const chaosDeck = shuffled(customChaos || CHAOS_CARDS);
  const knowledgeDeck = shuffled(customKnowledge || KNOWLEDGE_CARDS);

  const wc = winCondition || { mode: "rounds" as const, value: DEFAULT_MAX_ROUNDS };

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
    maxRounds: wc.mode === "rounds" ? Math.min(wc.value, chaosDeck.length) : chaosDeck.length,
    winMode: wc.mode,
    targetPoints: wc.mode === "points" ? wc.value : Infinity,
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

  const phaseDeadline = Date.now() + SUBMIT_TIME_MS;

  game.currentRound = {
    chaosCard,
    czarId,
    phase: "submitting",
    submissions: new Map(),
    winnerId: null,
    phaseDeadline,
  };

  return {
    roundNumber: game.roundNumber,
    czarId,
    chaosCard,
    phase: "submitting",
    submissions: [],
    winnerId: null,
    phaseDeadline,
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
              playerId: pid,
              cards,
            })))
          : [],
      winnerId: round.winnerId,
      phaseDeadline: round.phaseDeadline,
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
    round.phaseDeadline = Date.now() + JUDGE_TIME_MS;
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

export function resolveMetaTargets(
  target: MetaTarget,
  winnerId: string,
  czarId: string,
  playerIds: string[]
): string[] {
  switch (target) {
    case "winner": return [winnerId];
    case "czar": return [czarId];
    case "all": return playerIds;
    case "all_others": return playerIds.filter((id) => id !== winnerId);
    case "loser": {
      // Find the player with the lowest score who isn't the winner or czar
      // Falls back to all non-winners if no clear loser
      return playerIds.filter((id) => id !== winnerId && id !== czarId);
    }
    default: return [];
  }
}

export function resetPlayerHand(lobbyCode: string, playerId: string): KnowledgeCard[] {
  const game = games.get(lobbyCode);
  if (!game) return [];

  const newHand: KnowledgeCard[] = [];
  for (let i = 0; i < HAND_SIZE; i++) {
    if (game.knowledgeDeck.length > 0) {
      newHand.push(game.knowledgeDeck.pop()!);
    }
  }
  game.hands.set(playerId, newHand);
  return newHand;
}

export function pickWinner(
  lobbyCode: string,
  czarId: string,
  winnerId: string
): {
  success: boolean;
  error?: string;
  metaEffect?: {
    effect: MetaEffect;
    winnerId: string;
    czarId: string;
    playerIds: string[];
  };
} {
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
  const newScore = (game.scores.get(winnerId) || 0) + 1;
  game.scores.set(winnerId, newScore);

  // Check point-based win
  if (game.winMode === "points" && newScore >= game.targetPoints) {
    game.gameOver = true;
  }

  // Handle meta card effects
  const metaEffect = round.chaosCard.metaEffect;
  if (metaEffect) {
    const targets = resolveMetaTargets(metaEffect.target, winnerId, czarId, game.playerIds);

    if (metaEffect.type === "score_add" && metaEffect.value) {
      for (const pid of targets) {
        game.scores.set(pid, (game.scores.get(pid) || 0) + metaEffect.value!);
      }
    } else if (metaEffect.type === "score_subtract" && metaEffect.value) {
      for (const pid of targets) {
        const current = game.scores.get(pid) || 0;
        game.scores.set(pid, Math.max(0, current - metaEffect.value!));
      }
    }
    // hand_reset and ui effects are handled in the socket layer

    return {
      success: true,
      metaEffect: {
        effect: metaEffect,
        winnerId,
        czarId,
        playerIds: game.playerIds,
      },
    };
  }

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

export function getWinInfo(lobbyCode: string): { mode: "rounds" | "points"; value: number } | null {
  const game = games.get(lobbyCode);
  if (!game) return null;
  return { mode: game.winMode, value: game.winMode === "points" ? game.targetPoints : game.maxRounds };
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

export function addPlayerToGame(lobbyCode: string, playerId: string): boolean {
  const game = games.get(lobbyCode);
  if (!game || game.gameOver) return false;

  // Already in the game
  if (game.playerIds.includes(playerId)) return true;

  game.playerIds.push(playerId);
  game.scores.set(playerId, 0);

  // Deal a hand from the remaining deck
  const hand: KnowledgeCard[] = [];
  for (let i = 0; i < HAND_SIZE; i++) {
    if (game.knowledgeDeck.length > 0) {
      hand.push(game.knowledgeDeck.pop()!);
    }
  }
  game.hands.set(playerId, hand);

  return true;
}

export function removePlayerFromGame(lobbyCode: string, playerId: string): void {
  const game = games.get(lobbyCode);
  if (!game) return;

  game.playerIds = game.playerIds.filter(id => id !== playerId);
  game.hands.delete(playerId);
  game.scores.delete(playerId);

  // If they had a submission this round, remove it
  if (game.currentRound) {
    game.currentRound.submissions.delete(playerId);
  }
}

export function botSubmitCards(lobbyCode: string, botId: string): { success: boolean; allSubmitted: boolean } {
  const game = games.get(lobbyCode);
  if (!game) return { success: false, allSubmitted: false };

  const round = game.currentRound;
  if (!round || round.phase !== "submitting") return { success: false, allSubmitted: false };
  if (botId === round.czarId) return { success: false, allSubmitted: false };
  if (round.submissions.has(botId)) return { success: false, allSubmitted: false };

  const hand = game.hands.get(botId);
  if (!hand || hand.length === 0) return { success: false, allSubmitted: false };

  // Pick random cards from hand
  const pickCount = Math.min(round.chaosCard.pick, hand.length);
  const indices = shuffled(hand.map((_, i) => i)).slice(0, pickCount);
  indices.sort((a, b) => b - a); // reverse sort so splicing doesn't shift indices

  const playedCards: KnowledgeCard[] = [];
  for (const idx of indices) {
    playedCards.push(hand.splice(idx, 1)[0]);
  }

  // Draw replacements
  for (let i = 0; i < playedCards.length; i++) {
    if (game.knowledgeDeck.length > 0) {
      hand.push(game.knowledgeDeck.pop()!);
    }
  }

  round.submissions.set(botId, playedCards);

  const expectedCount = game.playerIds.filter(id => id !== round.czarId).length;
  const allSubmitted = round.submissions.size >= expectedCount;
  if (allSubmitted) {
    round.phase = "judging";
    round.phaseDeadline = Date.now() + JUDGE_TIME_MS;
  }

  return { success: true, allSubmitted };
}

export function forceSubmitForMissing(lobbyCode: string): string[] {
  const game = games.get(lobbyCode);
  if (!game?.currentRound || game.currentRound.phase !== "submitting") return [];

  const round = game.currentRound;
  const missing = game.playerIds.filter(id => id !== round.czarId && !round.submissions.has(id));

  for (const pid of missing) {
    const hand = game.hands.get(pid);
    if (!hand || hand.length === 0) continue;

    const pickCount = Math.min(round.chaosCard.pick, hand.length);
    const indices = shuffled(hand.map((_, i) => i)).slice(0, pickCount);
    indices.sort((a, b) => b - a);

    const playedCards: KnowledgeCard[] = [];
    for (const idx of indices) {
      playedCards.push(hand.splice(idx, 1)[0]);
    }

    for (let i = 0; i < playedCards.length; i++) {
      if (game.knowledgeDeck.length > 0) {
        hand.push(game.knowledgeDeck.pop()!);
      }
    }

    round.submissions.set(pid, playedCards);
  }

  round.phase = "judging";
  round.phaseDeadline = Date.now() + JUDGE_TIME_MS;
  return missing;
}

export function getPhaseDeadline(lobbyCode: string): number | null {
  const game = games.get(lobbyCode);
  return game?.currentRound?.phaseDeadline ?? null;
}

export function botPickWinner(lobbyCode: string, botCzarId: string): { winnerId: string | null; metaEffect?: any } {
  const game = games.get(lobbyCode);
  if (!game?.currentRound || game.currentRound.phase !== "judging") return { winnerId: null };
  if (game.currentRound.czarId !== botCzarId) return { winnerId: null };

  // Pick a random submission
  const submitters = Array.from(game.currentRound.submissions.keys());
  if (submitters.length === 0) return { winnerId: null };

  const winnerId = submitters[Math.floor(Math.random() * submitters.length)];
  const result = pickWinner(lobbyCode, botCzarId, winnerId);

  if (result.success) {
    return { winnerId, metaEffect: result.metaEffect };
  }
  return { winnerId: null };
}

export function remapGamePlayer(
  lobbyCode: string,
  oldPlayerId: string,
  newPlayerId: string
): void {
  const game = games.get(lobbyCode);
  if (!game) return;

  // Update playerIds array
  const idx = game.playerIds.indexOf(oldPlayerId);
  if (idx !== -1) {
    game.playerIds[idx] = newPlayerId;
  }

  // Update hands
  const hand = game.hands.get(oldPlayerId);
  if (hand) {
    game.hands.delete(oldPlayerId);
    game.hands.set(newPlayerId, hand);
  }

  // Update scores
  if (game.scores.has(oldPlayerId)) {
    const score = game.scores.get(oldPlayerId)!;
    game.scores.delete(oldPlayerId);
    game.scores.set(newPlayerId, score);
  }

  // Update current round references
  const round = game.currentRound;
  if (!round) return;

  if (round.czarId === oldPlayerId) {
    round.czarId = newPlayerId;
  }

  if (round.submissions.has(oldPlayerId)) {
    const cards = round.submissions.get(oldPlayerId)!;
    round.submissions.delete(oldPlayerId);
    round.submissions.set(newPlayerId, cards);
  }

  if (round.winnerId === oldPlayerId) {
    round.winnerId = newPlayerId;
  }
}
