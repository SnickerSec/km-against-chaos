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
} from "../codenamesGame.js";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const LOBBY = "test-codenames-001";
const PLAYERS = ["p1", "p2", "p3", "p4"];

// 30 words — enough for the 25-word grid
const WORDS = Array.from({ length: 30 }, (_, i) => `word${i}`);

/** Set up teams with valid spymasters and guessers, then start the round. */
function setupTeamsAndStart() {
  joinTeam(LOBBY, "p1", "red", true);    // red spymaster
  joinTeam(LOBBY, "p2", "red", false);   // red guesser
  joinTeam(LOBBY, "p3", "blue", true);   // blue spymaster
  joinTeam(LOBBY, "p4", "blue", false);  // blue guesser
  startCodenamesRound(LOBBY);
}

/** Find the grid index of a word with a specific color (from spymaster view). */
function findWordIndex(color: string): number {
  const view = getCodenamesPlayerView(LOBBY, "p1")!; // p1 is red spymaster, sees all colors
  return view.grid.findIndex(w => w.color === color && !w.revealed);
}

/** Find all grid indices for a given color. */
function findAllWordIndices(color: string): number[] {
  const view = getCodenamesPlayerView(LOBBY, "p1")!;
  return view.grid
    .map((w, i) => (w.color === color && !w.revealed) ? i : -1)
    .filter(i => i >= 0);
}

// ── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  cleanupCodenamesGame(LOBBY);
  createCodenamesGame(LOBBY, PLAYERS, WORDS);
});

afterEach(() => {
  cleanupCodenamesGame(LOBBY);
});

// ── Game creation ────────────────────────────────────────────────────────────

describe("createCodenamesGame", () => {
  it("creates a game that can be found", () => {
    expect(isCodenamesGame(LOBBY)).toBe(true);
  });

  it("non-existent lobby returns false", () => {
    expect(isCodenamesGame("nope")).toBe(false);
  });

  it("grid has exactly 25 words", () => {
    const view = getCodenamesPlayerView(LOBBY, "p1")!;
    expect(view.grid).toHaveLength(25);
  });

  it("starts in team_pick phase", () => {
    const view = getCodenamesPlayerView(LOBBY, "p1")!;
    expect(view.phase).toBe("team_pick");
  });

  it("red goes first", () => {
    const view = getCodenamesPlayerView(LOBBY, "p1")!;
    expect(view.currentTeam).toBe("red");
  });

  it("targets are 9 red and 8 blue", () => {
    const view = getCodenamesPlayerView(LOBBY, "p1")!;
    expect(view.targets).toEqual({ red: 9, blue: 8 });
  });

  it("scores start at zero", () => {
    const view = getCodenamesPlayerView(LOBBY, "p1")!;
    expect(view.scores).toEqual({ red: 0, blue: 0 });
  });

  it("game is not over at creation", () => {
    const view = getCodenamesPlayerView(LOBBY, "p1")!;
    expect(view.gameOver).toBe(false);
    expect(view.winner).toBeUndefined();
  });

  it("gameType is codenames", () => {
    const view = getCodenamesPlayerView(LOBBY, "p1")!;
    expect(view.gameType).toBe("codenames");
  });
});

// ── Player view ──────────────────────────────────────────────────────────────

