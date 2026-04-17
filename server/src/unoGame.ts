import { UnoCard, UnoColor, UnoCardType, UnoTurnState, UnoPlayerView, UnoDeckTemplate } from "./types";
import { getPlayerNameInLobby } from "./lobby.js";

const HAND_SIZE = 7;
const TURN_TIME_MS = 30_000;

// Resolve the display name for a player in a given lobby, falling back to a
// generic label if the lobby is gone (e.g., in unit tests without a lobby).
function displayName(lobbyCode: string, playerId: string): string {
  const name = getPlayerNameInLobby(lobbyCode, playerId);
  if (name) return name;
  return playerId.startsWith("bot-") ? "Bot" : "Someone";
}

interface InternalUnoGame {
  lobbyCode: string;
  playerIds: string[];
  hands: Map<string, UnoCard[]>;
  drawPile: UnoCard[];
  discardPile: UnoCard[];
  scores: Map<string, number>;
  currentPlayerIndex: number;
  direction: 1 | -1;
  activeColor: UnoColor;
  phase: "playing" | "choosing_color" | "round_over";
  roundNumber: number;
  maxRounds: number;
  winMode: "rounds" | "points" | "single_round" | "lowest_score";
  targetPoints: number;
  gameOver: boolean;
  pendingDraw: number;
  unoCalledPlayers: Set<string>;
  turnDeadline: number;
  lastAction?: string;
  deckTemplate: UnoDeckTemplate;
  stackingEnabled: boolean;
  vulnerablePlayer?: string; // player with 1 card who hasn't called Uno yet
}

const games = new Map<string, InternalUnoGame>();

// ── Deck Generation ──

