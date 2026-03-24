import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import type { ChaosCard, KnowledgeCard } from "./types.js";
import { CHAOS_CARDS, KNOWLEDGE_CARDS } from "./deck.js";

const DATA_DIR = join(process.cwd(), "data");
const DECKS_FILE = join(DATA_DIR, "decks.json");

const MIN_CHAOS_CARDS = 5;
const MIN_KNOWLEDGE_CARDS = 15;

export interface CustomDeck {
  id: string;
  name: string;
  description: string;
  chaosCards: ChaosCard[];
  knowledgeCards: KnowledgeCard[];
  createdAt: string;
  updatedAt: string;
  builtIn?: boolean;
}

export interface DeckSummary {
  id: string;
  name: string;
  description: string;
  chaosCount: number;
  knowledgeCount: number;
  builtIn?: boolean;
}

// Built-in decks that always appear
const BUILT_IN_DECKS: CustomDeck[] = [
  {
    id: "km-against-chaos",
    name: "KM Against Chaos",
    description: "A party game for Knowledge Management nerds. Chaos prompts meet Knowledge answers.",
    chaosCards: CHAOS_CARDS,
    knowledgeCards: KNOWLEDGE_CARDS,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    builtIn: true,
  },
];

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadDecks(): CustomDeck[] {
  ensureDataDir();
  if (!existsSync(DECKS_FILE)) return [];
  try {
    return JSON.parse(readFileSync(DECKS_FILE, "utf-8"));
  } catch {
    return [];
  }
}

function saveDecks(decks: CustomDeck[]) {
  ensureDataDir();
  writeFileSync(DECKS_FILE, JSON.stringify(decks, null, 2));
}

export function validateDeck(deck: {
  name?: string;
  chaosCards?: { text: string; pick?: number }[];
  knowledgeCards?: { text: string }[];
}): string | null {
  if (!deck.name || deck.name.trim().length === 0) {
    return "Deck name is required";
  }
  if (!deck.chaosCards || deck.chaosCards.length < MIN_CHAOS_CARDS) {
    return `Need at least ${MIN_CHAOS_CARDS} Chaos cards (prompts)`;
  }
  if (!deck.knowledgeCards || deck.knowledgeCards.length < MIN_KNOWLEDGE_CARDS) {
    return `Need at least ${MIN_KNOWLEDGE_CARDS} Knowledge cards (answers)`;
  }
  for (const card of deck.chaosCards) {
    if (!card.text || card.text.trim().length === 0) {
      return "All Chaos cards must have text";
    }
  }
  for (const card of deck.knowledgeCards) {
    if (!card.text || card.text.trim().length === 0) {
      return "All Knowledge cards must have text";
    }
  }
  return null;
}

export function listDecks(): DeckSummary[] {
  const allDecks = [...BUILT_IN_DECKS, ...loadDecks()];
  return allDecks.map((d) => ({
    id: d.id,
    name: d.name,
    description: d.description,
    chaosCount: d.chaosCards.length,
    knowledgeCount: d.knowledgeCards.length,
    builtIn: d.builtIn,
  }));
}

export function getDeck(id: string): CustomDeck | null {
  const builtIn = BUILT_IN_DECKS.find((d) => d.id === id);
  if (builtIn) return builtIn;
  return loadDecks().find((d) => d.id === id) || null;
}

export function createDeck(input: {
  name: string;
  description?: string;
  chaosCards: { text: string; pick?: number }[];
  knowledgeCards: { text: string }[];
}): CustomDeck {
  const decks = loadDecks();
  const now = new Date().toISOString();

  const deck: CustomDeck = {
    id: randomUUID().slice(0, 8),
    name: input.name.trim(),
    description: input.description?.trim() || "",
    chaosCards: input.chaosCards.map((c, i) => ({
      id: `cc-${Date.now()}-${i}`,
      text: c.text.trim(),
      pick: c.pick || 1,
    })),
    knowledgeCards: input.knowledgeCards.map((c, i) => ({
      id: `kc-${Date.now()}-${i}`,
      text: c.text.trim(),
    })),
    createdAt: now,
    updatedAt: now,
  };

  decks.push(deck);
  saveDecks(decks);
  return deck;
}

export function updateDeck(
  id: string,
  input: {
    name?: string;
    description?: string;
    chaosCards?: { text: string; pick?: number }[];
    knowledgeCards?: { text: string }[];
  }
): CustomDeck | null {
  const decks = loadDecks();
  const idx = decks.findIndex((d) => d.id === id);
  if (idx === -1) return null;

  const deck = decks[idx];
  const now = new Date().toISOString();

  if (input.name !== undefined) deck.name = input.name.trim();
  if (input.description !== undefined) deck.description = input.description.trim();
  if (input.chaosCards) {
    deck.chaosCards = input.chaosCards.map((c, i) => ({
      id: `cc-${Date.now()}-${i}`,
      text: c.text.trim(),
      pick: c.pick || 1,
    }));
  }
  if (input.knowledgeCards) {
    deck.knowledgeCards = input.knowledgeCards.map((c, i) => ({
      id: `kc-${Date.now()}-${i}`,
      text: c.text.trim(),
    }));
  }
  deck.updatedAt = now;

  decks[idx] = deck;
  saveDecks(decks);
  return deck;
}

export function deleteDeck(id: string): boolean {
  const decks = loadDecks();
  const filtered = decks.filter((d) => d.id !== id);
  if (filtered.length === decks.length) return false;
  saveDecks(filtered);
  return true;
}