describe("getCodenamesPlayerView", () => {
  it("returns null for non-existent game", () => {
    expect(getCodenamesPlayerView("nope", "p1")).toBeNull();
  });

  it("non-team player has no myTeam", () => {
    const view = getCodenamesPlayerView(LOBBY, "p1")!;
    expect(view.myTeam).toBeUndefined();
    expect(view.isSpymaster).toBe(false);
  });

  it("spymaster sees all card colors", () => {
    joinTeam(LOBBY, "p1", "red", true);
    const view = getCodenamesPlayerView(LOBBY, "p1")!;
    // Every card should have a color since spymaster sees everything
    const allHaveColor = view.grid.every(w => w.color !== undefined);
    expect(allHaveColor).toBe(true);
  });

  it("guesser does not see unrevealed card colors", () => {
    joinTeam(LOBBY, "p2", "red", false);
    const view = getCodenamesPlayerView(LOBBY, "p2")!;
    // Unrevealed cards should not have color
    const unrevealed = view.grid.filter(w => !w.revealed);
    const noneHaveColor = unrevealed.every(w => w.color === undefined);
    expect(noneHaveColor).toBe(true);
  });

  it("red spymaster has myTeam red and isSpymaster true", () => {
    joinTeam(LOBBY, "p1", "red", true);
    const view = getCodenamesPlayerView(LOBBY, "p1")!;
    expect(view.myTeam).toBe("red");
    expect(view.isSpymaster).toBe(true);
  });

  it("blue guesser has myTeam blue and isSpymaster false", () => {
    joinTeam(LOBBY, "p4", "blue", false);
    const view = getCodenamesPlayerView(LOBBY, "p4")!;
    expect(view.myTeam).toBe("blue");
    expect(view.isSpymaster).toBe(false);
  });

  it("teams are reflected in player view", () => {
    joinTeam(LOBBY, "p1", "red", true);
    joinTeam(LOBBY, "p2", "red", false);
    const view = getCodenamesPlayerView(LOBBY, "p1")!;
    expect(view.teams.red.spymaster).toBe("p1");
    expect(view.teams.red.guessers).toContain("p2");
  });
});

// ── Team selection ───────────────────────────────────────────────────────────

describe("joinTeam", () => {
  it("player can join as red guesser", () => {
    const result = joinTeam(LOBBY, "p2", "red", false);
    expect(result.success).toBe(true);
    const view = getCodenamesPlayerView(LOBBY, "p2")!;
    expect(view.teams.red.guessers).toContain("p2");
  });

  it("player can join as spymaster", () => {
    const result = joinTeam(LOBBY, "p1", "red", true);
    expect(result.success).toBe(true);
    const view = getCodenamesPlayerView(LOBBY, "p1")!;
    expect(view.teams.red.spymaster).toBe("p1");
  });

  it("cannot take occupied spymaster slot", () => {
    joinTeam(LOBBY, "p1", "red", true);
    const result = joinTeam(LOBBY, "p2", "red", true);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/spymaster/i);
  });

  it("switching teams removes from old team", () => {
    joinTeam(LOBBY, "p1", "red", false);
    joinTeam(LOBBY, "p1", "blue", false);
    const view = getCodenamesPlayerView(LOBBY, "p1")!;
    expect(view.teams.red.guessers).not.toContain("p1");
    expect(view.teams.blue.guessers).toContain("p1");
  });

  it("switching from spymaster clears old spymaster slot", () => {
    joinTeam(LOBBY, "p1", "red", true);
    joinTeam(LOBBY, "p1", "blue", false);
    const view = getCodenamesPlayerView(LOBBY, "p1")!;
    expect(view.teams.red.spymaster).toBeUndefined();
    expect(view.teams.blue.guessers).toContain("p1");
  });

  it("multiple guessers on same team", () => {
    joinTeam(LOBBY, "p1", "red", false);
    joinTeam(LOBBY, "p2", "red", false);
    const view = getCodenamesPlayerView(LOBBY, "p1")!;
    expect(view.teams.red.guessers).toContain("p1");
    expect(view.teams.red.guessers).toContain("p2");
  });

  it("fails on non-existent game", () => {
    const result = joinTeam("nope", "p1", "red", false);
    expect(result.success).toBe(false);
  });

  it("fails outside team_pick phase", () => {
    setupTeamsAndStart();
    const result = joinTeam(LOBBY, "p1", "blue", false);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/team pick/i);
  });
});

// ── Starting the round ───────────────────────────────────────────────────────

