import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createCodenamesGame,
  isCodenamesGame,
  getCodenamesPlayerView,
  joinTeam,
  startCodenamesRound,
  giveClue,
  guessWord,
  passTurn,
  cleanupCodenamesGame,
  getCodenamesScores,
  exportCodenamesGames,
  restoreCodenamesGames,
} from "../codenamesGame.js";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const LOBBY = "test-codenames-001";
const PLAYERS = ["p1", "p2", "p3", "p4"];

// 30 words — enough for the 25-word grid
const WORDS = Array.from({ length: 30 }, (_, i) => `word${i}`);

/** Set up teams with valid spymasters and guessers, then start the round. */
async function setupTeamsAndStart() {
  await joinTeam(LOBBY, "p1", "red", true);    // red spymaster
  await joinTeam(LOBBY, "p2", "red", false);   // red guesser
  await joinTeam(LOBBY, "p3", "blue", true);   // blue spymaster
  await joinTeam(LOBBY, "p4", "blue", false);  // blue guesser
  await startCodenamesRound(LOBBY);
}

/** Find the grid index of a word with a specific color (from spymaster view). */
async function findWordIndex(color: string): Promise<number> {
  const view = (await getCodenamesPlayerView(LOBBY, "p1"))!; // p1 is red spymaster, sees all colors
  return view.grid.findIndex(w => w.color === color && !w.revealed);
}

/** Find all grid indices for a given color. */
async function findAllWordIndices(color: string): Promise<number[]> {
  const view = (await getCodenamesPlayerView(LOBBY, "p1"))!;
  return view.grid
    .map((w, i) => (w.color === color && !w.revealed) ? i : -1)
    .filter(i => i >= 0);
}

// ── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(async () => {
  await cleanupCodenamesGame(LOBBY);
  await createCodenamesGame(LOBBY, PLAYERS, WORDS);
});

afterEach(async () => {
  await cleanupCodenamesGame(LOBBY);
});

// ── Game creation ────────────────────────────────────────────────────────────

describe("createCodenamesGame", () => {
  it("creates a game that can be found", async () => {
    expect(await isCodenamesGame(LOBBY)).toBe(true);
  });

  it("non-existent lobby returns false", async () => {
    expect(await isCodenamesGame("nope")).toBe(false);
  });

  it("grid has exactly 25 words", async () => {
    const view = (await getCodenamesPlayerView(LOBBY, "p1"))!;
    expect(view.grid).toHaveLength(25);
  });

  it("starts in team_pick phase", async () => {
    const view = (await getCodenamesPlayerView(LOBBY, "p1"))!;
    expect(view.phase).toBe("team_pick");
  });

  it("red goes first", async () => {
    const view = (await getCodenamesPlayerView(LOBBY, "p1"))!;
    expect(view.currentTeam).toBe("red");
  });

  it("targets are 9 red and 8 blue", async () => {
    const view = (await getCodenamesPlayerView(LOBBY, "p1"))!;
    expect(view.targets).toEqual({ red: 9, blue: 8 });
  });

  it("scores start at zero", async () => {
    const view = (await getCodenamesPlayerView(LOBBY, "p1"))!;
    expect(view.scores).toEqual({ red: 0, blue: 0 });
  });

  it("game is not over at creation", async () => {
    const view = (await getCodenamesPlayerView(LOBBY, "p1"))!;
    expect(view.gameOver).toBe(false);
    expect(view.winner).toBeUndefined();
  });

  it("gameType is codenames", async () => {
    const view = (await getCodenamesPlayerView(LOBBY, "p1"))!;
    expect(view.gameType).toBe("codenames");
  });
});

// ── Player view ──────────────────────────────────────────────────────────────