function generateUnoDeck(template: UnoDeckTemplate): UnoCard[] {
  const cards: UnoCard[] = [];
  const colors: UnoColor[] = ["red", "blue", "green", "yellow"];
  let id = 0;

  for (const color of colors) {
    const label = template.colorNames[color];
    // One 0 per color
    cards.push({ id: `u${id++}`, color, type: "number", value: 0, text: `${label} 0`, colorLabel: label });
    // Two each of 1-9
    for (let v = 1; v <= 9; v++) {
      for (let c = 0; c < 2; c++) {
        cards.push({ id: `u${id++}`, color, type: "number", value: v, text: `${label} ${v}`, colorLabel: label });
      }
    }
    // Two each of Skip, Reverse, Draw Two
    for (const actionType of ["skip", "reverse", "draw_two"] as UnoCardType[]) {
      const name = template.actionNames?.[actionType as keyof NonNullable<UnoDeckTemplate["actionNames"]>]
        || actionType.replace("_", " ");
      for (let c = 0; c < 2; c++) {
        cards.push({ id: `u${id++}`, color, type: actionType, value: null, text: `${label} ${name}`, colorLabel: label });
      }
    }
  }
  // 4 Wild, 4 Wild Draw Four
  const wildName = template.actionNames?.wild || "Wild";
  const wd4Name = template.actionNames?.wild_draw_four || "Wild Draw Four";
  for (let i = 0; i < 4; i++) {
    cards.push({ id: `u${id++}`, color: null, type: "wild", value: null, text: wildName });
    cards.push({ id: `u${id++}`, color: null, type: "wild_draw_four", value: null, text: wd4Name });
  }
  return cards;
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ── Validation ──

export function isValidPlay(card: UnoCard, discardTop: UnoCard, activeColor: UnoColor, pendingDraw: number, stackingEnabled: boolean = false): boolean {
  // If there's a pending draw...
  if (pendingDraw > 0) {
    if (!stackingEnabled) return false;
    // Stacking: allow draw_two on draw_two, wild_draw_four on anything pending
    if (card.type === "draw_two" && discardTop.type === "draw_two") return true;
    if (card.type === "wild_draw_four") return true;
    return false;
  }
  // Wild cards can always be played
  if (card.type === "wild" || card.type === "wild_draw_four") return true;
  // Match color
  if (card.color === activeColor) return true;
  // Match number
  if (card.type === "number" && discardTop.type === "number" && card.value === discardTop.value) return true;
  // Match action type
  if (card.type !== "number" && card.type === discardTop.type) return true;
  return false;
}

function getPlayableCardIds(hand: UnoCard[], discardTop: UnoCard, activeColor: UnoColor, pendingDraw: number, stackingEnabled: boolean = false): string[] {
  return hand.filter(c => isValidPlay(c, discardTop, activeColor, pendingDraw, stackingEnabled)).map(c => c.id);
}

// ── Draw from pile (with reshuffle) ──

function drawFromPile(game: InternalUnoGame, count: number): UnoCard[] {
  const drawn: UnoCard[] = [];
  for (let i = 0; i < count; i++) {
    if (game.drawPile.length === 0) {
      // Reshuffle discard (keep top card)
      if (game.discardPile.length <= 1) break; // can't draw anymore
      const top = game.discardPile.pop()!;
      game.drawPile = shuffle([...game.discardPile]);
      game.discardPile = [top];
    }
    const card = game.drawPile.pop();
    if (card) drawn.push(card);
  }
  return drawn;
}

// ── Create Game ──

export function createUnoGame(
  lobbyCode: string,
  playerIds: string[],
  template: UnoDeckTemplate,
  winCondition?: { mode: "rounds" | "points" | "single_round" | "lowest_score"; value: number },
  houseRules?: { unoStacking?: boolean },
): void {
  const deck = shuffle(generateUnoDeck(template));

  const hands = new Map<string, UnoCard[]>();
  for (const pid of playerIds) {
    hands.set(pid, deck.splice(0, HAND_SIZE));
  }

  // Flip starting discard — if it's a wild draw four, reshuffle it back and try again
  let startCard: UnoCard;
  while (true) {
    startCard = deck.pop()!;
    if (startCard.type !== "wild_draw_four") break;
    deck.unshift(startCard); // put back and reshuffle
    shuffle(deck);
  }

  // Determine starting active color
  let activeColor: UnoColor;
  if (startCard.color) {
    activeColor = startCard.color;
  } else {
    // Wild as starting card — pick random color
    const colors: UnoColor[] = ["red", "blue", "green", "yellow"];
    activeColor = colors[Math.floor(Math.random() * 4)];
  }

  // Handle starting action cards per official rules
  let currentPlayerIndex = 0;
  let direction: 1 | -1 = 1;

  if (startCard.type === "skip") {
    currentPlayerIndex = 1 % playerIds.length;
  } else if (startCard.type === "reverse") {
    direction = -1;
    currentPlayerIndex = (playerIds.length - 1);
  } else if (startCard.type === "draw_two") {
    // First player draws 2 and loses turn
    const firstHand = hands.get(playerIds[0])!;
    firstHand.push(...deck.splice(0, 2));
    currentPlayerIndex = 1 % playerIds.length;
  }

  const game: InternalUnoGame = {
    lobbyCode,
    playerIds,
    hands,
    drawPile: deck,
    discardPile: [startCard],
    scores: new Map(playerIds.map(id => [id, 0])),
    currentPlayerIndex,
    direction,
    activeColor,
    phase: "playing",
    roundNumber: 1,
    maxRounds: winCondition?.mode === "rounds" ? winCondition.value
      : winCondition?.mode === "single_round" ? 1
      : winCondition?.mode === "lowest_score" ? 999
      : 10,
    winMode: winCondition?.mode || "rounds",
    targetPoints: winCondition?.mode === "points" ? winCondition.value
      : winCondition?.mode === "lowest_score" ? winCondition.value
      : winCondition?.mode === "single_round" ? Infinity
      : Infinity,
    gameOver: false,
    pendingDraw: 0,
    unoCalledPlayers: new Set(),
    turnDeadline: Date.now() + TURN_TIME_MS,
    deckTemplate: template,
    stackingEnabled: houseRules?.unoStacking || false,
  };

  games.set(lobbyCode, game);
}

// ── Player View ──

export function getUnoPlayerView(lobbyCode: string, playerId: string): UnoPlayerView | null {
  const game = games.get(lobbyCode);
  if (!game) return null;

  const hand = game.hands.get(playerId) || [];
  const discardTop = game.discardPile[game.discardPile.length - 1];

  const playerCardCounts: Record<string, number> = {};
  for (const pid of game.playerIds) {
    playerCardCounts[pid] = game.hands.get(pid)?.length || 0;
  }

  const isMyTurn = game.playerIds[game.currentPlayerIndex] === playerId;
  const playable = isMyTurn && game.phase === "playing"
    ? getPlayableCardIds(hand, discardTop, game.activeColor, game.pendingDraw, game.stackingEnabled)
    : [];

  return {
    hand,
    turn: {
      currentPlayerId: game.playerIds[game.currentPlayerIndex],
      phase: game.phase,
      direction: game.direction,
      discardTop,
      drawPileCount: game.drawPile.length,
      activeColor: game.activeColor,
      lastAction: game.lastAction,
      turnDeadline: game.turnDeadline,
      playerCardCounts,
      unoCalledBy: game.unoCalledPlayers.size > 0 ? [...game.unoCalledPlayers][game.unoCalledPlayers.size - 1] : undefined,
      mustDraw: game.pendingDraw,
      canChallenge: game.vulnerablePlayer && game.vulnerablePlayer !== playerId ? game.vulnerablePlayer : undefined,
    },
    scores: Object.fromEntries(game.scores),
    roundNumber: game.roundNumber,
    maxRounds: game.maxRounds,
    gameOver: game.gameOver,
    playableCardIds: playable,
    gameType: "uno",
    deckTemplate: game.deckTemplate,
    winMode: game.winMode,
    targetPoints: game.targetPoints,
    stackingEnabled: game.stackingEnabled,
  };
}

// ── Play Card ──

export interface PlayCardResult {
  success: boolean;
  error?: string;
  roundOver?: boolean;
  gameOver?: boolean;
  winnerId?: string;
  roundPoints?: number;
}

export function playCard(
  lobbyCode: string,
  playerId: string,
  cardId: string,
  chosenColor?: UnoColor | null,
): PlayCardResult {
  const game = games.get(lobbyCode);
  if (!game) return { success: false, error: "Game not found" };
  if (game.phase !== "playing") return { success: false, error: "Not in playing phase" };
  if (game.playerIds[game.currentPlayerIndex] !== playerId) return { success: false, error: "Not your turn" };

  const hand = game.hands.get(playerId)!;
  const cardIndex = hand.findIndex(c => c.id === cardId);
  if (cardIndex === -1) return { success: false, error: "Card not in hand" };

  const card = hand[cardIndex];
  const discardTop = game.discardPile[game.discardPile.length - 1];

  if (!isValidPlay(card, discardTop, game.activeColor, game.pendingDraw, game.stackingEnabled)) {
    return { success: false, error: "Invalid play" };
  }

  // Remove card from hand, add to discard
  hand.splice(cardIndex, 1);
  game.discardPile.push(card);
  game.vulnerablePlayer = undefined;

  const pName = displayName(lobbyCode, playerId);

  // Resolve card effects
  if (card.type === "wild" || card.type === "wild_draw_four") {
    if (!chosenColor) {
      // Shouldn't happen if client sends color, but default
      const colors: UnoColor[] = ["red", "blue", "green", "yellow"];
      chosenColor = colors[Math.floor(Math.random() * 4)];
    }
    game.activeColor = chosenColor;

    if (card.type === "wild_draw_four") {
      if (game.stackingEnabled) {
        // Stacking: accumulate penalty and pass to next player
        game.pendingDraw += 4;
        game.lastAction = `${pName} played ${card.text}! Draw penalty is now ${game.pendingDraw}`;
        advanceTurn(game);
      } else {
        game.pendingDraw = 4;
        game.lastAction = `${pName} played ${card.text}! Next player draws 4`;
        advanceTurn(game);
        // Next player draws 4 and loses turn
        const nextPid = game.playerIds[game.currentPlayerIndex];
        const drawn = drawFromPile(game, 4);
        game.hands.get(nextPid)!.push(...drawn);
        game.pendingDraw = 0;
        game.lastAction = `${pName} played ${card.text}! ${displayName(lobbyCode, nextPid)} draws 4`;
        advanceTurn(game);
      }
    } else {
      game.lastAction = `${pName} played ${card.text}`;
      advanceTurn(game);
    }
  } else if (card.type === "skip") {
    game.activeColor = card.color!;
    game.lastAction = `${pName} played ${card.text}! Next player skipped`;
    advanceTurn(game);
    advanceTurn(game); // skip next
  } else if (card.type === "reverse") {
    game.activeColor = card.color!;
    game.direction *= -1;
    if (game.playerIds.length === 2) {
      // In 2-player, reverse acts as skip
      game.lastAction = `${pName} played ${card.text}! Direction reversed`;
      advanceTurn(game);
      advanceTurn(game);
    } else {
      game.lastAction = `${pName} played ${card.text}! Direction reversed`;
      advanceTurn(game);
    }
  } else if (card.type === "draw_two") {
    game.activeColor = card.color!;
    if (game.stackingEnabled) {
      // Stacking: accumulate penalty and pass to next player
      game.pendingDraw += 2;
      game.lastAction = `${pName} played ${card.text}! Draw penalty is now ${game.pendingDraw}`;
      advanceTurn(game);
    } else {
      advanceTurn(game);
      const nextPid = game.playerIds[game.currentPlayerIndex];
      const drawn = drawFromPile(game, 2);
      game.hands.get(nextPid)!.push(...drawn);
      game.lastAction = `${pName} played ${card.text}! ${displayName(lobbyCode, nextPid)} draws 2`;
      advanceTurn(game); // skip the drawing player
    }
  } else {
    // Number card
    game.activeColor = card.color!;
    game.lastAction = `${pName} played ${card.text}`;
    advanceTurn(game);
  }

  // Check Uno vulnerability — if player has 1 card and hasn't called Uno
  if (hand.length === 1 && !game.unoCalledPlayers.has(playerId)) {
    game.vulnerablePlayer = playerId;
  }

  // Check win — hand empty
  if (hand.length === 0) {
    game.phase = "round_over";
    let roundPoints = 0;

    if (game.winMode === "lowest_score") {
      // Each player gets their own remaining card values as points (bad for them)
      for (const [pid, pHand] of game.hands) {
        if (pHand.length === 0) continue; // winner gets 0
        let pts = 0;
        for (const card of pHand) {
          if (card.type === "number") pts += card.value || 0;
          else if (card.type === "skip" || card.type === "reverse" || card.type === "draw_two") pts += 20;
          else pts += 50;
        }
        game.scores.set(pid, (game.scores.get(pid) || 0) + pts);
      }
      // roundPoints for display: total points dealt out this round
      roundPoints = computeRoundScore(game);
      game.lastAction = `${pName} wins the round! Opponents add their card points.`;

      // Check if any player hit the limit
      for (const [pid, score] of game.scores) {
        if (score >= game.targetPoints) {
          game.gameOver = true;
          break;
        }
      }
    } else {
      // Standard scoring: winner banks all opponents' card values
      roundPoints = computeRoundScore(game);
      game.scores.set(playerId, (game.scores.get(playerId) || 0) + roundPoints);
      game.lastAction = `${pName} wins the round! (+${roundPoints} points)`;

      // Check game over
      if (game.winMode === "points" && (game.scores.get(playerId) || 0) >= game.targetPoints) {
        game.gameOver = true;
      } else if (game.winMode === "rounds" && game.roundNumber >= game.maxRounds) {
        game.gameOver = true;
      }
    }

    if (game.winMode === "single_round") {
      game.gameOver = true;
    }

    return { success: true, roundOver: true, gameOver: game.gameOver, winnerId: playerId, roundPoints };
  }

  game.turnDeadline = Date.now() + TURN_TIME_MS;
  game.unoCalledPlayers.clear();

  return { success: true };
}

function advanceTurn(game: InternalUnoGame): void {
  game.currentPlayerIndex = ((game.currentPlayerIndex + game.direction) % game.playerIds.length + game.playerIds.length) % game.playerIds.length;
}

// ── Draw Card ──

export interface DrawCardResult {
  success: boolean;
  error?: string;
  drawnCard?: UnoCard;
  autoPlayed?: boolean;
}

export function drawCard(lobbyCode: string, playerId: string): DrawCardResult {
  const game = games.get(lobbyCode);
  if (!game) return { success: false, error: "Game not found" };
  if (game.phase !== "playing") return { success: false, error: "Not in playing phase" };
  if (game.playerIds[game.currentPlayerIndex] !== playerId) return { success: false, error: "Not your turn" };

  const pName = displayName(lobbyCode, playerId);

  // If there's a pending draw (stacking mode), draw the full accumulated penalty
  if (game.pendingDraw > 0 && game.stackingEnabled) {
    const hand = game.hands.get(playerId)!;
    const drawn = drawFromPile(game, game.pendingDraw);
    hand.push(...drawn);
    game.lastAction = `${pName} couldn't stack — draws ${game.pendingDraw}!`;
    game.pendingDraw = 0;
    game.vulnerablePlayer = undefined;
    advanceTurn(game);
    game.turnDeadline = Date.now() + TURN_TIME_MS;
    game.unoCalledPlayers.clear();
    return { success: true, drawnCard: drawn.length > 0 ? drawn[drawn.length - 1] : undefined };
  }

  const drawn = drawFromPile(game, 1);
  if (drawn.length === 0) {
    // No cards to draw — skip turn
    advanceTurn(game);
    game.turnDeadline = Date.now() + TURN_TIME_MS;
    return { success: true };
  }

  const card = drawn[0];
  const hand = game.hands.get(playerId)!;
  hand.push(card);

  game.lastAction = `${pName} drew a card`;
  game.vulnerablePlayer = undefined;

  // Player drew — advance turn (official rules: can play drawn card if valid, but for simplicity advance)
  advanceTurn(game);
  game.turnDeadline = Date.now() + TURN_TIME_MS;
  game.unoCalledPlayers.clear();

  return { success: true, drawnCard: card };
}

// ── Uno Call / Challenge ──

export function callUno(lobbyCode: string, playerId: string): boolean {
  const game = games.get(lobbyCode);
  if (!game) return false;
  const hand = game.hands.get(playerId);
  if (!hand || hand.length > 2) return false; // can call when at 1 or 2 cards (anticipating play)
  game.unoCalledPlayers.add(playerId);
  if (game.vulnerablePlayer === playerId) {
    game.vulnerablePlayer = undefined;
  }
  return true;
}

export function challengeUno(lobbyCode: string, challengerId: string, targetId: string): { success: boolean; penalized: boolean } {
  const game = games.get(lobbyCode);
  if (!game) return { success: false, penalized: false };

  // Can only challenge the vulnerable player
  if (game.vulnerablePlayer !== targetId) return { success: false, penalized: false };

  // Target has 1 card and didn't call Uno — penalty: draw 2
  const targetHand = game.hands.get(targetId);
  if (!targetHand) return { success: false, penalized: false };

  const drawn = drawFromPile(game, 2);
  targetHand.push(...drawn);
  game.vulnerablePlayer = undefined;
  game.lastAction = `${displayName(lobbyCode, targetId)} caught not calling Uno! Draws 2`;

  return { success: true, penalized: true };
}

// ── Scoring ──

function computeRoundScore(game: InternalUnoGame): number {
  let total = 0;
  for (const [pid, hand] of game.hands) {
    if (hand.length === 0) continue; // winner
    for (const card of hand) {
      if (card.type === "number") {
        total += card.value || 0;
      } else if (card.type === "skip" || card.type === "reverse" || card.type === "draw_two") {
        total += 20;
      } else {
        total += 50; // wild, wild draw four
      }
    }
  }
  return total;
}

// ── Round Management ──

export function advanceUnoRound(lobbyCode: string): { started: boolean; gameOver: boolean } {
  const game = games.get(lobbyCode);
  if (!game) return { started: false, gameOver: false };

  if (game.gameOver) return { started: false, gameOver: true };

  // single_round should never advance — game is over after 1 round
  if (game.winMode === "single_round") {
    game.gameOver = true;
    return { started: false, gameOver: true };
  }

  game.roundNumber++;
  if (game.winMode === "rounds" && game.roundNumber > game.maxRounds) {
    game.gameOver = true;
    return { started: false, gameOver: true };
  }

  // For lowest_score, check if any player hit the limit
  if (game.winMode === "lowest_score") {
    for (const [, score] of game.scores) {
      if (score >= game.targetPoints) {
        game.gameOver = true;
        return { started: false, gameOver: true };
      }
    }
  }

  // Re-deal
  const deck = shuffle(generateUnoDeck(game.deckTemplate));
  for (const pid of game.playerIds) {
    game.hands.set(pid, deck.splice(0, HAND_SIZE));
  }

  // Flip starting discard
  let startCard: UnoCard;
  while (true) {
    startCard = deck.pop()!;
    if (startCard.type !== "wild_draw_four") break;
    deck.unshift(startCard);
    shuffle(deck);
  }

  game.drawPile = deck;
  game.discardPile = [startCard];
  game.activeColor = startCard.color || (["red", "blue", "green", "yellow"] as UnoColor[])[Math.floor(Math.random() * 4)];
  game.currentPlayerIndex = 0;
  game.direction = 1;
  game.phase = "playing";
  game.pendingDraw = 0;
  game.unoCalledPlayers.clear();
  game.vulnerablePlayer = undefined;
  game.turnDeadline = Date.now() + TURN_TIME_MS;
  game.lastAction = undefined;

  // Handle starting action cards
  if (startCard.type === "skip") {
    game.currentPlayerIndex = 1 % game.playerIds.length;
  } else if (startCard.type === "reverse") {
    game.direction = -1;
    game.currentPlayerIndex = game.playerIds.length - 1;
  } else if (startCard.type === "draw_two") {
    const firstHand = game.hands.get(game.playerIds[0])!;
    firstHand.push(...game.drawPile.splice(0, 2));
    game.currentPlayerIndex = 1 % game.playerIds.length;
  }

  return { started: true, gameOver: false };
}

// ── Bot AI ──

export function botPlayUnoTurn(lobbyCode: string, botId: string): PlayCardResult | DrawCardResult {
  const game = games.get(lobbyCode);
  if (!game || game.playerIds[game.currentPlayerIndex] !== botId) return { success: false };

  const hand = game.hands.get(botId);
  if (!hand) return { success: false };

  const discardTop = game.discardPile[game.discardPile.length - 1];
  const playable = hand.filter(c => isValidPlay(c, discardTop, game.activeColor, game.pendingDraw, game.stackingEnabled));

  if (playable.length > 0) {
    // Strategy: prefer number cards, then action cards, wilds last
    playable.sort((a, b) => {
      const priority: Record<UnoCardType, number> = { number: 0, skip: 1, reverse: 1, draw_two: 2, wild: 3, wild_draw_four: 4 };
      return priority[a.type] - priority[b.type];
    });

    const card = playable[0];
    let chosenColor: UnoColor | undefined;
    if (card.type === "wild" || card.type === "wild_draw_four") {
      // Pick color bot has most of
      const counts: Record<UnoColor, number> = { red: 0, blue: 0, green: 0, yellow: 0 };
      for (const c of hand) { if (c.color) counts[c.color]++; }
      chosenColor = (Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]) as UnoColor;
    }

    // Call Uno before playing if going to 1 card
    if (hand.length === 2) {
      callUno(lobbyCode, botId);
    }

    return playCard(lobbyCode, botId, card.id, chosenColor);
  }

  return drawCard(lobbyCode, botId);
}

