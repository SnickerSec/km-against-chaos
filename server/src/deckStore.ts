import { randomUUID } from "crypto";
import type { ChaosCard, KnowledgeCard, GameType } from "./types.js";
import pool from "./db.js";
import { createLogger } from "./logger.js";

const log = createLogger("deck");

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
  // 4-Pillar recipe fields
  maturity?: string;
  flavorThemes?: string[];
  chaosLevel?: number;
  wildcard?: string;
  remixedFrom?: string | null;
  gameType?: GameType;
  artTier?: string;
  artGenerationStatus?: string | null;
  artStyle?: string | null;
  cardBackUrl?: string | null;
  voiceId?: string | null;
  soundOverrides?: Record<string, string> | null;
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
  ownerName?: string | null;
  maturity?: string;
  flavorThemes?: string[];
  chaosLevel?: number;
  wildcard?: string;
  remixedFrom?: string | null;
  gameType?: GameType;
  playCount?: number;
  avgRating?: number;
  artTier?: string;
  artGenerationStatus?: string | null;
  artStyle?: string | null;
  cardBackUrl?: string | null;
}

const DEFAULT_WIN_CONDITION: WinCondition = { mode: "rounds", value: 10 };

// No built-in decks — all decks are managed via the admin panel
const BUILT_IN_DECKS: CustomDeck[] = [];

export async function seedBuiltInDecks() {
  // No-op: built-in seeding removed. Use admin panel to feature decks.
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
    maturity: row.maturity || "adult",
    flavorThemes: row.flavor_themes || [],
    chaosLevel: row.chaos_level ?? 0,
    wildcard: row.wildcard || "",
    remixedFrom: row.remixed_from || null,
    gameType: (row.game_type as GameType) || "cah",
    artTier: row.art_tier || "free",
    artGenerationStatus: row.art_generation_status || null,
    artStyle: row.art_style || null,
    cardBackUrl: row.card_back_url || null,
    voiceId: row.voice_id || null,
    soundOverrides: row.sound_overrides || null,
  };
}