describe("getCodenamesPlayerView", () => {
  it("returns null for non-existent game", async () => {
    expect(await getCodenamesPlayerView("nope", "p1")).toBeNull();
  });

  it("non-team player has no myTeam", async () => {
    const view = (await getCodenamesPlayerView(LOBBY, "p1"))!;
    expect(view.myTeam).toBeUndefined();
    expect(view.isSpymaster).toBe(false);
  });

  it("spymaster sees all card colors", async () => {
    await joinTeam(LOBBY, "p1", "red", true);
    const view = (await getCodenamesPlayerView(LOBBY, "p1"))!;
    const allHaveColor = view.grid.every(w => w.color !== undefined);
    expect(allHaveColor).toBe(true);
  });

  it("guesser does not see unrevealed card colors", async () => {
    await joinTeam(LOBBY, "p2", "red", false);
    const view = (await getCodenamesPlayerView(LOBBY, "p2"))!;
    const unrevealed = view.grid.filter(w => !w.revealed);
    const noneHaveColor = unrevealed.every(w => w.color === undefined);
    expect(noneHaveColor).toBe(true);
  });

  it("red spymaster has myTeam red and isSpymaster true", async () => {
    await joinTeam(LOBBY, "p1", "red", true);
    const view = (await getCodenamesPlayerView(LOBBY, "p1"))!;
    expect(view.myTeam).toBe("red");
    expect(view.isSpymaster).toBe(true);
  });

  it("blue guesser has myTeam blue and isSpymaster false", async () => {
    await joinTeam(LOBBY, "p4", "blue", false);
    const view = (await getCodenamesPlayerView(LOBBY, "p4"))!;
    expect(view.myTeam).toBe("blue");
    expect(view.isSpymaster).toBe(false);
  });

  it("teams are reflected in player view", async () => {
    await joinTeam(LOBBY, "p1", "red", true);
    await joinTeam(LOBBY, "p2", "red", false);
    const view = (await getCodenamesPlayerView(LOBBY, "p1"))!;
    expect(view.teams.red.spymaster).toBe("p1");
    expect(view.teams.red.guessers).toContain("p2");
  });
});

// ── Team selection ───────────────────────────────────────────────────────────

describe("joinTeam", () => {
  it("player can join as red guesser", async () => {
    const result = await joinTeam(LOBBY, "p2", "red", false);
    expect(result.success).toBe(true);
    const view = (await getCodenamesPlayerView(LOBBY, "p2"))!;
    expect(view.teams.red.guessers).toContain("p2");
  });

  it("player can join as spymaster", async () => {
    const result = await joinTeam(LOBBY, "p1", "red", true);
    expect(result.success).toBe(true);
    const view = (await getCodenamesPlayerView(LOBBY, "p1"))!;
    expect(view.teams.red.spymaster).toBe("p1");
  });

  it("cannot take occupied spymaster slot", async () => {
    await joinTeam(LOBBY, "p1", "red", true);
    const result = await joinTeam(LOBBY, "p2", "red", true);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/spymaster/i);
  });

  it("switching teams removes from old team", async () => {
    await joinTeam(LOBBY, "p1", "red", false);
    await joinTeam(LOBBY, "p1", "blue", false);
    const view = (await getCodenamesPlayerView(LOBBY, "p1"))!;
    expect(view.teams.red.guessers).not.toContain("p1");
    expect(view.teams.blue.guessers).toContain("p1");
  });

  it("switching from spymaster clears old spymaster slot", async () => {
    await joinTeam(LOBBY, "p1", "red", true);
    await joinTeam(LOBBY, "p1", "blue", false);
    const view = (await getCodenamesPlayerView(LOBBY, "p1"))!;
    expect(view.teams.red.spymaster).toBeUndefined();
    expect(view.teams.blue.guessers).toContain("p1");
  });

  it("multiple guessers on same team", async () => {
    await joinTeam(LOBBY, "p1", "red", false);
    await joinTeam(LOBBY, "p2", "red", false);
    const view = (await getCodenamesPlayerView(LOBBY, "p1"))!;
    expect(view.teams.red.guessers).toContain("p1");
    expect(view.teams.red.guessers).toContain("p2");
  });

  it("fails on non-existent game", async () => {
    const result = await joinTeam("nope", "p1", "red", false);
    expect(result.success).toBe(false);
  });

  it("fails outside team_pick phase", async () => {
    await setupTeamsAndStart();
    const result = await joinTeam(LOBBY, "p1", "blue", false);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/team pick/i);
  });
});

