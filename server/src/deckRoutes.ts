import { Router } from "express";
import { randomBytes } from "crypto";
import {
  listDecks,
  getDeck,
  createDeck,
  updateDeck,
  deleteDeck,
  validateDeck,
  upsertPacksForDeck,
  createDeckFromPacks,
  remixDeck,
  getPacksForDeck,
  type PackInput,
} from "./deckStore.js";
import { generateCards, generateDeck } from "./aiGenerate.js";
import { requireAuth, requireModeratorOrAdmin, isAdmin } from "./auth.js";
import pool from "./db.js";
import { createLogger } from "./logger.js";

const log = createLogger("deck-api");
const router = Router();

const BODY_SIZE_LIMIT = 100 * 1024; // 100 KB

router.use((req, res, next) => {
  if (req.headers["content-type"]?.includes("application/json")) {
    let body = "";
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > BODY_SIZE_LIMIT) {
        res.status(413).json({ error: "Request body too large" });
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on("end", () => {
      try {
        (req as any).body = JSON.parse(body);
      } catch {
        (req as any).body = {};
      }
      next();
    });
  } else {
    (req as any).body = {};
    next();
  }
});

// Per-user AI generation rate limit: 10 requests per minute
const aiRateLimitMap = new Map<string, { count: number; resetAt: number }>();
const AI_RATE_LIMIT = 10;
const AI_RATE_WINDOW_MS = 60 * 1000;

function checkAiRateLimit(userId: string): boolean {
  const now = Date.now();
  const entry = aiRateLimitMap.get(userId);
  if (!entry || now >= entry.resetAt) {
    aiRateLimitMap.set(userId, { count: 1, resetAt: now + AI_RATE_WINDOW_MS });
    return true;
  }
  if (entry.count >= AI_RATE_LIMIT) return false;
  entry.count++;
  return true;
}

function requireAiRateLimit(req: any, res: any, next: any) {
  const userId = req.user?.id;
  if (!userId || !checkAiRateLimit(userId)) {
    res.status(429).json({ error: "AI generation rate limit exceeded. Please wait a minute." });
    return;
  }
  next();
}