describe("startCodenamesRound", () => {
  it("starts when both teams have spymaster and guesser", () => {
    joinTeam(LOBBY, "p1", "red", true);
    joinTeam(LOBBY, "p2", "red", false);
    joinTeam(LOBBY, "p3", "blue", true);
    joinTeam(LOBBY, "p4", "blue", false);
    const result = startCodenamesRound(LOBBY);
    expect(result.success).toBe(true);
  });

  it("transitions to spymaster_clue phase", () => {
    setupTeamsAndStart();
    const view = getCodenamesPlayerView(LOBBY, "p1")!;
    expect(view.phase).toBe("spymaster_clue");
  });

  it("fails without red spymaster", () => {
    joinTeam(LOBBY, "p2", "red", false);
    joinTeam(LOBBY, "p3", "blue", true);
    joinTeam(LOBBY, "p4", "blue", false);
    const result = startCodenamesRound(LOBBY);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/spymaster/i);
  });

  it("fails without blue spymaster", () => {
    joinTeam(LOBBY, "p1", "red", true);
    joinTeam(LOBBY, "p2", "red", false);
    joinTeam(LOBBY, "p4", "blue", false);
    const result = startCodenamesRound(LOBBY);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/spymaster/i);
  });

  it("fails without red guesser", () => {
    joinTeam(LOBBY, "p1", "red", true);
    joinTeam(LOBBY, "p3", "blue", true);
    joinTeam(LOBBY, "p4", "blue", false);
    const result = startCodenamesRound(LOBBY);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/guesser/i);
  });

  it("fails without blue guesser", () => {
    joinTeam(LOBBY, "p1", "red", true);
    joinTeam(LOBBY, "p2", "red", false);
    joinTeam(LOBBY, "p3", "blue", true);
    const result = startCodenamesRound(LOBBY);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/guesser/i);
  });

  it("fails on non-existent game", () => {
    const result = startCodenamesRound("nope");
    expect(result.success).toBe(false);
  });
});

// ── Giving clues ─────────────────────────────────────────────────────────────

describe("giveClue", () => {
  beforeEach(() => setupTeamsAndStart());

  it("red spymaster can give a clue on red's turn", () => {
    const result = giveClue(LOBBY, "p1", "animal", 3);
    expect(result.success).toBe(true);
  });

  it("transitions to guessing phase after clue", () => {
    giveClue(LOBBY, "p1", "animal", 3);
    const view = getCodenamesPlayerView(LOBBY, "p2")!;
    expect(view.phase).toBe("guessing");
  });

  it("clue is visible in player view", () => {
    giveClue(LOBBY, "p1", "animal", 3);
    const view = getCodenamesPlayerView(LOBBY, "p2")!;
    expect(view.clue).toEqual({ word: "animal", count: 3, team: "red" });
  });

  it("guesses remaining is count + 1", () => {
    giveClue(LOBBY, "p1", "animal", 3);
    const view = getCodenamesPlayerView(LOBBY, "p2")!;
    expect(view.guessesRemaining).toBe(4);
  });

  it("count 0 gives unlimited guesses", () => {
    giveClue(LOBBY, "p1", "none", 0);
    const view = getCodenamesPlayerView(LOBBY, "p2")!;
    expect(view.guessesRemaining).toBe(99);
  });

  it("blue spymaster cannot give clue on red's turn", () => {
    const result = giveClue(LOBBY, "p3", "animal", 3);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not the current spymaster/i);
  });

  it("guesser cannot give clue", () => {
    const result = giveClue(LOBBY, "p2", "animal", 3);
    expect(result.success).toBe(false);
  });

  it("empty clue word is rejected", () => {
    const result = giveClue(LOBBY, "p1", "  ", 2);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/invalid/i);
  });

  it("negative count is rejected", () => {
    const result = giveClue(LOBBY, "p1", "animal", -1);
    expect(result.success).toBe(false);
  });

  it("count above 9 is rejected", () => {
    const result = giveClue(LOBBY, "p1", "animal", 10);
    expect(result.success).toBe(false);
  });

  it("clue word on the grid is rejected", () => {
    const view = getCodenamesPlayerView(LOBBY, "p1")!;
    const gridWord = view.grid[0].word;
    const result = giveClue(LOBBY, "p1", gridWord, 2);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/grid/i);
  });

  it("clue word matching grid word case-insensitively is rejected", () => {
    const view = getCodenamesPlayerView(LOBBY, "p1")!;
    const gridWord = view.grid[0].word.toUpperCase();
    const result = giveClue(LOBBY, "p1", gridWord, 2);
    expect(result.success).toBe(false);
  });

  it("fails on non-existent game", () => {
    const result = giveClue("nope", "p1", "animal", 3);
    expect(result.success).toBe(false);
  });

  it("fails outside clue phase", () => {
    giveClue(LOBBY, "p1", "animal", 3);
    // Now in guessing phase
    const result = giveClue(LOBBY, "p1", "another", 2);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not clue phase/i);
  });

  it("sets lastAction with clue info", () => {
    giveClue(LOBBY, "p1", "animal", 3);
    const view = getCodenamesPlayerView(LOBBY, "p2")!;
    expect(view.lastAction).toContain("animal");
    expect(view.lastAction).toContain("3");
  });
});