// ── Starting the round ───────────────────────────────────────────────────────

describe("startCodenamesRound", () => {
  it("starts when both teams have spymaster and guesser", async () => {
    await joinTeam(LOBBY, "p1", "red", true);
    await joinTeam(LOBBY, "p2", "red", false);
    await joinTeam(LOBBY, "p3", "blue", true);
    await joinTeam(LOBBY, "p4", "blue", false);
    const result = await startCodenamesRound(LOBBY);
    expect(result.success).toBe(true);
  });

  it("transitions to spymaster_clue phase", async () => {
    await setupTeamsAndStart();
    const view = (await getCodenamesPlayerView(LOBBY, "p1"))!;
    expect(view.phase).toBe("spymaster_clue");
  });

  it("fails without red spymaster", async () => {
    await joinTeam(LOBBY, "p2", "red", false);
    await joinTeam(LOBBY, "p3", "blue", true);
    await joinTeam(LOBBY, "p4", "blue", false);
    const result = await startCodenamesRound(LOBBY);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/spymaster/i);
  });

  it("fails without blue spymaster", async () => {
    await joinTeam(LOBBY, "p1", "red", true);
    await joinTeam(LOBBY, "p2", "red", false);
    await joinTeam(LOBBY, "p4", "blue", false);
    const result = await startCodenamesRound(LOBBY);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/spymaster/i);
  });

  it("fails without red guesser", async () => {
    await joinTeam(LOBBY, "p1", "red", true);
    await joinTeam(LOBBY, "p3", "blue", true);
    await joinTeam(LOBBY, "p4", "blue", false);
    const result = await startCodenamesRound(LOBBY);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/guesser/i);
  });

  it("fails without blue guesser", async () => {
    await joinTeam(LOBBY, "p1", "red", true);
    await joinTeam(LOBBY, "p2", "red", false);
    await joinTeam(LOBBY, "p3", "blue", true);
    const result = await startCodenamesRound(LOBBY);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/guesser/i);
  });

  it("fails on non-existent game", async () => {
    const result = await startCodenamesRound("nope");
    expect(result.success).toBe(false);
  });
});

// ── Giving clues ─────────────────────────────────────────────────────────────

describe("giveClue", () => {
  beforeEach(async () => { await setupTeamsAndStart(); });

  it("red spymaster can give a clue on red's turn", async () => {
    const result = await giveClue(LOBBY, "p1", "animal", 3);
    expect(result.success).toBe(true);
  });

  it("transitions to guessing phase after clue", async () => {
    await giveClue(LOBBY, "p1", "animal", 3);
    const view = (await getCodenamesPlayerView(LOBBY, "p2"))!;
    expect(view.phase).toBe("guessing");
  });

  it("clue is visible in player view", async () => {
    await giveClue(LOBBY, "p1", "animal", 3);
    const view = (await getCodenamesPlayerView(LOBBY, "p2"))!;
    expect(view.clue).toEqual({ word: "animal", count: 3, team: "red" });
  });

  it("guesses remaining is count + 1", async () => {
    await giveClue(LOBBY, "p1", "animal", 3);
    const view = (await getCodenamesPlayerView(LOBBY, "p2"))!;
    expect(view.guessesRemaining).toBe(4);
  });

  it("count 0 gives unlimited guesses", async () => {
    await giveClue(LOBBY, "p1", "none", 0);
    const view = (await getCodenamesPlayerView(LOBBY, "p2"))!;
    expect(view.guessesRemaining).toBe(99);
  });

  it("blue spymaster cannot give clue on red's turn", async () => {
    const result = await giveClue(LOBBY, "p3", "animal", 3);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not the current spymaster/i);
  });

  it("guesser cannot give clue", async () => {
    const result = await giveClue(LOBBY, "p2", "animal", 3);
    expect(result.success).toBe(false);
  });

  it("empty clue word is rejected", async () => {
    const result = await giveClue(LOBBY, "p1", "  ", 2);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/invalid/i);
  });

  it("negative count is rejected", async () => {
    const result = await giveClue(LOBBY, "p1", "animal", -1);
    expect(result.success).toBe(false);
  });

  it("count above 9 is rejected", async () => {
    const result = await giveClue(LOBBY, "p1", "animal", 10);
    expect(result.success).toBe(false);
  });

  it("clue word on the grid is rejected", async () => {
    const view = (await getCodenamesPlayerView(LOBBY, "p1"))!;
    const gridWord = view.grid[0].word;
    const result = await giveClue(LOBBY, "p1", gridWord, 2);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/grid/i);
  });

  it("clue word matching grid word case-insensitively is rejected", async () => {
    const view = (await getCodenamesPlayerView(LOBBY, "p1"))!;
    const gridWord = view.grid[0].word.toUpperCase();
    const result = await giveClue(LOBBY, "p1", gridWord, 2);
    expect(result.success).toBe(false);
  });

  it("fails on non-existent game", async () => {
    const result = await giveClue("nope", "p1", "animal", 3);
    expect(result.success).toBe(false);
  });

  it("fails outside clue phase", async () => {
    await giveClue(LOBBY, "p1", "animal", 3);
    // Now in guessing phase
    const result = await giveClue(LOBBY, "p1", "another", 2);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not clue phase/i);
  });

  it("sets lastAction with clue info", async () => {
    await giveClue(LOBBY, "p1", "animal", 3);
    const view = (await getCodenamesPlayerView(LOBBY, "p2"))!;
    expect(view.lastAction).toContain("animal");
    expect(view.lastAction).toContain("3");
  });
});

