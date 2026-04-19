import { UnoCard, UnoColor, UnoCardType, UnoTurnState, UnoPlayerView, UnoDeckTemplate } from "./types";
import { redis, withGameLock } from "./redis.js";

const HAND_SIZE = 7;
const TURN_TIME_MS = 30_000;

// Display-name override cache. Populated via setUnoPlayerNames() at game
// creation so we avoid an async cross-module call to lobby.ts on every
// card play. This is intentionally per-replica — if a player lands on a
// different replica the fallback kicks in ("Bot"/"Someone"). Good enough
// for a display string.
const playerNameOverrides = new Map<string, Map<string, string>>();

export function setUnoPlayerNames(lobbyCode: string, names: Record<string, string>): void {
  const map = new Map<string, string>();
  for (const [id, name] of Object.entries(names)) map.set(id, name);
  playerNameOverrides.set(lobbyCode, map);
}

function displayName(lobbyCode: string, playerId: string): string {
  const name = playerNameOverrides.get(lobbyCode)?.get(playerId);
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
  vulnerablePlayer?: string;
}

// ── Storage ──────────────────────────────────────────────────────────────────
// One JSON blob per lobby in Redis (uno:{code}), in-memory Map fallback
// otherwise. Maps and Sets are serialised to arrays of entries / arrays for
// JSON compatibility.

const KEY = (code: string) => `uno:${code}`;
const local = new Map<string, InternalUnoGame>();

interface SerialisedUnoGame {
  lobbyCode: string;
  playerIds: string[];
  hands: [string, UnoCard[]][];
  drawPile: UnoCard[];
  discardPile: UnoCard[];
  scores: [string, number][];
  currentPlayerIndex: number;
  direction: 1 | -1;
  activeColor: UnoColor;
  phase: InternalUnoGame["phase"];
  roundNumber: number;
  maxRounds: number;
  winMode: InternalUnoGame["winMode"];
  targetPoints: number;
  gameOver: boolean;
  pendingDraw: number;
  unoCalledPlayers: string[];
  turnDeadline: number;
  lastAction?: string;
  deckTemplate: UnoDeckTemplate;
  stackingEnabled: boolean;
  vulnerablePlayer?: string;
}

function serialise(g: InternalUnoGame): SerialisedUnoGame {
  return {
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
  };
}

function deserialise(s: SerialisedUnoGame): InternalUnoGame {
  return {
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
    turnDeadline: s.turnDeadline,
    lastAction: s.lastAction,
    deckTemplate: s.deckTemplate,
    stackingEnabled: s.stackingEnabled,
    vulnerablePlayer: s.vulnerablePlayer,
  };
}

async function loadGame(code: string): Promise<InternalUnoGame | undefined> {
  if (redis) {
    const json = await redis.get(KEY(code));
    return json ? deserialise(JSON.parse(json)) : undefined;
  }
  return local.get(code);
}

async function saveGame(g: InternalUnoGame): Promise<void> {
  if (redis) {
    await redis.set(KEY(g.lobbyCode), JSON.stringify(serialise(g)));
    return;
  }
  local.set(g.lobbyCode, g);
}

async function deleteGame(code: string): Promise<void> {
  if (redis) {
    await redis.del(KEY(code));
    return;
  }
  local.delete(code);
}

async function gameExists(code: string): Promise<boolean> {
  if (redis) return (await redis.exists(KEY(code))) === 1;
  return local.has(code);
}

async function getAllGames(): Promise<InternalUnoGame[]> {
  if (redis) {
    const keys: string[] = [];
    let cursor = "0";
    do {
      const [next, batch] = await redis.scan(cursor, "MATCH", "uno:*", "COUNT", 200);
      cursor = next;
      keys.push(...batch);
    } while (cursor !== "0");
    if (keys.length === 0) return [];
    const raws = await redis.mget(...keys);
    return raws.filter((r): r is string => !!r).map(r => deserialise(JSON.parse(r)));
  }
  return Array.from(local.values());
}

// ── Deck generation ──