// ── Guessing words ───────────────────────────────────────────────────────────

describe("guessWord", () => {
  beforeEach(() => {
    setupTeamsAndStart();
    giveClue(LOBBY, "p1", "animal", 3);
  });

  it("red guesser can guess a word", () => {
    const idx = findWordIndex("red");
    const result = guessWord(LOBBY, "p2", idx);
    expect(result.success).toBe(true);
    expect(result.color).toBe("red");
  });

  it("correct guess reveals the word", () => {
    const idx = findWordIndex("red");
    guessWord(LOBBY, "p2", idx);
    const view = getCodenamesPlayerView(LOBBY, "p2")!;
    expect(view.grid[idx].revealed).toBe(true);
    // Revealed word shows color even to non-spymaster
    expect(view.grid[idx].color).toBe("red");
  });

  it("correct guess increments team score", () => {
    const idx = findWordIndex("red");
    guessWord(LOBBY, "p2", idx);
    const view = getCodenamesPlayerView(LOBBY, "p2")!;
    expect(view.scores.red).toBe(1);
  });

  it("correct guess decrements guesses remaining", () => {
    const idx = findWordIndex("red");
    guessWord(LOBBY, "p2", idx);
    const view = getCodenamesPlayerView(LOBBY, "p2")!;
    expect(view.guessesRemaining).toBe(3); // was 4, now 3
  });

  it("guessing opponent's word increments their score and ends turn", () => {
    const idx = findWordIndex("blue");
    const result = guessWord(LOBBY, "p2", idx);
    expect(result.success).toBe(true);
    expect(result.color).toBe("blue");
    expect(result.turnOver).toBe(true);

    const view = getCodenamesPlayerView(LOBBY, "p2")!;
    expect(view.scores.blue).toBe(1);
  });

  it("guessing neutral word ends turn", () => {
    const idx = findWordIndex("neutral");
    const result = guessWord(LOBBY, "p2", idx);
    expect(result.success).toBe(true);
    expect(result.color).toBe("neutral");
    expect(result.turnOver).toBe(true);
  });

  it("turn switches to other team after wrong guess", () => {
    const idx = findWordIndex("neutral");
    guessWord(LOBBY, "p2", idx);
    const view = getCodenamesPlayerView(LOBBY, "p2")!;
    expect(view.currentTeam).toBe("blue");
    expect(view.phase).toBe("spymaster_clue");
  });

  it("guessing assassin ends game — current team loses", () => {
    const idx = findWordIndex("assassin");
    const result = guessWord(LOBBY, "p2", idx);
    expect(result.success).toBe(true);
    expect(result.color).toBe("assassin");
    expect(result.gameOver).toBe(true);

    const view = getCodenamesPlayerView(LOBBY, "p2")!;
    expect(view.gameOver).toBe(true);
    expect(view.winner).toBe("blue"); // red guessed assassin, so blue wins
    expect(view.phase).toBe("game_over");
  });

  it("running out of guesses switches turn", () => {
    // Give clue for 1 → gets 2 guesses
    cleanupCodenamesGame(LOBBY);
    createCodenamesGame(LOBBY, PLAYERS, WORDS);
    setupTeamsAndStart();
    giveClue(LOBBY, "p1", "test", 1);

    // Use both guesses on correct words
    const redIndices = findAllWordIndices("red");
    guessWord(LOBBY, "p2", redIndices[0]); // guess 1 — correct, 1 remaining
    const result = guessWord(LOBBY, "p2", redIndices[1]); // guess 2 — correct, 0 remaining
    expect(result.turnOver).toBe(true);
  });

  it("blue guesser cannot guess on red's turn", () => {
    const idx = findWordIndex("red");
    const result = guessWord(LOBBY, "p4", idx); // p4 is blue guesser
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not your turn/i);
  });

  it("spymaster cannot guess", () => {
    const idx = findWordIndex("red");
    const result = guessWord(LOBBY, "p1", idx); // p1 is red spymaster
    expect(result.success).toBe(false);
  });

  it("already revealed word is rejected", () => {
    const idx = findWordIndex("red");
    guessWord(LOBBY, "p2", idx);
    const result = guessWord(LOBBY, "p2", idx);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/already revealed/i);
  });

  it("out of bounds index is rejected", () => {
    expect(guessWord(LOBBY, "p2", -1).success).toBe(false);
    expect(guessWord(LOBBY, "p2", 25).success).toBe(false);
  });

  it("fails outside guessing phase", () => {
    // First end the turn so we're back to spymaster_clue
    const idx = findWordIndex("neutral");
    guessWord(LOBBY, "p2", idx);
    // Now in spymaster_clue for blue
    const result = guessWord(LOBBY, "p4", 0);
    expect(result.success).toBe(false);
  });

  it("fails on non-existent game", () => {
    const result = guessWord("nope", "p2", 0);
    expect(result.success).toBe(false);
  });

  it("fails after game is over", () => {
    const idx = findWordIndex("assassin");
    guessWord(LOBBY, "p2", idx);
    const result = guessWord(LOBBY, "p2", 0);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not guessing phase|game is over/i);
  });
});