// ── Guessing words ───────────────────────────────────────────────────────────

describe("guessWord", () => {
  beforeEach(async () => {
    await setupTeamsAndStart();
    await giveClue(LOBBY, "p1", "animal", 3);
  });

  it("red guesser can guess a word", async () => {
    const idx = await findWordIndex("red");
    const result = await guessWord(LOBBY, "p2", idx);
    expect(result.success).toBe(true);
    expect(result.color).toBe("red");
  });

  it("correct guess reveals the word", async () => {
    const idx = await findWordIndex("red");
    await guessWord(LOBBY, "p2", idx);
    const view = (await getCodenamesPlayerView(LOBBY, "p2"))!;
    expect(view.grid[idx].revealed).toBe(true);
    expect(view.grid[idx].color).toBe("red");
  });

  it("correct guess increments team score", async () => {
    const idx = await findWordIndex("red");
    await guessWord(LOBBY, "p2", idx);
    const view = (await getCodenamesPlayerView(LOBBY, "p2"))!;
    expect(view.scores.red).toBe(1);
  });

  it("correct guess decrements guesses remaining", async () => {
    const idx = await findWordIndex("red");
    await guessWord(LOBBY, "p2", idx);
    const view = (await getCodenamesPlayerView(LOBBY, "p2"))!;
    expect(view.guessesRemaining).toBe(3);
  });

  it("guessing opponent's word increments their score and ends turn", async () => {
    const idx = await findWordIndex("blue");
    const result = await guessWord(LOBBY, "p2", idx);
    expect(result.success).toBe(true);
    expect(result.color).toBe("blue");
    expect(result.turnOver).toBe(true);

    const view = (await getCodenamesPlayerView(LOBBY, "p2"))!;
    expect(view.scores.blue).toBe(1);
  });

  it("guessing neutral word ends turn", async () => {
    const idx = await findWordIndex("neutral");
    const result = await guessWord(LOBBY, "p2", idx);
    expect(result.success).toBe(true);
    expect(result.color).toBe("neutral");
    expect(result.turnOver).toBe(true);
  });

  it("turn switches to other team after wrong guess", async () => {
    const idx = await findWordIndex("neutral");
    await guessWord(LOBBY, "p2", idx);
    const view = (await getCodenamesPlayerView(LOBBY, "p2"))!;
    expect(view.currentTeam).toBe("blue");
    expect(view.phase).toBe("spymaster_clue");
  });

  it("guessing assassin ends game — current team loses", async () => {
    const idx = await findWordIndex("assassin");
    const result = await guessWord(LOBBY, "p2", idx);
    expect(result.success).toBe(true);
    expect(result.color).toBe("assassin");
    expect(result.gameOver).toBe(true);

    const view = (await getCodenamesPlayerView(LOBBY, "p2"))!;
    expect(view.gameOver).toBe(true);
    expect(view.winner).toBe("blue");
    expect(view.phase).toBe("game_over");
  });

  it("running out of guesses switches turn", async () => {
    await cleanupCodenamesGame(LOBBY);
    await createCodenamesGame(LOBBY, PLAYERS, WORDS);
    await setupTeamsAndStart();
    await giveClue(LOBBY, "p1", "test", 1);

    const redIndices = await findAllWordIndices("red");
    await guessWord(LOBBY, "p2", redIndices[0]);
    const result = await guessWord(LOBBY, "p2", redIndices[1]);
    expect(result.turnOver).toBe(true);
  });

  it("blue guesser cannot guess on red's turn", async () => {
    const idx = await findWordIndex("red");
    const result = await guessWord(LOBBY, "p4", idx);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not your turn/i);
  });

  it("spymaster cannot guess", async () => {
    const idx = await findWordIndex("red");
    const result = await guessWord(LOBBY, "p1", idx);
    expect(result.success).toBe(false);
  });

  it("already revealed word is rejected", async () => {
    const idx = await findWordIndex("red");
    await guessWord(LOBBY, "p2", idx);
    const result = await guessWord(LOBBY, "p2", idx);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/already revealed/i);
  });

  it("out of bounds index is rejected", async () => {
    expect((await guessWord(LOBBY, "p2", -1)).success).toBe(false);
    expect((await guessWord(LOBBY, "p2", 25)).success).toBe(false);
  });

  it("fails outside guessing phase", async () => {
    const idx = await findWordIndex("neutral");
    await guessWord(LOBBY, "p2", idx);
    const result = await guessWord(LOBBY, "p4", 0);
    expect(result.success).toBe(false);
  });

  it("fails on non-existent game", async () => {
    const result = await guessWord("nope", "p2", 0);
    expect(result.success).toBe(false);
  });

  it("fails after game is over", async () => {
    const idx = await findWordIndex("assassin");
    await guessWord(LOBBY, "p2", idx);
    const result = await guessWord(LOBBY, "p2", 0);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not guessing phase|game is over/i);
  });
});