// ── Timeout Handler ──

export function handleUnoTurnTimeout(lobbyCode: string): DrawCardResult {
  const game = games.get(lobbyCode);
  if (!game || game.phase !== "playing") return { success: false };
  const pid = game.playerIds[game.currentPlayerIndex];
  return drawCard(lobbyCode, pid);
}

// ── Utility Exports ──

export function getUnoGame(lobbyCode: string): InternalUnoGame | undefined {
  return games.get(lobbyCode);
}

export function getUnoPlayerIds(lobbyCode: string): string[] {
  return games.get(lobbyCode)?.playerIds || [];
}

export function getUnoCurrentPlayer(lobbyCode: string): string | undefined {
  const game = games.get(lobbyCode);
  if (!game) return undefined;
  return game.playerIds[game.currentPlayerIndex];
}

export function isUnoGame(lobbyCode: string): boolean {
  return games.has(lobbyCode);
}

export function cleanupUnoGame(lobbyCode: string): void {
  games.delete(lobbyCode);
}

/**
 * Remove a player from an active Uno game (leave or kick). Their hand is
 * shuffled back into the draw pile so their cards aren't lost from the deck,
 * and the turn rotation is adjusted so play continues cleanly.
 */
export function removePlayerFromUnoGame(lobbyCode: string, playerId: string): void {
  const game = games.get(lobbyCode);
  if (!game) return;

  const idx = game.playerIds.indexOf(playerId);
  if (idx === -1) return;

  // Return the leaver's hand to the draw pile and reshuffle so their cards
  // stay in circulation for the remaining players.
  const hand = game.hands.get(playerId);
  if (hand && hand.length > 0) {
    game.drawPile.push(...hand);
    shuffle(game.drawPile);
  }

  game.playerIds.splice(idx, 1);
  game.hands.delete(playerId);
  game.scores.delete(playerId);
  game.unoCalledPlayers.delete(playerId);
  if (game.vulnerablePlayer === playerId) game.vulnerablePlayer = undefined;

  // Keep currentPlayerIndex pointing at the correct remaining player:
  //   - if it pointed past the leaver, decrement by one to keep the same player
  //   - if it pointed at the leaver, the next player now occupies that slot
  //     (no change needed) — but wrap if the leaver was at the end.
  if (game.playerIds.length === 0) return;
  if (idx < game.currentPlayerIndex) {
    game.currentPlayerIndex -= 1;
  } else if (game.currentPlayerIndex >= game.playerIds.length) {
    game.currentPlayerIndex = 0;
  }
}