export function validateDeck(deck: {
  name?: string;
  chaosCards?: { text: string; pick?: number }[];
  knowledgeCards?: { text: string }[];
  gameType?: string;
}, options?: { isAdmin?: boolean }): string | null {
  const minChaos = options?.isAdmin ? 1 : MIN_CHAOS_CARDS;
  const minKnowledge = options?.isAdmin ? 1 : MIN_KNOWLEDGE_CARDS;
  if (!deck.name || deck.name.trim().length === 0) {
    return "Deck name is required";
  }
  // Uno decks store a template instead of cards; Blackjack has no cards at
  // all (built-in rules) — skip card validation for both.
  if (deck.gameType === "uno" || deck.gameType === "blackjack") {
    return null;
  }
  if (!deck.chaosCards || deck.chaosCards.length < minChaos) {
    return `Need at least ${minChaos} Chaos cards (prompts)`;
  }
  if (!deck.knowledgeCards || deck.knowledgeCards.length < minKnowledge) {
    return `Need at least ${minKnowledge} Knowledge cards (answers)`;
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

function builtInDeckSummaries(): DeckSummary[] {
  return BUILT_IN_DECKS.map((d) => ({
    id: d.id,
    name: d.name,
    description: d.description,
    chaosCount: d.chaosCards.length,
    knowledgeCount: d.knowledgeCards.length,
    winCondition: d.winCondition,
    builtIn: true,
  }));
}

export async function listDecks(options?: { search?: string; gameType?: string; sort?: string; maturity?: string }): Promise<DeckSummary[]> {
  try {
    const conditions: string[] = [];
    const params: any[] = [];
    let paramIdx = 1;

    if (options?.search) {
      conditions.push(`(d.name ILIKE $${paramIdx} OR d.description ILIKE $${paramIdx} OR u.name ILIKE $${paramIdx})`);
      params.push(`%${options.search}%`);
      paramIdx++;
    }

    if (options?.gameType) {
      conditions.push(`d.game_type = $${paramIdx}`);
      params.push(options.gameType);
      paramIdx++;
    }

    if (options?.maturity) {
      conditions.push(`d.maturity = $${paramIdx}`);
      params.push(options.maturity);
      paramIdx++;
    }

    conditions.push(`(d.draft IS NULL OR d.draft = FALSE)`);
    const whereClause = `WHERE ${conditions.join(" AND ")}`;

    let orderBy: string;
    switch (options?.sort) {
      case "newest":
        orderBy = "d.created_at DESC";
        break;
      case "popular":
        orderBy = "d.built_in DESC, COALESCE(d.play_count, 0) DESC, d.created_at DESC";
        break;
      case "rating":
        orderBy = "d.built_in DESC, COALESCE(d.avg_rating, 0) DESC, d.created_at DESC";
        break;
      default:
        orderBy = "d.built_in DESC, d.created_at DESC";
    }

    const { rows } = await pool.query(
      `SELECT d.id, d.name, d.description, d.built_in, d.win_condition, d.owner_id,
              d.maturity, d.flavor_themes, d.chaos_level, d.wildcard, d.remixed_from, d.game_type,
              d.play_count, d.avg_rating, d.card_back_url,
              jsonb_array_length(d.chaos_cards) as chaos_count,
              jsonb_array_length(d.knowledge_cards) as knowledge_count,
              u.name as owner_name
       FROM decks d
       LEFT JOIN users u ON d.owner_id = u.id
       ${whereClause}
       ORDER BY ${orderBy}`,
      params
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
      ownerName: r.owner_name || null,
      maturity: r.maturity || "adult",
      flavorThemes: r.flavor_themes || [],
      chaosLevel: r.chaos_level ?? 0,
      wildcard: r.wildcard || "",
      remixedFrom: r.remixed_from || null,
      gameType: (r.game_type as GameType) || "cah",
      playCount: parseInt(r.play_count) || 0,
      avgRating: parseFloat(r.avg_rating) || 0,
      cardBackUrl: r.card_back_url || null,
    }));
  } catch (err) {
    log.error("listDecks query failed, returning built-in decks", { error: String(err) });
    return builtInDeckSummaries();
  }
}

export async function getDeck(id: string): Promise<CustomDeck | null> {
  try {
    const { rows } = await pool.query("SELECT * FROM decks WHERE id = $1", [id]);
    if (rows.length === 0) return null;
    return rowToDeck(rows[0]);
  } catch (err) {
    log.error("getDeck query failed, checking built-in decks", { error: String(err) });
    return BUILT_IN_DECKS.find((d) => d.id === id) || null;
  }
}

export async function createDeck(input: {
  name: string;
  description?: string;
  chaosCards: { text: string; pick?: number; metaType?: string; metaEffect?: any; bonus?: boolean }[];
  knowledgeCards: { text: string }[];
  winCondition?: WinCondition;
  ownerId?: string;
  maturity?: string;
  flavorThemes?: string[];
  chaosLevel?: number;
  wildcard?: string;
  remixedFrom?: string;
  gameType?: GameType;
  draft?: boolean;
  artStyle?: string | null;
}): Promise<CustomDeck> {
  const id = randomUUID().slice(0, 8);
  const now = new Date().toISOString();

  const chaosCards = input.chaosCards.map((c, i) => ({
    id: `cc-${Date.now()}-${i}`,
    text: c.text.trim(),
    pick: c.pick || 1,
    ...(c.metaType ? { metaType: c.metaType } : {}),
    ...(c.metaEffect ? { metaEffect: c.metaEffect } : {}),
    ...(c.bonus ? { bonus: true } : {}),
  }));
  const knowledgeCards = input.knowledgeCards.map((c, i) => ({
    id: `kc-${Date.now()}-${i}`,
    text: c.text.trim(),
  }));

  const winCondition = input.winCondition || DEFAULT_WIN_CONDITION;

  const { rows } = await pool.query(
    `INSERT INTO decks (id, name, description, chaos_cards, knowledge_cards, win_condition, owner_id,
       maturity, flavor_themes, chaos_level, wildcard, remixed_from, game_type, draft, art_style, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
     RETURNING *`,
    [
      id,
      input.name.trim(),
      input.description?.trim() || "",
      JSON.stringify(chaosCards),
      JSON.stringify(knowledgeCards),
      JSON.stringify(winCondition),
      input.ownerId || null,
      input.maturity || "adult",
      JSON.stringify(input.flavorThemes || []),
      input.chaosLevel ?? 0,
      input.wildcard || "",
      input.remixedFrom || null,
      input.gameType || "cah",
      input.draft ?? false,
      input.artStyle || null,
      now,
      now,
    ]
  );

  return rowToDeck(rows[0]);
}