function generateUnoDeck(template: UnoDeckTemplate): UnoCard[] {
  const cards: UnoCard[] = [];
  const colors: UnoColor[] = ["red", "blue", "green", "yellow"];
  let id = 0;

  for (const color of colors) {
    const label = template.colorNames[color];
    cards.push({ id: `u${id++}`, color, type: "number", value: 0, text: `${label} 0`, colorLabel: label });
    for (let v = 1; v <= 9; v++) {
      for (let c = 0; c < 2; c++) {
        cards.push({ id: `u${id++}`, color, type: "number", value: v, text: `${label} ${v}`, colorLabel: label });
      }
    }
    for (const actionType of ["skip", "reverse", "draw_two"] as UnoCardType[]) {
      const name = template.actionNames?.[actionType as keyof NonNullable<UnoDeckTemplate["actionNames"]>]
        || actionType.replace("_", " ");
      for (let c = 0; c < 2; c++) {
        cards.push({ id: `u${id++}`, color, type: actionType, value: null, text: `${label} ${name}`, colorLabel: label });
      }
    }
  }
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
  if (pendingDraw > 0) {
    if (!stackingEnabled) return false;
    if (card.type === "draw_two" && discardTop.type === "draw_two") return true;
    if (card.type === "wild_draw_four") return true;
    return false;
  }
  if (card.type === "wild" || card.type === "wild_draw_four") return true;
  if (card.color === activeColor) return true;
  if (card.type === "number" && discardTop.type === "number" && card.value === discardTop.value) return true;
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
      if (game.discardPile.length <= 1) break;
      const top = game.discardPile.pop()!;
      game.drawPile = shuffle([...game.discardPile]);
      game.discardPile = [top];
    }
    const card = game.drawPile.pop();
    if (card) drawn.push(card);
  }
  return drawn;
}

// ── Create Game ──────────────────────────────────────────────────────────────

