// Codenames game engine. State lives in Redis (one JSON blob per lobby,
// keyed codenames:{code}) when REDIS_URL is set, otherwise in a local Map.
// Public API is async throughout so every replica reads the same state.

import { redis, withGameLock } from "./redis.js";

// Types
export type CodenamesColor = "red" | "blue" | "neutral" | "assassin";
export type CodenamesTeam = "red" | "blue";
export type CodenamesPhase = "team_pick" | "spymaster_clue" | "guessing" | "game_over";

export interface CodenamesWord {
  word: string;
  color: CodenamesColor;  // Only visible to spymasters
  revealed: boolean;
}

export interface CodenamesClue {
  word: string;
  count: number;
  team: CodenamesTeam;
}

export interface CodenamesPlayerView {
  grid: { word: string; color?: CodenamesColor; revealed: boolean }[];  // color only if spymaster or revealed
  currentTeam: CodenamesTeam;
  phase: CodenamesPhase;
  clue: CodenamesClue | null;
  guessesRemaining: number;
  teams: { red: { spymaster?: string; guessers: string[] }; blue: { spymaster?: string; guessers: string[] } };
  scores: { red: number; blue: number };
  targets: { red: number; blue: number };  // Total words each team needs to find
  myTeam?: CodenamesTeam;
  isSpymaster: boolean;
  lastAction?: string;
  gameOver: boolean;
  winner?: CodenamesTeam;
  gameType: "codenames";
}

interface InternalCodenamesGame {
  lobbyCode: string;
  playerIds: string[];
  grid: CodenamesWord[];  // 25 words
  currentTeam: CodenamesTeam;
  phase: CodenamesPhase;
  clue: CodenamesClue | null;
  guessesRemaining: number;
  teams: {
    red: { spymaster?: string; guessers: string[] };
    blue: { spymaster?: string; guessers: string[] };
  };
  scores: { red: number; blue: number };
  targets: { red: number; blue: number };
  lastAction?: string;
  gameOver: boolean;
  winner?: CodenamesTeam;
  createdAt: number;  // epoch ms — used by the snapshot-restore zombie filter
}

// ── Storage ──────────────────────────────────────────────────────────────────

const KEY = (code: string) => `codenames:${code}`;
const local = new Map<string, InternalCodenamesGame>();

async function loadGame(code: string): Promise<InternalCodenamesGame | undefined> {
  if (redis) {
    const json = await redis.get(KEY(code));
    return json ? JSON.parse(json) as InternalCodenamesGame : undefined;
  }
  return local.get(code);
}

