import { randomUUID } from "crypto";
import type { ChaosCard, KnowledgeCard } from "./types.js";
import { CHAOS_CARDS, KNOWLEDGE_CARDS } from "./deck.js";
import pool from "./db.js";

const MIN_CHAOS_CARDS = 5;
const MIN_KNOWLEDGE_CARDS = 15;

export interface WinCondition {
  mode: "rounds" | "points";
  value: number; // max rounds or target points
}

export interface CustomDeck {
  id: string;
  name: string;
  description: string;
  chaosCards: ChaosCard[];
  knowledgeCards: KnowledgeCard[];
  winCondition: WinCondition;
  createdAt: string;
  updatedAt: string;
  builtIn?: boolean;
  ownerId?: string | null;
}

export interface DeckSummary {
  id: string;
  name: string;
  description: string;
  chaosCount: number;
  knowledgeCount: number;
  winCondition: WinCondition;
  builtIn?: boolean;
  ownerId?: string | null;
}

const DEFAULT_WIN_CONDITION: WinCondition = { mode: "rounds", value: 10 };

// Built-in decks (always available, seeded to DB on startup)
const BUILT_IN_DECKS: CustomDeck[] = [
  {
    id: "km-against-chaos",
    name: "KM Against Chaos",
    description: "A party game for Knowledge Management nerds. Chaos prompts meet Knowledge answers.",
    chaosCards: CHAOS_CARDS,
    knowledgeCards: KNOWLEDGE_CARDS,
    winCondition: { mode: "rounds", value: 10 },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    builtIn: true,
  },
];

export async function seedBuiltInDecks() {
  for (const deck of BUILT_IN_DECKS) {
    await pool.query(
      `INSERT INTO decks (id, name, description, chaos_cards, knowledge_cards, win_condition, built_in, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, TRUE, $7, $8)
       ON CONFLICT (id) DO NOTHING`,
      [
        deck.id,
        deck.name,
        deck.description,
        JSON.stringify(deck.chaosCards),
        JSON.stringify(deck.knowledgeCards),
        JSON.stringify(deck.winCondition),
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
    winCondition: row.win_condition || DEFAULT_WIN_CONDITION,
    builtIn: row.built_in,
    ownerId: row.owner_id || null,
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
    `SELECT id, name, description, built_in, win_condition, owner_id,
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
    winCondition: r.win_condition || DEFAULT_WIN_CONDITION,
    builtIn: r.built_in,
    ownerId: r.owner_id || null,
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
  winCondition?: WinCondition;
  ownerId?: string;
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

  const winCondition = input.winCondition || DEFAULT_WIN_CONDITION;

  const { rows } = await pool.query(
    `INSERT INTO decks (id, name, description, chaos_cards, knowledge_cards, win_condition, owner_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [id, input.name.trim(), input.description?.trim() || "", JSON.stringify(chaosCards), JSON.stringify(knowledgeCards), JSON.stringify(winCondition), input.ownerId || null, now, now]
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
    winCondition?: WinCondition;
  },
  ownerId?: string
): Promise<CustomDeck | null> {
  const existing = await getDeck(id);
  if (!existing) return null;
  if (existing.ownerId && ownerId && existing.ownerId !== ownerId) return null;

  const name = input.name !== undefined ? input.name.trim() : existing.name;
  const description = input.description !== undefined ? input.description.trim() : existing.description;
  const chaosCards = input.chaosCards
    ? input.chaosCards.map((c, i) => ({ id: `cc-${Date.now()}-${i}`, text: c.text.trim(), pick: c.pick || 1 }))
    : existing.chaosCards;
  const knowledgeCards = input.knowledgeCards
    ? input.knowledgeCards.map((c, i) => ({ id: `kc-${Date.now()}-${i}`, text: c.text.trim() }))
    : existing.knowledgeCards;
  const winCondition = input.winCondition || existing.winCondition;

  const { rows } = await pool.query(
    `UPDATE decks SET name = $1, description = $2, chaos_cards = $3, knowledge_cards = $4, win_condition = $5, updated_at = NOW()
     WHERE id = $6 AND (owner_id = $7 OR owner_id IS NULL) RETURNING *`,
    [name, description, JSON.stringify(chaosCards), JSON.stringify(knowledgeCards), JSON.stringify(winCondition), id, ownerId]
  );

  if (rows.length === 0) return null;
  return rowToDeck(rows[0]);
}

export async function deleteDeck(id: string, ownerId?: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    "DELETE FROM decks WHERE id = $1 AND built_in = FALSE AND owner_id = $2",
    [id, ownerId]
  );
  return (rowCount ?? 0) > 0;
}