export async function createUnoGame(
  lobbyCode: string,
  playerIds: string[],
  template: UnoDeckTemplate,
  winCondition?: { mode: "rounds" | "points" | "single_round" | "lowest_score"; value: number },
  houseRules?: { unoStacking?: boolean },
): Promise<void> {
  const deck = shuffle(generateUnoDeck(template));

  const hands = new Map<string, UnoCard[]>();
  for (const pid of playerIds) {
    hands.set(pid, deck.splice(0, HAND_SIZE));
  }

  let startCard: UnoCard;
  while (true) {
    startCard = deck.pop()!;
    if (startCard.type !== "wild_draw_four") break;
    deck.unshift(startCard);
    shuffle(deck);
  }

  let activeColor: UnoColor;
  if (startCard.color) {
    activeColor = startCard.color;
  } else {
    const colors: UnoColor[] = ["red", "blue", "green", "yellow"];
    activeColor = colors[Math.floor(Math.random() * 4)];
  }

  let currentPlayerIndex = 0;
  let direction: 1 | -1 = 1;

  if (startCard.type === "skip") {
    currentPlayerIndex = 1 % playerIds.length;
  } else if (startCard.type === "reverse") {
    direction = -1;
    currentPlayerIndex = (playerIds.length - 1);
  } else if (startCard.type === "draw_two") {
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

  await saveGame(game);
}

// ── Player View ──

export async function getUnoPlayerView(lobbyCode: string, playerId: string): Promise<UnoPlayerView | null> {
  const game = await loadGame(lobbyCode);
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

/** Pure internal playCard — mutates the passed game, no Redis I/O. */
function playCardOn(
  game: InternalUnoGame,
  playerId: string,
  cardId: string,
  chosenColor?: UnoColor | null,
): PlayCardResult {
  const lobbyCode = game.lobbyCode;
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

  hand.splice(cardIndex, 1);
  game.discardPile.push(card);
  game.vulnerablePlayer = undefined;

  const pName = displayName(lobbyCode, playerId);

  if (card.type === "wild" || card.type === "wild_draw_four") {
    if (!chosenColor) {
      const colors: UnoColor[] = ["red", "blue", "green", "yellow"];
      chosenColor = colors[Math.floor(Math.random() * 4)];
    }
    game.activeColor = chosenColor;

    if (card.type === "wild_draw_four") {
      if (game.stackingEnabled) {
        game.pendingDraw += 4;
        game.lastAction = `${pName} played ${card.text}! Draw penalty is now ${game.pendingDraw}`;
        advanceTurn(game);
      } else {
        game.pendingDraw = 4;
        game.lastAction = `${pName} played ${card.text}! Next player draws 4`;
        advanceTurn(game);
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
    advanceTurn(game);
  } else if (card.type === "reverse") {
    game.activeColor = card.color!;
    game.direction *= -1;
    if (game.playerIds.length === 2) {
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
      game.pendingDraw += 2;
      game.lastAction = `${pName} played ${card.text}! Draw penalty is now ${game.pendingDraw}`;
      advanceTurn(game);
    } else {
      advanceTurn(game);
      const nextPid = game.playerIds[game.currentPlayerIndex];
      const drawn = drawFromPile(game, 2);
      game.hands.get(nextPid)!.push(...drawn);
      game.lastAction = `${pName} played ${card.text}! ${displayName(lobbyCode, nextPid)} draws 2`;
      advanceTurn(game);
    }
  } else {
    game.activeColor = card.color!;
    game.lastAction = `${pName} played ${card.text}`;
    advanceTurn(game);
  }

  if (hand.length === 1 && !game.unoCalledPlayers.has(playerId)) {
    game.vulnerablePlayer = playerId;
  }

  if (hand.length === 0) {
    game.phase = "round_over";
    let roundPoints = 0;

    if (game.winMode === "lowest_score") {
      for (const [pid, pHand] of game.hands) {
        if (pHand.length === 0) continue;
        let pts = 0;
        for (const card of pHand) {
          if (card.type === "number") pts += card.value || 0;
          else if (card.type === "skip" || card.type === "reverse" || card.type === "draw_two") pts += 20;
          else pts += 50;
        }
        game.scores.set(pid, (game.scores.get(pid) || 0) + pts);
      }
      roundPoints = computeRoundScore(game);
      game.lastAction = `${pName} wins the round! Opponents add their card points.`;

      for (const [, score] of game.scores) {
        if (score >= game.targetPoints) {
          game.gameOver = true;
          break;
        }
      }
    } else {
      roundPoints = computeRoundScore(game);
      game.scores.set(playerId, (game.scores.get(playerId) || 0) + roundPoints);
      game.lastAction = `${pName} wins the round! (+${roundPoints} points)`;

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

export async function playCard(
  lobbyCode: string,
  playerId: string,
  cardId: string,
  chosenColor?: UnoColor | null,
): Promise<PlayCardResult> {
  return withGameLock("uno", lobbyCode, async () => {
  const game = await loadGame(lobbyCode);
  if (!game) return { success: false, error: "Game not found" };
  const result = playCardOn(game, playerId, cardId, chosenColor);
  if (result.success) await saveGame(game);
  return result;
  });
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

function drawCardOn(game: InternalUnoGame, playerId: string): DrawCardResult {
  const lobbyCode = game.lobbyCode;
  if (game.phase !== "playing") return { success: false, error: "Not in playing phase" };
  if (game.playerIds[game.currentPlayerIndex] !== playerId) return { success: false, error: "Not your turn" };

  const pName = displayName(lobbyCode, playerId);

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
    advanceTurn(game);
    game.turnDeadline = Date.now() + TURN_TIME_MS;
    return { success: true };
  }

  const card = drawn[0];
  const hand = game.hands.get(playerId)!;
  hand.push(card);

  game.lastAction = `${pName} drew a card`;
  game.vulnerablePlayer = undefined;

  advanceTurn(game);
  game.turnDeadline = Date.now() + TURN_TIME_MS;
  game.unoCalledPlayers.clear();

  return { success: true, drawnCard: card };
}

export async function drawCard(lobbyCode: string, playerId: string): Promise<DrawCardResult> {
  return withGameLock("uno", lobbyCode, async () => {
  const game = await loadGame(lobbyCode);
  if (!game) return { success: false, error: "Game not found" };
  const result = drawCardOn(game, playerId);
  if (result.success) await saveGame(game);
  return result;
  });
}

// ── Uno Call / Challenge ──

function callUnoOn(game: InternalUnoGame, playerId: string): boolean {
  const hand = game.hands.get(playerId);
  if (!hand || hand.length > 2) return false;
  game.unoCalledPlayers.add(playerId);
  if (game.vulnerablePlayer === playerId) {
    game.vulnerablePlayer = undefined;
  }
  return true;
}

export async function callUno(lobbyCode: string, playerId: string): Promise<boolean> {
  return withGameLock("uno", lobbyCode, async () => {
  const game = await loadGame(lobbyCode);
  if (!game) return false;
  const ok = callUnoOn(game, playerId);
  if (ok) await saveGame(game);
  return ok;
  });
}

export async function challengeUno(lobbyCode: string, challengerId: string, targetId: string): Promise<{ success: boolean; penalized: boolean }> {
  return withGameLock("uno", lobbyCode, async () => {
  const game = await loadGame(lobbyCode);
  if (!game) return { success: false, penalized: false };

  if (game.vulnerablePlayer !== targetId) return { success: false, penalized: false };

  const targetHand = game.hands.get(targetId);
  if (!targetHand) return { success: false, penalized: false };

  const drawn = drawFromPile(game, 2);
  targetHand.push(...drawn);
  game.vulnerablePlayer = undefined;
  game.lastAction = `${displayName(lobbyCode, targetId)} caught not calling Uno! Draws 2`;
  await saveGame(game);

  return { success: true, penalized: true };
  });
}

// ── Scoring ──

function computeRoundScore(game: InternalUnoGame): number {
  let total = 0;
  for (const [, hand] of game.hands) {
    if (hand.length === 0) continue;
    for (const card of hand) {
      if (card.type === "number") {
        total += card.value || 0;
      } else if (card.type === "skip" || card.type === "reverse" || card.type === "draw_two") {
        total += 20;
      } else {
        total += 50;
      }
    }
  }
  return total;
}

// ── Round Management ──

export async function advanceUnoRound(lobbyCode: string): Promise<{ started: boolean; gameOver: boolean }> {
  return withGameLock("uno", lobbyCode, async () => {
  const game = await loadGame(lobbyCode);
  if (!game) return { started: false, gameOver: false };

  if (game.gameOver) return { started: false, gameOver: true };

  if (game.winMode === "single_round") {
    game.gameOver = true;
    await saveGame(game);
    return { started: false, gameOver: true };
  }

  game.roundNumber++;
  if (game.winMode === "rounds" && game.roundNumber > game.maxRounds) {
    game.gameOver = true;
    await saveGame(game);
    return { started: false, gameOver: true };
  }

  if (game.winMode === "lowest_score") {
    for (const [, score] of game.scores) {
      if (score >= game.targetPoints) {
        game.gameOver = true;
        await saveGame(game);
        return { started: false, gameOver: true };
      }
    }
  }

  const deck = shuffle(generateUnoDeck(game.deckTemplate));
  for (const pid of game.playerIds) {
    game.hands.set(pid, deck.splice(0, HAND_SIZE));
  }

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

  await saveGame(game);
  return { started: true, gameOver: false };
  });
}

// ── Bot AI ──

export async function botPlayUnoTurn(lobbyCode: string, botId: string): Promise<PlayCardResult | DrawCardResult> {
  return withGameLock("uno", lobbyCode, async () => {
  const game = await loadGame(lobbyCode);
  if (!game || game.playerIds[game.currentPlayerIndex] !== botId) return { success: false };

  const hand = game.hands.get(botId);
  if (!hand) return { success: false };

  const discardTop = game.discardPile[game.discardPile.length - 1];
  const playable = hand.filter(c => isValidPlay(c, discardTop, game.activeColor, game.pendingDraw, game.stackingEnabled));

  if (playable.length > 0) {
    playable.sort((a, b) => {
      const priority: Record<UnoCardType, number> = { number: 0, skip: 1, reverse: 1, draw_two: 2, wild: 3, wild_draw_four: 4 };
      return priority[a.type] - priority[b.type];
    });

    const card = playable[0];
    let chosenColor: UnoColor | undefined;
    if (card.type === "wild" || card.type === "wild_draw_four") {
      const counts: Record<UnoColor, number> = { red: 0, blue: 0, green: 0, yellow: 0 };
      for (const c of hand) { if (c.color) counts[c.color]++; }
      chosenColor = (Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]) as UnoColor;
    }

    // Call Uno before playing if going to 1 card (mutates game in-memory)
    if (hand.length === 2) {
      callUnoOn(game, botId);
    }

    const result = playCardOn(game, botId, card.id, chosenColor);
    if (result.success) await saveGame(game);
    return result;
  }

  const result = drawCardOn(game, botId);
  if (result.success) await saveGame(game);
  return result;
  });
}

// ── Timeout Handler ──

export async function handleUnoTurnTimeout(lobbyCode: string): Promise<DrawCardResult> {
  return withGameLock("uno", lobbyCode, async () => {
  const game = await loadGame(lobbyCode);
  if (!game || game.phase !== "playing") return { success: false };
  const pid = game.playerIds[game.currentPlayerIndex];
  const result = drawCardOn(game, pid);
  if (result.success) await saveGame(game);
  return result;
  });
}

// ── Utility Exports ──

export async function getUnoGame(lobbyCode: string): Promise<InternalUnoGame | undefined> {
  return loadGame(lobbyCode);
}

export async function getUnoPlayerIds(lobbyCode: string): Promise<string[]> {
  return (await loadGame(lobbyCode))?.playerIds || [];
}

export async function getUnoCurrentPlayer(lobbyCode: string): Promise<string | undefined> {
  const game = await loadGame(lobbyCode);
  if (!game) return undefined;
  return game.playerIds[game.currentPlayerIndex];
}

export async function isUnoGame(lobbyCode: string): Promise<boolean> {
  return gameExists(lobbyCode);
}

export async function cleanupUnoGame(lobbyCode: string): Promise<void> {
  return withGameLock("uno", lobbyCode, async () => {
    await deleteGame(lobbyCode);
    playerNameOverrides.delete(lobbyCode);
  });
}

/**
 * Remove a player from an active Uno game (leave or kick). Their hand is
 * shuffled back into the draw pile so their cards aren't lost from the deck,
 * and the turn rotation is adjusted so play continues cleanly.
 */
export async function removePlayerFromUnoGame(lobbyCode: string, playerId: string): Promise<void> {
  return withGameLock("uno", lobbyCode, async () => {
  const game = await loadGame(lobbyCode);
  if (!game) return;

  const idx = game.playerIds.indexOf(playerId);
  if (idx === -1) return;

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

  if (game.playerIds.length === 0) {
    await saveGame(game);
    return;
  }
  if (idx < game.currentPlayerIndex) {
    game.currentPlayerIndex -= 1;
  } else if (game.currentPlayerIndex >= game.playerIds.length) {
    game.currentPlayerIndex = 0;
  }

  await saveGame(game);
  });
}

export async function remapUnoGamePlayer(lobbyCode: string, oldId: string, newId: string): Promise<void> {
  return withGameLock("uno", lobbyCode, async () => {
  const game = await loadGame(lobbyCode);
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
  await saveGame(game);
  });
}

export async function getUnoScores(lobbyCode: string): Promise<Record<string, number>> {
  const game = await loadGame(lobbyCode);
  if (!game) return {};
  return Object.fromEntries(game.scores);
}

export async function isUnoGameOver(lobbyCode: string): Promise<boolean> {
  return (await loadGame(lobbyCode))?.gameOver || false;
}

export async function getUnoPhase(lobbyCode: string): Promise<string | undefined> {
  return (await loadGame(lobbyCode))?.phase;
}

export async function getUnoTurnDeadline(lobbyCode: string): Promise<number | null> {
  return (await loadGame(lobbyCode))?.turnDeadline ?? null;
}

// ── Snapshot / Restore ───────────────────────────────────────────────────────

export async function exportUnoGames(): Promise<any[]> {
  const games = await getAllGames();
  return games.map(g => serialise(g));
}

const ABANDONED_GAME_STALENESS_MS = 60 * 60 * 1000; // 1h past turnDeadline → zombie

export async function restoreUnoGames(snapshots: any[]): Promise<void> {
  for (const s of snapshots) {
    const game = deserialise(s as SerialisedUnoGame);
    // Skip zombie games — games whose turnDeadline was already an hour in
    // the past at restore time mean nobody's been playing. Resurrecting them
    // each deploy just re-arms the turn timer and keeps the game looping
    // through SIGTERM → restore → timeout forever. Matches the CAH filter.
    if (Date.now() - game.turnDeadline > ABANDONED_GAME_STALENESS_MS) {
      continue;
    }
    // Turn timers don't survive; give the restored turn a fresh deadline
    // so the client sees a clean countdown on the new instance.
    game.turnDeadline = Date.now() + TURN_TIME_MS;
    await saveGame(game);
  }
}