// ── Win conditions ───────────────────────────────────────────────────────────

describe("win conditions", () => {
  beforeEach(async () => { await setupTeamsAndStart(); });

  it("team wins by finding all their words", async () => {
    await giveClue(LOBBY, "p1", "everything", 9);

    const redIndices = await findAllWordIndices("red");
    for (let i = 0; i < redIndices.length; i++) {
      const result = await guessWord(LOBBY, "p2", redIndices[i]);
      if (i === redIndices.length - 1) {
        expect(result.gameOver).toBe(true);
        expect(result.color).toBe("red");
      }
    }

    const view = (await getCodenamesPlayerView(LOBBY, "p2"))!;
    expect(view.gameOver).toBe(true);
    expect(view.winner).toBe("red");
  });

  it("accidentally finding all opponent words wins for opponent", async () => {
    await giveClue(LOBBY, "p1", "oops", 9);

    const blueIndices = await findAllWordIndices("blue");
    for (let i = 0; i < blueIndices.length; i++) {
      const result = await guessWord(LOBBY, "p2", blueIndices[i]);
      if (i === blueIndices.length - 1) {
        expect(result.gameOver).toBe(true);
      }
      if (result.turnOver && !result.gameOver) {
        await giveClue(LOBBY, "p3", "skip", 0);
        await passTurn(LOBBY, "p4");
        await giveClue(LOBBY, "p1", "retry", 9);
      }
    }

    const view = (await getCodenamesPlayerView(LOBBY, "p2"))!;
    expect(view.gameOver).toBe(true);
    expect(view.winner).toBe("blue");
  });
});

// ── Pass turn ────────────────────────────────────────────────────────────────