export async function remixDeck(sourceId: string, ownerId: string): Promise<CustomDeck> {
  const source = await getDeck(sourceId);
  if (!source) throw new Error("Source deck not found");

  return createDeck({
    name: `Remix of ${source.name}`,
    description: source.description,
    chaosCards: source.chaosCards,
    knowledgeCards: source.knowledgeCards,
    winCondition: source.winCondition,
    ownerId,
    maturity: source.maturity,
    flavorThemes: source.flavorThemes,
    chaosLevel: source.chaosLevel,
    wildcard: source.wildcard,
    remixedFrom: sourceId,
    gameType: source.gameType,
    artStyle: source.artStyle,
  });
}

export async function updateDeck(
  id: string,
  input: {
    name?: string;
    description?: string;
    chaosCards?: { text: string; pick?: number; metaType?: string; metaEffect?: any; bonus?: boolean }[];
    knowledgeCards?: { text: string }[];
    winCondition?: WinCondition;
    maturity?: string;
    flavorThemes?: string[];
    chaosLevel?: number;
    wildcard?: string;
    gameType?: GameType;
    draft?: boolean;
    artStyle?: string | null;
    voiceId?: string | null;
    soundOverrides?: Record<string, string | null> | null;
  },
  ownerId?: string,
  bypassOwnership?: boolean
): Promise<CustomDeck | null> {
  const existing = await getDeck(id);
  if (!existing) return null;
  if (!bypassOwnership && existing.ownerId && ownerId && existing.ownerId !== ownerId) return null;

  const name = input.name !== undefined ? input.name.trim() : existing.name;
  const description = input.description !== undefined ? input.description.trim() : existing.description;
  const chaosCards = input.chaosCards
    ? input.chaosCards.map((c, i) => ({
        id: `cc-${Date.now()}-${i}`,
        text: c.text.trim(),
        pick: c.pick || 1,
        ...(c.metaType ? { metaType: c.metaType } : {}),
        ...(c.metaEffect ? { metaEffect: c.metaEffect } : {}),
        ...(c.bonus ? { bonus: true } : {}),
      }))
    : existing.chaosCards;
  const knowledgeCards = input.knowledgeCards
    ? input.knowledgeCards.map((c, i) => ({ id: `kc-${Date.now()}-${i}`, text: c.text.trim() }))
    : existing.knowledgeCards;
  const winCondition = input.winCondition || existing.winCondition;
  const maturity = input.maturity !== undefined ? input.maturity : existing.maturity || "adult";
  const flavorThemes = input.flavorThemes !== undefined ? input.flavorThemes : existing.flavorThemes || [];
  const chaosLevel = input.chaosLevel !== undefined ? input.chaosLevel : existing.chaosLevel ?? 0;
  const wildcard = input.wildcard !== undefined ? input.wildcard : existing.wildcard || "";
  const gameType = input.gameType !== undefined ? input.gameType : existing.gameType || "cah";
  const draft = input.draft !== undefined ? input.draft : (existing as any).draft ?? false;
  const artStyle = input.artStyle !== undefined ? input.artStyle : existing.artStyle || null;
  const voiceId = input.voiceId !== undefined ? input.voiceId : existing.voiceId || null;
  const soundOverrides = input.soundOverrides !== undefined ? input.soundOverrides : existing.soundOverrides || null;

  let queryText: string;
  let queryParams: any[];

  if (bypassOwnership) {
    queryText = `UPDATE decks SET name = $1, description = $2, chaos_cards = $3, knowledge_cards = $4, win_condition = $5,
       maturity = $6, flavor_themes = $7, chaos_level = $8, wildcard = $9, game_type = $10, draft = $11, art_style = $12, voice_id = $13, sound_overrides = $14, updated_at = NOW()
     WHERE id = $15 RETURNING *`;
    queryParams = [name, description, JSON.stringify(chaosCards), JSON.stringify(knowledgeCards), JSON.stringify(winCondition), maturity, JSON.stringify(flavorThemes), chaosLevel, wildcard, gameType, draft, artStyle, voiceId, JSON.stringify(soundOverrides || {}), id];
  } else {
    queryText = `UPDATE decks SET name = $1, description = $2, chaos_cards = $3, knowledge_cards = $4, win_condition = $5,
       maturity = $6, flavor_themes = $7, chaos_level = $8, wildcard = $9, game_type = $10, draft = $11, art_style = $12, voice_id = $13, sound_overrides = $14, updated_at = NOW()
     WHERE id = $15 AND (owner_id = $16 OR owner_id IS NULL) RETURNING *`;
    queryParams = [name, description, JSON.stringify(chaosCards), JSON.stringify(knowledgeCards), JSON.stringify(winCondition), maturity, JSON.stringify(flavorThemes), chaosLevel, wildcard, gameType, draft, artStyle, voiceId, JSON.stringify(soundOverrides || {}), id, ownerId];
  }

  const { rows } = await pool.query(queryText, queryParams);

  if (rows.length === 0) return null;
  return rowToDeck(rows[0]);
}