// ── Win conditions ───────────────────────────────────────────────────────────

describe("win conditions", () => {
  beforeEach(() => setupTeamsAndStart());

  it("team wins by finding all their words", () => {
    giveClue(LOBBY, "p1", "everything", 9);

    const redIndices = findAllWordIndices("red");
    // Guess all 9 red words
    for (let i = 0; i < redIndices.length; i++) {
      const result = guessWord(LOBBY, "p2", redIndices[i]);
      if (i === redIndices.length - 1) {
        expect(result.gameOver).toBe(true);
        expect(result.color).toBe("red");
      }
    }

    const view = getCodenamesPlayerView(LOBBY, "p2")!;
    expect(view.gameOver).toBe(true);
    expect(view.winner).toBe("red");
  });

  it("accidentally finding all opponent words wins for opponent", () => {
    // Red guesses all blue words (8 blue words)
    giveClue(LOBBY, "p1", "oops", 9);

    const blueIndices = findAllWordIndices("blue");
    for (let i = 0; i < blueIndices.length; i++) {
      const result = guessWord(LOBBY, "p2", blueIndices[i]);
      if (i === blueIndices.length - 1) {
        // Last blue word found — blue wins
        expect(result.gameOver).toBe(true);
      }
      // After first wrong guess, turn switches — need to re-setup for red's turn
      if (result.turnOver && !result.gameOver) {
        // Blue's turn now, give clue and pass back
        giveClue(LOBBY, "p3", "skip", 0);
        passTurn(LOBBY, "p4");
        giveClue(LOBBY, "p1", "retry", 9);
      }
    }

    const view = getCodenamesPlayerView(LOBBY, "p2")!;
    expect(view.gameOver).toBe(true);
    expect(view.winner).toBe("blue");
  });
});

// ── Pass turn ────────────────────────────────────────────────────────────────