describe("passTurn", () => {
  beforeEach(async () => {
    await setupTeamsAndStart();
    await giveClue(LOBBY, "p1", "animal", 3);
  });

  it("guesser can pass their turn", async () => {
    const result = await passTurn(LOBBY, "p2");
    expect(result.success).toBe(true);
  });

  it("passing switches to other team's spymaster clue phase", async () => {
    await passTurn(LOBBY, "p2");
    const view = (await getCodenamesPlayerView(LOBBY, "p2"))!;
    expect(view.currentTeam).toBe("blue");
    expect(view.phase).toBe("spymaster_clue");
    expect(view.clue).toBeNull();
  });

  it("non-current-team player cannot pass", async () => {
    const result = await passTurn(LOBBY, "p4");
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not your turn/i);
  });

  it("spymaster cannot pass", async () => {
    const result = await passTurn(LOBBY, "p1");
    expect(result.success).toBe(false);
  });

  it("fails outside guessing phase", async () => {
    await passTurn(LOBBY, "p2");
    const result = await passTurn(LOBBY, "p4");
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not guessing phase/i);
  });

  it("fails on non-existent game", async () => {
    const result = await passTurn("nope", "p2");
    expect(result.success).toBe(false);
  });

  it("sets lastAction indicating team passed", async () => {
    await passTurn(LOBBY, "p2");
    const view = (await getCodenamesPlayerView(LOBBY, "p2"))!;
    expect(view.lastAction).toMatch(/red.*passed/i);
  });
});

// ── Full turn cycle ──────────────────────────────────────────────────────────

describe("full turn cycle", () => {
  beforeEach(async () => { await setupTeamsAndStart(); });

  it("red clue → red guess → blue clue → blue guess", async () => {
    await giveClue(LOBBY, "p1", "animal", 1);
    expect((await getCodenamesPlayerView(LOBBY, "p2"))!.phase).toBe("guessing");

    await passTurn(LOBBY, "p2");
    expect((await getCodenamesPlayerView(LOBBY, "p2"))!.currentTeam).toBe("blue");
    expect((await getCodenamesPlayerView(LOBBY, "p2"))!.phase).toBe("spymaster_clue");

    await giveClue(LOBBY, "p3", "ocean", 2);
    expect((await getCodenamesPlayerView(LOBBY, "p4"))!.phase).toBe("guessing");

    await passTurn(LOBBY, "p4");
    expect((await getCodenamesPlayerView(LOBBY, "p4"))!.currentTeam).toBe("red");
    expect((await getCodenamesPlayerView(LOBBY, "p4"))!.phase).toBe("spymaster_clue");
  });
});

// ── Cleanup ──────────────────────────────────────────────────────────────────

describe("cleanupCodenamesGame", () => {
  it("removes the game", async () => {
    expect(await isCodenamesGame(LOBBY)).toBe(true);
    await cleanupCodenamesGame(LOBBY);
    expect(await isCodenamesGame(LOBBY)).toBe(false);
  });

  it("player view returns null after cleanup", async () => {
    await cleanupCodenamesGame(LOBBY);
    expect(await getCodenamesPlayerView(LOBBY, "p1")).toBeNull();
  });
});

// ── Scores ───────────────────────────────────────────────────────────────────

describe("getCodenamesScores", () => {
  it("returns null for non-existent game", async () => {
    expect(await getCodenamesScores("nope")).toBeNull();
  });

  it("returns 0 for all players when no winner", async () => {
    const scores = (await getCodenamesScores(LOBBY))!;
    for (const pid of PLAYERS) {
      expect(scores[pid]).toBe(0);
    }
  });

  it("winning team gets 1, losing team gets 0", async () => {
    await setupTeamsAndStart();
    await giveClue(LOBBY, "p1", "animal", 9);

    const idx = await findWordIndex("assassin");
    await guessWord(LOBBY, "p2", idx);

    const scores = (await getCodenamesScores(LOBBY))!;
    expect(scores["p3"]).toBe(1);
    expect(scores["p4"]).toBe(1);
    expect(scores["p1"]).toBe(0);
    expect(scores["p2"]).toBe(0);
  });
});