// List all decks
router.get("/", async (req, res) => {
  try {
    const { search, gameType, sort, maturity } = req.query as { search?: string; gameType?: string; sort?: string; maturity?: string };
    res.json(await listDecks({ search, gameType, sort, maturity }));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Get user's favorited deck IDs (must be before /:id route)
router.get("/user/favorites", requireAuth, async (req: any, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT deck_id FROM deck_favorites WHERE user_id = $1 ORDER BY created_at DESC",
      [req.user.id]
    );
    res.json(rows.map((r: any) => r.deck_id));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Get a single deck
router.get("/:id", async (req, res) => {
  try {
    const deck = await getDeck(req.params.id);
    if (!deck) {
      res.status(404).json({ error: "Deck not found" });
      return;
    }
    const packs = await getPacksForDeck(req.params.id);
    res.json({ ...deck, packs: packs.length > 0 ? packs : undefined });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Export a deck as downloadable JSON
router.get("/:id/export", async (req, res) => {
  try {
    const deck = await getDeck(req.params.id);
    if (!deck) {
      res.status(404).json({ error: "Deck not found" });
      return;
    }
    const exportData = {
      name: deck.name,
      description: deck.description,
      chaosCards: deck.chaosCards.map((c) => ({ text: c.text, pick: c.pick })),
      knowledgeCards: deck.knowledgeCards.map((c) => ({ text: c.text })),
    };
    res.setHeader("Content-Disposition", `attachment; filename="${deck.name.replace(/[^a-z0-9]/gi, "_")}.json"`);
    res.json(exportData);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// One-click remix a deck (snapshot clone)
router.post("/:id/remix", requireAuth, async (req, res) => {
  try {
    const deck = await remixDeck(req.params.id, (req as any).user.id);
    res.status(201).json(deck);
  } catch (e: any) {
    res.status(e.message === "Source deck not found" ? 404 : 500).json({ error: e.message });
  }
});

// Rate a deck
router.post("/:id/rate", requireAuth, async (req: any, res) => {
  try {
    let body = req.body;
    if (typeof body === "string") body = JSON.parse(body);
    const { rating } = body;
    const deckId = req.params.id;
    const userId = req.user.id;

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: "Rating must be 1-5" });
    }

    const id = randomBytes(8).toString("hex");

    // Upsert rating
    await pool.query(`
      INSERT INTO deck_ratings (id, deck_id, user_id, rating)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (deck_id, user_id)
      DO UPDATE SET rating = $4
    `, [id, deckId, userId, rating]);

    // Update avg_rating on the deck
    await pool.query(`
      UPDATE decks SET avg_rating = (
        SELECT COALESCE(AVG(rating), 0) FROM deck_ratings WHERE deck_id = $1
      ) WHERE id = $1
    `, [deckId]);

    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Toggle favorite on a deck
router.post("/:id/favorite", requireAuth, async (req: any, res) => {
  try {
    const deckId = req.params.id;
    const userId = req.user.id;

    // Check if already favorited
    const { rows } = await pool.query(
      "SELECT id FROM deck_favorites WHERE user_id = $1 AND deck_id = $2",
      [userId, deckId]
    );

    if (rows.length > 0) {
      // Unfavorite
      await pool.query("DELETE FROM deck_favorites WHERE user_id = $1 AND deck_id = $2", [userId, deckId]);
      res.json({ favorited: false });
    } else {
      // Favorite
      const id = randomBytes(8).toString("hex");
      await pool.query(
        "INSERT INTO deck_favorites (id, user_id, deck_id) VALUES ($1, $2, $3)",
        [id, userId, deckId]
      );
      res.json({ favorited: true });
    }
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Create deck from selected pack IDs
router.post("/from-packs", requireAuth, async (req, res) => {
  const body = (req as any).body;
  const { packIds, name, winCondition } = body;
  if (!name || typeof name !== "string" || !name.trim()) {
    res.status(400).json({ error: "Deck name is required" });
    return;
  }
  if (!Array.isArray(packIds) || packIds.length === 0) {
    res.status(400).json({ error: "At least one pack must be selected" });
    return;
  }
  try {
    const reqUser = (req as any).user;
    const deck = await createDeckFromPacks(packIds, name.trim(), winCondition || { mode: "rounds", value: 10 }, reqUser.id, { isAdmin: isAdmin(reqUser.email, reqUser.role) });
    res.status(201).json(deck);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// Create a new deck
router.post("/", requireAuth, async (req, res) => {
  const body = (req as any).body;
  const reqUser = (req as any).user;
  const admin = isAdmin(reqUser.email, reqUser.role);
  const error = validateDeck(body, { isAdmin: admin });
  if (error) {
    res.status(400).json({ error });
    return;
  }
  try {
    const deck = await createDeck({
      ...body,
      ownerId: (req as any).user.id,
      maturity: body.maturity,
      flavorThemes: body.flavorThemes,
      chaosLevel: body.chaosLevel,
      wildcard: body.wildcard,
      remixedFrom: body.remixedFrom,
    });
    if (body.packs && Array.isArray(body.packs)) {
      await upsertPacksForDeck(deck.id, body.packs as PackInput[], (req as any).user.id, false);
    }
    res.status(201).json(deck);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Import a deck
router.post("/import", requireAuth, async (req, res) => {
  const body = (req as any).body;
  const reqUser = (req as any).user;
  const error = validateDeck(body, { isAdmin: isAdmin(reqUser.email, reqUser.role) });
  if (error) {
    res.status(400).json({ error });
    return;
  }
  try {
    const deck = await createDeck({ ...body, ownerId: (req as any).user.id });
    res.status(201).json(deck);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

const MAX_THEME_LEN = 200;
const MAX_WILDCARD_LEN = 200;
const MAX_CHAOS_COUNT = 100;
const MAX_KNOWLEDGE_COUNT = 100;

function clampInt(val: any, min: number, max: number, fallback: number): number {
  const n = typeof val === "number" ? val : parseInt(val, 10);
  if (!isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

// AI-generate cards for a pack
router.post("/generate", requireAuth, requireAiRateLimit, async (req, res) => {
  const body = (req as any).body;
  const {
    theme, gameType, packType, packName, deckName, deckDescription,
    chaosCount, knowledgeCount,
    maturity, flavorThemes, chaosLevel, wildcard,
  } = body;

  if (!theme || typeof theme !== "string" || theme.trim().length === 0) {
    res.status(400).json({ error: "Theme is required" });
    return;
  }
  if (theme.trim().length > MAX_THEME_LEN) {
    res.status(400).json({ error: `Theme must be ${MAX_THEME_LEN} characters or fewer` });
    return;
  }
  if (wildcard && typeof wildcard === "string" && wildcard.length > MAX_WILDCARD_LEN) {
    res.status(400).json({ error: `Wildcard must be ${MAX_WILDCARD_LEN} characters or fewer` });
    return;
  }

  try {
    const cards = await generateCards({
      theme: theme.trim(),
      gameType: gameType || "cards-against-humanity",
      packType: packType || "base",
      packName,
      deckName,
      deckDescription,
      chaosCount: clampInt(chaosCount, 1, MAX_CHAOS_COUNT, 20),
      knowledgeCount: clampInt(knowledgeCount, 1, MAX_KNOWLEDGE_COUNT, 20),
      maturity,
      flavorThemes: Array.isArray(flavorThemes) ? flavorThemes.slice(0, 5) : undefined,
      chaosLevel: clampInt(chaosLevel, 0, 100, 0),
      wildcard: typeof wildcard === "string" ? wildcard.slice(0, MAX_WILDCARD_LEN) : undefined,
    });
    res.json(cards);
  } catch (e: any) {
    log.error("AI generation error", { error: e.message });
    res.status(500).json({
      error: e.message?.includes("API") || e.message?.includes("key")
        ? "AI service unavailable. Check your API key."
        : "Failed to generate cards. Try again.",
    });
  }
});

// AI-generate a full deck (name, description, cards) and auto-save as a draft
router.post("/generate-deck", requireAuth, requireAiRateLimit, async (req, res) => {
  const body = (req as any).body;
  const { theme, gameType, chaosCount, knowledgeCount, maturity, flavorThemes, chaosLevel, wildcard, draftId } = body;

  if (!theme || typeof theme !== "string" || theme.trim().length === 0) {
    res.status(400).json({ error: "Theme is required" });
    return;
  }
  if (theme.trim().length > MAX_THEME_LEN) {
    res.status(400).json({ error: `Theme must be ${MAX_THEME_LEN} characters or fewer` });
    return;
  }
  if (wildcard && typeof wildcard === "string" && wildcard.length > MAX_WILDCARD_LEN) {
    res.status(400).json({ error: `Wildcard must be ${MAX_WILDCARD_LEN} characters or fewer` });
    return;
  }

  try {
    const generated = await generateDeck({
      theme: theme.trim(),
      gameType: gameType || "cards-against-humanity",
      packType: "base",
      chaosCount: clampInt(chaosCount, 1, MAX_CHAOS_COUNT, 20),
      knowledgeCount: clampInt(knowledgeCount, 1, MAX_KNOWLEDGE_COUNT, 20),
      maturity,
      flavorThemes: Array.isArray(flavorThemes) ? flavorThemes.slice(0, 5) : undefined,
      chaosLevel: clampInt(chaosLevel, 0, 100, 0),
      wildcard: typeof wildcard === "string" ? wildcard.slice(0, MAX_WILDCARD_LEN) : undefined,
    });

    // Auto-save as a draft so it isn't lost if the client closes before saving
    const ownerId = (req as any).user.id;
    // For Uno, the AI returns a template object rather than chaosCards/knowledgeCards.
    // Serialize it into the same single-chaos-card format used everywhere else.
    const resolvedGameType = gameType || "cards-against-humanity";
    const isUno = resolvedGameType === "uno";
    const draftChaosCards = isUno
      ? [{ text: JSON.stringify((generated as any).template), pick: 1 }]
      : generated.chaosCards || [];
    const draftKnowledgeCards = isUno ? [] : generated.knowledgeCards || [];
    const draftInput = {
      name: generated.name,
      description: generated.description,
      chaosCards: draftChaosCards,
      knowledgeCards: draftKnowledgeCards,
      ownerId,
      maturity: maturity || "adult",
      flavorThemes: Array.isArray(flavorThemes) ? flavorThemes.slice(0, 5) : [],
      chaosLevel: clampInt(chaosLevel, 0, 100, 0),
      wildcard: typeof wildcard === "string" ? wildcard.slice(0, MAX_WILDCARD_LEN) : "",
      gameType: gameType || "cards-against-humanity",
      draft: true,
    };

    let savedDraft;
    if (draftId && typeof draftId === "string") {
      // Regenerated — overwrite the existing draft
      savedDraft = await updateDeck(draftId, { ...draftInput, draft: true }, ownerId);
    }
    if (!savedDraft) {
      savedDraft = await createDeck(draftInput);
    }

    res.json({ ...generated, id: savedDraft.id });
  } catch (e: any) {
    log.error("AI deck generation error", { error: e.message });
    res.status(500).json({
      error: e.message?.includes("API") || e.message?.includes("key")
        ? "AI service unavailable. Check your API key."
        : "Failed to generate deck. Try again.",
    });
  }
});

// Update a deck
router.put("/:id", requireAuth, async (req, res) => {
  const body = (req as any).body;
  const reqUser = (req as any).user;

  if (body.chaosCards && body.knowledgeCards) {
    const error = validateDeck({ name: body.name || "placeholder", chaosCards: body.chaosCards, knowledgeCards: body.knowledgeCards }, { isAdmin: isAdmin(reqUser.email, reqUser.role) });
    if (error) {
      res.status(400).json({ error });
      return;
    }
  }

  const isMod = reqUser.isAdmin || reqUser.role === "moderator" || reqUser.role === "admin";

  try {
    const deck = isMod
      ? await updateDeck(req.params.id, body, undefined, true)
      : await updateDeck(req.params.id, body, reqUser.id);
    if (!deck) {
      res.status(404).json({ error: "Deck not found or not owned by you" });
      return;
    }
    if (body.packs && Array.isArray(body.packs) && deck) {
      await upsertPacksForDeck(deck.id, body.packs as PackInput[], reqUser.id, false);
    }
    res.json(deck);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Delete a deck
router.delete("/:id", requireAuth, async (req, res) => {
  const reqUser = (req as any).user;
  const isMod = reqUser.isAdmin || reqUser.role === "moderator" || reqUser.role === "admin";

  try {
    const deleted = isMod
      ? await deleteDeck(req.params.id, undefined, true)
      : await deleteDeck(req.params.id, reqUser.id);
    if (!deleted) {
      res.status(404).json({ error: "Deck not found or not owned by you" });
      return;
    }
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