export function remapUnoGamePlayer(lobbyCode: string, oldId: string, newId: string): void {
  const game = games.get(lobbyCode);
  if (!game) return;
  const idx = game.playerIds.indexOf(oldId);
  if (idx !== -1) game.playerIds[idx] = newId;
  const hand = game.hands.get(oldId);
  if (hand) {
    game.hands.delete(oldId);
    game.hands.set(newId, hand);
  }
  const score = game.scores.get(oldId);
  if (score !== undefined) {
    game.scores.delete(oldId);
    game.scores.set(newId, score);
  }
  if (game.unoCalledPlayers.has(oldId)) {
    game.unoCalledPlayers.delete(oldId);
    game.unoCalledPlayers.add(newId);
  }
  if (game.vulnerablePlayer === oldId) game.vulnerablePlayer = newId;
}

export function getUnoScores(lobbyCode: string): Record<string, number> {
  const game = games.get(lobbyCode);
  if (!game) return {};
  return Object.fromEntries(game.scores);
}

export function isUnoGameOver(lobbyCode: string): boolean {
  return games.get(lobbyCode)?.gameOver || false;
}

export function getUnoPhase(lobbyCode: string): string | undefined {
  return games.get(lobbyCode)?.phase;
}

// ── Snapshot / Restore ───────────────────────────────────────────────────────