export async function deleteDeck(id: string, ownerId?: string, bypassOwnership?: boolean): Promise<boolean> {
  let queryText: string;
  let queryParams: any[];

  if (bypassOwnership) {
    queryText = "DELETE FROM decks WHERE id = $1 AND built_in = FALSE";
    queryParams = [id];
  } else {
    queryText = "DELETE FROM decks WHERE id = $1 AND built_in = FALSE AND owner_id = $2";
    queryParams = [id, ownerId];
  }

  const { rowCount } = await pool.query(queryText, queryParams);
  return (rowCount ?? 0) > 0;
}

export interface PackSummary {
  id: string;
  deckId: string | null;
  deckName: string;
  type: string;
  name: string;
  description: string;
  chaosCount: number;
  knowledgeCount: number;
  ownerId: string | null;
  builtIn: boolean;
  gameType: string | null;
}

export interface PackInput {
  type: string;
  name: string;
  description: string;
  chaosCards: { text: string; pick?: number }[];
  knowledgeCards: { text: string }[];
}

export async function upsertPacksForDeck(
  deckId: string,
  packs: PackInput[],
  ownerId: string | null,
  builtIn: boolean
): Promise<void> {
  await pool.query("DELETE FROM packs WHERE deck_id = $1", [deckId]);
  for (const pack of packs) {
    if (pack.chaosCards.length === 0 && pack.knowledgeCards.length === 0) continue;
    const id = randomUUID().slice(0, 8);
    const chaosCards = pack.chaosCards.map((c, i) => ({
      id: `cc-${Date.now()}-${i}`,
      text: c.text.trim(),
      pick: c.pick || 1,
    }));
    const knowledgeCards = pack.knowledgeCards.map((c, i) => ({
      id: `kc-${Date.now()}-${i}`,
      text: c.text.trim(),
    }));
    await pool.query(
      `INSERT INTO packs (id, deck_id, type, name, description, chaos_cards, knowledge_cards, owner_id, built_in)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, deckId, pack.type, pack.name, pack.description || "", JSON.stringify(chaosCards), JSON.stringify(knowledgeCards), ownerId, builtIn]
    );
  }
}

export async function getPacksForDeck(deckId: string): Promise<{ type: string; name: string; description: string; chaosCards: any[]; knowledgeCards: any[] }[]> {
  const { rows } = await pool.query(
    "SELECT type, name, description, chaos_cards, knowledge_cards FROM packs WHERE deck_id = $1 ORDER BY created_at ASC",
    [deckId]
  );
  return rows.map((r: any) => ({
    type: r.type,
    name: r.name,
    description: r.description || "",
    chaosCards: (r.chaos_cards || []).map((c: any) => ({ text: c.text, pick: c.pick || 1 })),
    knowledgeCards: (r.knowledge_cards || []).map((c: any) => ({ text: c.text, ...(c.bonus ? { bonus: true } : {}) })),
  }));
}

export async function listPacks(type?: string): Promise<PackSummary[]> {
  const { rows } = await pool.query(
    `SELECT p.id, p.deck_id, p.type, p.name, p.description, p.owner_id, p.built_in,
            d.name as deck_name, d.game_type,
            jsonb_array_length(p.chaos_cards) as chaos_count,
            jsonb_array_length(p.knowledge_cards) as knowledge_count
     FROM packs p
     LEFT JOIN decks d ON p.deck_id = d.id
     ${type ? "WHERE p.type = $1" : ""}
     ORDER BY p.built_in DESC, p.created_at DESC`,
    type ? [type] : []
  );
  return rows.map((r: any) => ({
    id: r.id,
    deckId: r.deck_id || null,
    deckName: r.deck_name || "",
    type: r.type,
    name: r.name,
    description: r.description,
    chaosCount: parseInt(r.chaos_count),
    knowledgeCount: parseInt(r.knowledge_count),
    ownerId: r.owner_id || null,
    builtIn: r.built_in,
    gameType: r.game_type || null,
  }));
}

export async function getPackById(id: string): Promise<{ id: string; type: string; name: string; description: string; chaosCards: ChaosCard[]; knowledgeCards: KnowledgeCard[] } | null> {
  const { rows } = await pool.query("SELECT * FROM packs WHERE id = $1", [id]);
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    type: r.type,
    name: r.name,
    description: r.description,
    chaosCards: r.chaos_cards,
    knowledgeCards: r.knowledge_cards,
  };
}

export async function createDeckFromPacks(
  packIds: string[],
  name: string,
  winCondition: WinCondition,
  ownerId: string,
  options?: { isAdmin?: boolean }
): Promise<CustomDeck> {
  const minChaos = options?.isAdmin ? 1 : MIN_CHAOS_CARDS;
  const minKnowledge = options?.isAdmin ? 1 : MIN_KNOWLEDGE_CARDS;
  // Fetch all selected packs
  const packRows = await Promise.all(packIds.map((id) => getPackById(id)));
  const validPacks = packRows.filter(Boolean) as NonNullable<Awaited<ReturnType<typeof getPackById>>>[];

  // Merge all cards
  const allChaos = validPacks.flatMap((p) => p.chaosCards);
  const allKnowledge = validPacks.flatMap((p) => p.knowledgeCards);

  if (allChaos.length < minChaos) throw new Error(`Need at least ${minChaos} prompt cards`);
  if (allKnowledge.length < minKnowledge) throw new Error(`Need at least ${minKnowledge} answer cards`);

  // Create the deck
  const deck = await createDeck({ name, chaosCards: allChaos, knowledgeCards: allKnowledge, winCondition, ownerId });

  // Save packs on the new deck too
  await upsertPacksForDeck(
    deck.id,
    validPacks.map((p) => ({
      type: p.type,
      name: p.name,
      description: p.description,
      chaosCards: p.chaosCards,
      knowledgeCards: p.knowledgeCards,
    })),
    ownerId,
    false
  );

  return deck;
}
