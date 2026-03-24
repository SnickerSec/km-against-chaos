import { Router } from "express";
import {
  listDecks,
  getDeck,
  createDeck,
  updateDeck,
  deleteDeck,
  validateDeck,
} from "./deckStore.js";
import { generateCards } from "./aiGenerate.js";

const router = Router();
router.use((req, res, next) => {
  if (req.headers["content-type"]?.includes("application/json")) {
    let body = "";
    req.on("data", (chunk: Buffer) => (body += chunk));
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

// List all decks
router.get("/", async (_req, res) => {
  try {
    res.json(await listDecks());
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
    res.json(deck);
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

// Create a new deck
router.post("/", async (req, res) => {
  const body = (req as any).body;
  const error = validateDeck(body);
  if (error) {
    res.status(400).json({ error });
    return;
  }
  try {
    const deck = await createDeck(body);
    res.status(201).json(deck);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Import a deck
router.post("/import", async (req, res) => {
  const body = (req as any).body;
  const error = validateDeck(body);
  if (error) {
    res.status(400).json({ error });
    return;
  }
  try {
    const deck = await createDeck(body);
    res.status(201).json(deck);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// AI-generate cards for a theme
router.post("/generate", async (req, res) => {
  const body = (req as any).body;
  const { theme, chaosCount, knowledgeCount } = body;

  if (!theme || typeof theme !== "string" || theme.trim().length === 0) {
    res.status(400).json({ error: "Theme is required" });
    return;
  }

  try {
    const cards = await generateCards(theme.trim(), chaosCount || 10, knowledgeCount || 25);
    res.json(cards);
  } catch (e: any) {
    console.error("AI generation error:", e.message);
    res.status(500).json({
      error: e.message?.includes("API")
        ? "AI service unavailable. Check your ANTHROPIC_API_KEY."
        : "Failed to generate cards. Try again.",
    });
  }
});

// Update a deck
router.put("/:id", async (req, res) => {
  const body = (req as any).body;

  if (body.chaosCards && body.knowledgeCards) {
    const error = validateDeck({ name: body.name || "placeholder", chaosCards: body.chaosCards, knowledgeCards: body.knowledgeCards });
    if (error) {
      res.status(400).json({ error });
      return;
    }
  }

  try {
    const deck = await updateDeck(req.params.id, body);
    if (!deck) {
      res.status(404).json({ error: "Deck not found" });
      return;
    }
    res.json(deck);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Delete a deck
router.delete("/:id", async (req, res) => {
  try {
    const deleted = await deleteDeck(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: "Deck not found" });
      return;
    }
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
