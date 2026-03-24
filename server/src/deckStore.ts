import { randomUUID } from "crypto";
import type { ChaosCard, KnowledgeCard } from "./types.js";
import { CHAOS_CARDS, KNOWLEDGE_CARDS } from "./deck.js";
import pool from "./db.js";

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

// Built-in decks (always available, seeded to DB on startup)
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

export async function seedBuiltInDecks() {
  for (const deck of BUILT_IN_DECKS) {
    await pool.query(
      `INSERT INTO decks (id, name, description, chaos_cards, knowledge_cards, built_in, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, TRUE, $6, $7)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         chaos_cards = EXCLUDED.chaos_cards,
         knowledge_cards = EXCLUDED.knowledge_cards,
         updated_at = EXCLUDED.updated_at`,
      [
        deck.id,
        deck.name,
        deck.description,
        JSON.stringify(deck.chaosCards),
        JSON.stringify(deck.knowledgeCards),
        deck.createdAt,
        deck.updatedAt,
      ]
    );
  }
}

function rowToDeck(row: any): CustomDeck {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    chaosCards: row.chaos_cards,
    knowledgeCards: row.knowledge_cards,
    builtIn: row.built_in,
    createdAt: row.created_at?.toISOString?.() || row.created_at,
    updatedAt: row.updated_at?.toISOString?.() || row.updated_at,
  };
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

export async function listDecks(): Promise<DeckSummary[]> {
  const { rows } = await pool.query(
    `SELECT id, name, description, built_in,
            jsonb_array_length(chaos_cards) as chaos_count,
            jsonb_array_length(knowledge_cards) as knowledge_count
     FROM decks ORDER BY built_in DESC, created_at DESC`
  );
  return rows.map((r: any) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    chaosCount: parseInt(r.chaos_count),
    knowledgeCount: parseInt(r.knowledge_count),
    builtIn: r.built_in,
  }));
}

export async function getDeck(id: string): Promise<CustomDeck | null> {
  const { rows } = await pool.query("SELECT * FROM decks WHERE id = $1", [id]);
  if (rows.length === 0) return null;
  return rowToDeck(rows[0]);
}

export async function createDeck(input: {
  name: string;
  description?: string;
  chaosCards: { text: string; pick?: number }[];
  knowledgeCards: { text: string }[];
}): Promise<CustomDeck> {
  const id = randomUUID().slice(0, 8);
  const now = new Date().toISOString();

  const chaosCards = input.chaosCards.map((c, i) => ({
    id: `cc-${Date.now()}-${i}`,
    text: c.text.trim(),
    pick: c.pick || 1,
  }));
  const knowledgeCards = input.knowledgeCards.map((c, i) => ({
    id: `kc-${Date.now()}-${i}`,
    text: c.text.trim(),
  }));

  const { rows } = await pool.query(
    `INSERT INTO decks (id, name, description, chaos_cards, knowledge_cards, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [id, input.name.trim(), input.description?.trim() || "", JSON.stringify(chaosCards), JSON.stringify(knowledgeCards), now, now]
  );

  return rowToDeck(rows[0]);
}

export async function updateDeck(
  id: string,
  input: {
    name?: string;
    description?: string;
    chaosCards?: { text: string; pick?: number }[];
    knowledgeCards?: { text: string }[];
  }
): Promise<CustomDeck | null> {
  const existing = await getDeck(id);
  if (!existing) return null;

  const name = input.name !== undefined ? input.name.trim() : existing.name;
  const description = input.description !== undefined ? input.description.trim() : existing.description;
  const chaosCards = input.chaosCards
    ? input.chaosCards.map((c, i) => ({ id: `cc-${Date.now()}-${i}`, text: c.text.trim(), pick: c.pick || 1 }))
    : existing.chaosCards;
  const knowledgeCards = input.knowledgeCards
    ? input.knowledgeCards.map((c, i) => ({ id: `kc-${Date.now()}-${i}`, text: c.text.trim() }))
    : existing.knowledgeCards;

  const { rows } = await pool.query(
    `UPDATE decks SET name = $1, description = $2, chaos_cards = $3, knowledge_cards = $4, updated_at = NOW()
     WHERE id = $5 RETURNING *`,
    [name, description, JSON.stringify(chaosCards), JSON.stringify(knowledgeCards), id]
  );

  if (rows.length === 0) return null;
  return rowToDeck(rows[0]);
}

export async function deleteDeck(id: string): Promise<boolean> {
  const { rowCount } = await pool.query("DELETE FROM decks WHERE id = $1 AND built_in = FALSE", [id]);
  return (rowCount ?? 0) > 0;
}