// ── Grid distribution ────────────────────────────────────────────────────────

describe("grid color distribution", () => {
  it("has 9 red, 8 blue, 7 neutral, 1 assassin", async () => {
    await joinTeam(LOBBY, "p1", "red", true);
    const view = (await getCodenamesPlayerView(LOBBY, "p1"))!;
    const counts = { red: 0, blue: 0, neutral: 0, assassin: 0 };
    for (const w of view.grid) {
      counts[w.color as keyof typeof counts]++;
    }
    expect(counts.red).toBe(9);
    expect(counts.blue).toBe(8);
    expect(counts.neutral).toBe(7);
    expect(counts.assassin).toBe(1);
  });
});

// ── Snapshot round-trip ──────────────────────────────────────────────────────

describe("exportCodenamesGames / restoreCodenamesGames", () => {
  it("returns empty array when no games exist", async () => {
    await cleanupCodenamesGame(LOBBY);
    expect(await exportCodenamesGames()).toEqual([]);
  });

  it("round-trips mid-game state through JSON", async () => {
    await setupTeamsAndStart();
    await giveClue(LOBBY, "p1", "animal", 2);
    const redIdx = await findWordIndex("red");
    await guessWord(LOBBY, "p2", redIdx);

    const beforeView = (await getCodenamesPlayerView(LOBBY, "p1"))!;
    const beforeScores = beforeView.scores;

    const snapshot = JSON.parse(JSON.stringify(await exportCodenamesGames()));
    await cleanupCodenamesGame(LOBBY);
    expect(await isCodenamesGame(LOBBY)).toBe(false);
    await restoreCodenamesGames(snapshot);

    expect(await isCodenamesGame(LOBBY)).toBe(true);
    const afterView = (await getCodenamesPlayerView(LOBBY, "p1"))!;
    expect(afterView.scores).toEqual(beforeScores);
    expect(afterView.currentTeam).toBe(beforeView.currentTeam);
    expect(afterView.phase).toBe(beforeView.phase);
    expect(afterView.clue).toEqual(beforeView.clue);
    expect(afterView.guessesRemaining).toBe(beforeView.guessesRemaining);
    expect(afterView.grid.filter(w => w.revealed).length)
      .toBe(beforeView.grid.filter(w => w.revealed).length);
  });

  it("preserves spymaster color visibility after restore", async () => {
    await setupTeamsAndStart();
    const beforeSpymasterView = (await getCodenamesPlayerView(LOBBY, "p1"))!;
    const snapshot = JSON.parse(JSON.stringify(await exportCodenamesGames()));
    await cleanupCodenamesGame(LOBBY);
    await restoreCodenamesGames(snapshot);
    const afterSpymasterView = (await getCodenamesPlayerView(LOBBY, "p1"))!;
    for (let i = 0; i < 25; i++) {
      expect(afterSpymasterView.grid[i].color).toBe(beforeSpymasterView.grid[i].color);
      expect(afterSpymasterView.grid[i].word).toBe(beforeSpymasterView.grid[i].word);
    }
  });

  it("restore overwrites an existing game with the same code", async () => {
    await setupTeamsAndStart();
    const snapshot = JSON.parse(JSON.stringify(await exportCodenamesGames()));
    snapshot[0].scores = { red: 99, blue: 99 };
    await restoreCodenamesGames(snapshot);
    const view = (await getCodenamesPlayerView(LOBBY, "p1"))!;
    expect(view.scores).toEqual({ red: 99, blue: 99 });
  });

  it("skips zombie games whose createdAt is more than 2 hours in the past", async () => {
    await setupTeamsAndStart();
    const exported = JSON.parse(JSON.stringify(await exportCodenamesGames()));
    exported[0].createdAt = Date.now() - (3 * 60 * 60 * 1000); // 3h old
    await cleanupCodenamesGame(LOBBY);
    await restoreCodenamesGames(exported);
    expect(await isCodenamesGame(LOBBY)).toBe(false);
  });
});
