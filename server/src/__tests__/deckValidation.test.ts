import { describe, it, expect } from "vitest";
import { validateDeck } from "../deckStore.js";

// validateDeck is pure — no DB needed. We mock the pool import so the module loads.
// vitest.config already strips .js extensions, and deckStore imports db.js at top level.

const chaos = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ text: `Chaos ${i}`, pick: 1 }));
const knowledge = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ text: `Knowledge ${i}` }));

describe("validateDeck", () => {
  it("valid CAH deck returns null", () => {
    expect(
      validateDeck({ name: "Test", chaosCards: chaos(5), knowledgeCards: knowledge(15) })
    ).toBeNull();
  });

  it("rejects missing name", () => {
    expect(validateDeck({ name: "", chaosCards: chaos(5), knowledgeCards: knowledge(15) })).toMatch(
      /name/i
    );
  });

  it("rejects too few chaos cards", () => {
    expect(
      validateDeck({ name: "Test", chaosCards: chaos(4), knowledgeCards: knowledge(15) })
    ).toMatch(/chaos/i);
  });

  it("rejects too few knowledge cards", () => {
    expect(
      validateDeck({ name: "Test", chaosCards: chaos(5), knowledgeCards: knowledge(14) })
    ).toMatch(/knowledge/i);
  });

  it("rejects chaos card with empty text", () => {
    const cards = chaos(5);
    cards[2].text = "";
    expect(validateDeck({ name: "Test", chaosCards: cards, knowledgeCards: knowledge(15) })).toMatch(
      /chaos.*text/i
    );
  });

  it("rejects knowledge card with empty text", () => {
    const cards = knowledge(15);
    cards[0].text = "  ";
    expect(validateDeck({ name: "Test", chaosCards: chaos(5), knowledgeCards: cards })).toMatch(
      /knowledge.*text/i
    );
  });

  it("uno decks skip card validation", () => {
    expect(validateDeck({ name: "Uno Deck", gameType: "uno" })).toBeNull();
  });

  it("uno decks still require a name", () => {
    expect(validateDeck({ name: "", gameType: "uno" })).toMatch(/name/i);
  });
});