export function exportUnoGames(): any[] {
  return Array.from(games.values()).map(g => ({
    lobbyCode: g.lobbyCode,
    playerIds: g.playerIds,
    hands: Array.from(g.hands.entries()),
    drawPile: g.drawPile,
    discardPile: g.discardPile,
    scores: Array.from(g.scores.entries()),
    currentPlayerIndex: g.currentPlayerIndex,
    direction: g.direction,
    activeColor: g.activeColor,
    phase: g.phase,
    roundNumber: g.roundNumber,
    maxRounds: g.maxRounds,
    winMode: g.winMode,
    targetPoints: g.targetPoints,
    gameOver: g.gameOver,
    pendingDraw: g.pendingDraw,
    unoCalledPlayers: Array.from(g.unoCalledPlayers),
    turnDeadline: g.turnDeadline,
    lastAction: g.lastAction,
    deckTemplate: g.deckTemplate,
    stackingEnabled: g.stackingEnabled,
    vulnerablePlayer: g.vulnerablePlayer,
  }));
}

export function restoreUnoGames(snapshots: any[]): void {
  for (const s of snapshots) {
    const game: InternalUnoGame = {
      lobbyCode: s.lobbyCode,
      playerIds: s.playerIds,
      hands: new Map(s.hands),
      drawPile: s.drawPile,
      discardPile: s.discardPile,
      scores: new Map(s.scores),
      currentPlayerIndex: s.currentPlayerIndex,
      direction: s.direction,
      activeColor: s.activeColor,
      phase: s.phase,
      roundNumber: s.roundNumber,
      maxRounds: s.maxRounds,
      winMode: s.winMode,
      targetPoints: s.targetPoints,
      gameOver: s.gameOver,
      pendingDraw: s.pendingDraw,
      unoCalledPlayers: new Set(s.unoCalledPlayers || []),
      // Turn timers don't survive; give the restored turn a fresh deadline
      // so the client sees a clean countdown on the new instance.
      turnDeadline: Date.now() + TURN_TIME_MS,
      lastAction: s.lastAction,
      deckTemplate: s.deckTemplate,
      stackingEnabled: s.stackingEnabled,
      vulnerablePlayer: s.vulnerablePlayer,
    };
    games.set(game.lobbyCode, game);
  }
}