describe("passTurn", () => {
  beforeEach(() => {
    setupTeamsAndStart();
    giveClue(LOBBY, "p1", "animal", 3);
  });

  it("guesser can pass their turn", () => {
    const result = passTurn(LOBBY, "p2");
    expect(result.success).toBe(true);
  });

  it("passing switches to other team's spymaster clue phase", () => {
    passTurn(LOBBY, "p2");
    const view = getCodenamesPlayerView(LOBBY, "p2")!;
    expect(view.currentTeam).toBe("blue");
    expect(view.phase).toBe("spymaster_clue");
    expect(view.clue).toBeNull();
  });

  it("non-current-team player cannot pass", () => {
    const result = passTurn(LOBBY, "p4"); // blue guesser, but it's red's turn
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not your turn/i);
  });

  it("spymaster cannot pass", () => {
    const result = passTurn(LOBBY, "p1"); // red spymaster
    expect(result.success).toBe(false);
  });

  it("fails outside guessing phase", () => {
    passTurn(LOBBY, "p2"); // now in blue spymaster_clue
    const result = passTurn(LOBBY, "p4");
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not guessing phase/i);
  });

  it("fails on non-existent game", () => {
    const result = passTurn("nope", "p2");
    expect(result.success).toBe(false);
  });

  it("sets lastAction indicating team passed", () => {
    passTurn(LOBBY, "p2");
    const view = getCodenamesPlayerView(LOBBY, "p2")!;
    expect(view.lastAction).toMatch(/red.*passed/i);
  });
});

// ── Full turn cycle ──────────────────────────────────────────────────────────

describe("full turn cycle", () => {
  beforeEach(() => setupTeamsAndStart());

  it("red clue → red guess → blue clue → blue guess", () => {
    // Red spymaster gives clue
    giveClue(LOBBY, "p1", "animal", 1);
    expect(getCodenamesPlayerView(LOBBY, "p2")!.phase).toBe("guessing");

    // Red guesser passes
    passTurn(LOBBY, "p2");
    expect(getCodenamesPlayerView(LOBBY, "p2")!.currentTeam).toBe("blue");
    expect(getCodenamesPlayerView(LOBBY, "p2")!.phase).toBe("spymaster_clue");

    // Blue spymaster gives clue
    giveClue(LOBBY, "p3", "ocean", 2);
    expect(getCodenamesPlayerView(LOBBY, "p4")!.phase).toBe("guessing");

    // Blue guesser passes
    passTurn(LOBBY, "p4");
    expect(getCodenamesPlayerView(LOBBY, "p4")!.currentTeam).toBe("red");
    expect(getCodenamesPlayerView(LOBBY, "p4")!.phase).toBe("spymaster_clue");
  });
});

// ── Cleanup ──────────────────────────────────────────────────────────────────

describe("cleanupCodenamesGame", () => {
  it("removes the game", () => {
    expect(isCodenamesGame(LOBBY)).toBe(true);
    cleanupCodenamesGame(LOBBY);
    expect(isCodenamesGame(LOBBY)).toBe(false);
  });

  it("player view returns null after cleanup", () => {
    cleanupCodenamesGame(LOBBY);
    expect(getCodenamesPlayerView(LOBBY, "p1")).toBeNull();
  });
});

// ── Scores ───────────────────────────────────────────────────────────────────

describe("getCodenamesScores", () => {
  it("returns null for non-existent game", () => {
    expect(getCodenamesScores("nope")).toBeNull();
  });

  it("returns 0 for all players when no winner", () => {
    const scores = getCodenamesScores(LOBBY)!;
    for (const pid of PLAYERS) {
      expect(scores[pid]).toBe(0);
    }
  });

  it("winning team gets 1, losing team gets 0", () => {
    setupTeamsAndStart();
    giveClue(LOBBY, "p1", "animal", 9);

    // Red guesses assassin — blue wins
    const idx = findWordIndex("assassin");
    guessWord(LOBBY, "p2", idx);

    const scores = getCodenamesScores(LOBBY)!;
    // Blue team (p3, p4) won
    expect(scores["p3"]).toBe(1);
    expect(scores["p4"]).toBe(1);
    // Red team (p1, p2) lost
    expect(scores["p1"]).toBe(0);
    expect(scores["p2"]).toBe(0);
  });
});

// ── Grid distribution ────────────────────────────────────────────────────────

describe("grid color distribution", () => {
  it("has 9 red, 8 blue, 7 neutral, 1 assassin", () => {
    // Use spymaster view to count colors
    joinTeam(LOBBY, "p1", "red", true);
    const view = getCodenamesPlayerView(LOBBY, "p1")!;
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