async function saveGame(game: InternalCodenamesGame): Promise<void> {
  if (redis) {
    await redis.set(KEY(game.lobbyCode), JSON.stringify(game));
    return;
  }
  local.set(game.lobbyCode, game);
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

async function getAllGames(): Promise<InternalCodenamesGame[]> {
  if (redis) {
    const keys: string[] = [];
    let cursor = "0";
    do {
      const [next, batch] = await redis.scan(cursor, "MATCH", "codenames:*", "COUNT", 200);
      cursor = next;
      keys.push(...batch);
    } while (cursor !== "0");
    if (keys.length === 0) return [];
    const raws = await redis.mget(...keys);
    return raws.filter((r): r is string => !!r).map(r => JSON.parse(r) as InternalCodenamesGame);
  }
  return Array.from(local.values());
}

// Shuffle helper
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function createCodenamesGame(lobbyCode: string, playerIds: string[], words: string[]): Promise<void> {
  // Pick 25 random words
  const shuffledWords = shuffle([...words]);
  const selectedWords = shuffledWords.slice(0, 25);

  // Assign colors: 9 for starting team, 8 for other, 7 neutral, 1 assassin
  // Red goes first (gets 9 words)
  const colors: CodenamesColor[] = [
    ...Array(9).fill("red"),
    ...Array(8).fill("blue"),
    ...Array(7).fill("neutral"),
    "assassin",
  ];
  shuffle(colors);

  const grid: CodenamesWord[] = selectedWords.map((word, i) => ({
    word,
    color: colors[i],
    revealed: false,
  }));

  const game: InternalCodenamesGame = {
    lobbyCode,
    playerIds,
    grid,
    currentTeam: "red",  // Red always goes first (has 9 words)
    phase: "team_pick",
    clue: null,
    guessesRemaining: 0,
    teams: { red: { guessers: [] }, blue: { guessers: [] } },
    scores: { red: 0, blue: 0 },
    targets: { red: 9, blue: 8 },
    gameOver: false,
    createdAt: Date.now(),
  };

  await saveGame(game);
}

export async function isCodenamesGame(lobbyCode: string): Promise<boolean> {
  return gameExists(lobbyCode);
}

export async function getCodenamesPlayerView(lobbyCode: string, playerId: string): Promise<CodenamesPlayerView | null> {
  const game = await loadGame(lobbyCode);
  if (!game) return null;

  const isRedSpymaster = game.teams.red.spymaster === playerId;
  const isBluSpymaster = game.teams.blue.spymaster === playerId;
  const isSpymaster = isRedSpymaster || isBluSpymaster;

  const myTeam = isRedSpymaster || game.teams.red.guessers.includes(playerId) ? "red"
    : isBluSpymaster || game.teams.blue.guessers.includes(playerId) ? "blue"
    : undefined;

  return {
    grid: game.grid.map(w => ({
      word: w.word,
      color: (w.revealed || isSpymaster) ? w.color : undefined,
      revealed: w.revealed,
    })),
    currentTeam: game.currentTeam,
    phase: game.phase,
    clue: game.clue,
    guessesRemaining: game.guessesRemaining,
    teams: {
      red: { spymaster: game.teams.red.spymaster, guessers: [...game.teams.red.guessers] },
      blue: { spymaster: game.teams.blue.spymaster, guessers: [...game.teams.blue.guessers] },
    },
    scores: { ...game.scores },
    targets: { ...game.targets },
    myTeam,
    isSpymaster,
    lastAction: game.lastAction,
    gameOver: game.gameOver,
    winner: game.winner,
    gameType: "codenames",
  };
}

// Team selection phase
export async function joinTeam(lobbyCode: string, playerId: string, team: CodenamesTeam, asSpymaster: boolean): Promise<{ success: boolean; error?: string }> {
  return withGameLock("codenames", lobbyCode, async () => {
  const game = await loadGame(lobbyCode);
  if (!game) return { success: false, error: "Game not found" };
  if (game.phase !== "team_pick") return { success: false, error: "Not in team pick phase" };

  // Remove from any existing team
  game.teams.red.guessers = game.teams.red.guessers.filter(id => id !== playerId);
  game.teams.blue.guessers = game.teams.blue.guessers.filter(id => id !== playerId);
  if (game.teams.red.spymaster === playerId) game.teams.red.spymaster = undefined;
  if (game.teams.blue.spymaster === playerId) game.teams.blue.spymaster = undefined;

  if (asSpymaster) {
    if (game.teams[team].spymaster && game.teams[team].spymaster !== playerId) {
      return { success: false, error: "Spymaster slot taken" };
    }
    game.teams[team].spymaster = playerId;
  } else {
    game.teams[team].guessers.push(playerId);
  }

  await saveGame(game);
  return { success: true };
  });
}

export async function startCodenamesRound(lobbyCode: string): Promise<{ success: boolean; error?: string }> {
  return withGameLock("codenames", lobbyCode, async () => {
  const game = await loadGame(lobbyCode);
  if (!game) return { success: false, error: "Game not found" };

  // Need at least 1 spymaster per team and 1 guesser per team
  if (!game.teams.red.spymaster || !game.teams.blue.spymaster) {
    return { success: false, error: "Each team needs a Spymaster" };
  }
  if (game.teams.red.guessers.length === 0 || game.teams.blue.guessers.length === 0) {
    return { success: false, error: "Each team needs at least 1 guesser" };
  }

  game.phase = "spymaster_clue";
  game.currentTeam = "red";
  await saveGame(game);
  return { success: true };
  });
}

// Spymaster gives a clue
export async function giveClue(lobbyCode: string, playerId: string, word: string, count: number): Promise<{ success: boolean; error?: string }> {
  return withGameLock("codenames", lobbyCode, async () => {
  const game = await loadGame(lobbyCode);
  if (!game) return { success: false, error: "Game not found" };
  if (game.phase !== "spymaster_clue") return { success: false, error: "Not clue phase" };

  const isCurrentSpymaster = game.teams[game.currentTeam].spymaster === playerId;
  if (!isCurrentSpymaster) return { success: false, error: "Not the current Spymaster" };

  if (!word.trim() || count < 0 || count > 9) return { success: false, error: "Invalid clue" };

  // Check clue word isn't on the grid
  const gridWords = game.grid.map(w => w.word.toLowerCase());
  if (gridWords.includes(word.trim().toLowerCase())) {
    return { success: false, error: "Clue cannot be a word on the grid" };
  }

  game.clue = { word: word.trim(), count, team: game.currentTeam };
  // Guesses allowed = count + 1 (one extra guess allowed per official rules)
  // If count is 0 (meaning "none of these"), allow unlimited guesses
  game.guessesRemaining = count === 0 ? 99 : count + 1;
  game.phase = "guessing";
  game.lastAction = `${game.currentTeam === "red" ? "Red" : "Blue"} Spymaster: "${word.trim()}" for ${count}`;

  await saveGame(game);
  return { success: true };
  });
}

// Guesser selects a word
export async function guessWord(lobbyCode: string, playerId: string, wordIndex: number): Promise<{ success: boolean; error?: string; color?: CodenamesColor; gameOver?: boolean; turnOver?: boolean }> {
  return withGameLock("codenames", lobbyCode, async () => {
  const game = await loadGame(lobbyCode);
  if (!game) return { success: false, error: "Game not found" };
  if (game.phase !== "guessing") return { success: false, error: "Not guessing phase" };
  if (game.gameOver) return { success: false, error: "Game is over" };

  // Must be a guesser on current team
  const isGuesser = game.teams[game.currentTeam].guessers.includes(playerId);
  if (!isGuesser) return { success: false, error: "Not your turn to guess" };

  if (wordIndex < 0 || wordIndex >= 25) return { success: false, error: "Invalid word" };
  const word = game.grid[wordIndex];
  if (word.revealed) return { success: false, error: "Already revealed" };

  word.revealed = true;
  game.guessesRemaining--;

  const color = word.color;

  if (color === "assassin") {
    // Hit the assassin — current team loses
    game.gameOver = true;
    game.winner = game.currentTeam === "red" ? "blue" : "red";
    game.phase = "game_over";
    game.lastAction = `${word.word} was the ASSASSIN! ${game.winner === "red" ? "Red" : "Blue"} team wins!`;
    await saveGame(game);
    return { success: true, color, gameOver: true };
  }

  if (color === game.currentTeam) {
    // Correct guess
    game.scores[game.currentTeam]++;
    game.lastAction = `${word.word} — correct! (${game.currentTeam === "red" ? "Red" : "Blue"})`;

    // Check if team found all their words
    if (game.scores[game.currentTeam] >= game.targets[game.currentTeam]) {
      game.gameOver = true;
      game.winner = game.currentTeam;
      game.phase = "game_over";
      game.lastAction = `${game.currentTeam === "red" ? "Red" : "Blue"} team found all their words! They win!`;
      await saveGame(game);
      return { success: true, color, gameOver: true };
    }

    if (game.guessesRemaining <= 0) {
      // Out of guesses — switch teams
      switchTeam(game);
      await saveGame(game);
      return { success: true, color, turnOver: true };
    }

    await saveGame(game);
    return { success: true, color };
  }

  // Wrong color (other team's word or neutral)
  if (color === (game.currentTeam === "red" ? "blue" : "red")) {
    // Other team's word
    const otherTeam = game.currentTeam === "red" ? "blue" : "red";
    game.scores[otherTeam]++;
    game.lastAction = `${word.word} belongs to ${otherTeam === "red" ? "Red" : "Blue"} team!`;

    // Check if other team won
    if (game.scores[otherTeam] >= game.targets[otherTeam]) {
      game.gameOver = true;
      game.winner = otherTeam;
      game.phase = "game_over";
      await saveGame(game);
      return { success: true, color, gameOver: true };
    }
  } else {
    game.lastAction = `${word.word} is neutral.`;
  }

  // Wrong guess or neutral — switch teams
  switchTeam(game);
  await saveGame(game);
  return { success: true, color, turnOver: true };
  });
}

function switchTeam(game: InternalCodenamesGame): void {
  game.currentTeam = game.currentTeam === "red" ? "blue" : "red";
  game.phase = "spymaster_clue";
  game.clue = null;
  game.guessesRemaining = 0;
}

// Pass turn (guessers can end their turn early)
export async function passTurn(lobbyCode: string, playerId: string): Promise<{ success: boolean; error?: string }> {
  return withGameLock("codenames", lobbyCode, async () => {
  const game = await loadGame(lobbyCode);
  if (!game) return { success: false, error: "Game not found" };
  if (game.phase !== "guessing") return { success: false, error: "Not guessing phase" };

  const isGuesser = game.teams[game.currentTeam].guessers.includes(playerId);
  if (!isGuesser) return { success: false, error: "Not your turn" };

  game.lastAction = `${game.currentTeam === "red" ? "Red" : "Blue"} team passed.`;
  switchTeam(game);
  await saveGame(game);
  return { success: true };
  });
}

export async function cleanupCodenamesGame(lobbyCode: string): Promise<void> {
  return withGameLock("codenames", lobbyCode, async () => {
    await deleteGame(lobbyCode);
  });
}

/**
 * Remove a player from an active Codenames game (leave or kick). Clears their
 * slot on either team; a vacated spymaster slot becomes unset so the team can
 * reassign.
 */
export async function removePlayerFromCodenamesGame(lobbyCode: string, playerId: string): Promise<void> {
  return withGameLock("codenames", lobbyCode, async () => {
  const game = await loadGame(lobbyCode);
  if (!game) return;

  const idx = game.playerIds.indexOf(playerId);
  if (idx === -1) return;
  game.playerIds.splice(idx, 1);

  for (const team of ["red", "blue"] as const) {
    if (game.teams[team].spymaster === playerId) {
      game.teams[team].spymaster = undefined;
    }
    game.teams[team].guessers = game.teams[team].guessers.filter(p => p !== playerId);
  }

  await saveGame(game);
  });
}

export async function getCodenamesScores(lobbyCode: string): Promise<Record<string, number> | null> {
  const game = await loadGame(lobbyCode);
  if (!game) return null;
  // Return team-based scores mapped to player IDs
  const scores: Record<string, number> = {};
  const winningTeam = game.winner;
  for (const pid of game.playerIds) {
    const isRed = game.teams.red.spymaster === pid || game.teams.red.guessers.includes(pid);
    const team = isRed ? "red" : "blue";
    scores[pid] = team === winningTeam ? 1 : 0;
  }
  return scores;
}

// ── Snapshot / Restore ───────────────────────────────────────────────────────
// State is entirely primitives/plain objects (no Maps or Sets), so the whole
// game object round-trips through JSON cleanly.

export async function exportCodenamesGames(): Promise<any[]> {
  return getAllGames();
}

const ABANDONED_GAME_AGE_MS = 2 * 60 * 60 * 1000; // 2h since creation → zombie

export async function restoreCodenamesGames(snapshots: any[]): Promise<void> {
  for (const s of snapshots) {
    const game = s as InternalCodenamesGame;
    // Skip zombie games. Codenames has no phase deadline to key staleness off,
    // so use createdAt the same way lobby.ts does: a game older than 2h is
    // something nobody is actively playing. Pre-existing snapshots without
    // createdAt are treated as fresh — the 15-min snapshot-table cutoff in
    // snapshot.ts already bounds how long they can linger.
    if (game.createdAt && Date.now() - game.createdAt > ABANDONED_GAME_AGE_MS) {
      continue;
    }
    await saveGame(game);
  }
}
