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
  // JSON body parsing for this router
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
router.get("/", (_req, res) => {
  res.json(listDecks());
});

// Get a single deck (full, for export)
router.get("/:id", (req, res) => {
  const deck = getDeck(req.params.id);
  if (!deck) {
    res.status(404).json({ error: "Deck not found" });
    return;
  }
  res.json(deck);
});

// Export a deck as a downloadable JSON
router.get("/:id/export", (req, res) => {
  const deck = getDeck(req.params.id);
  if (!deck) {
    res.status(404).json({ error: "Deck not found" });
    return;
  }

  // Strip internal IDs for clean export
  const exportData = {
    name: deck.name,
    description: deck.description,
    chaosCards: deck.chaosCards.map((c) => ({ text: c.text, pick: c.pick })),
    knowledgeCards: deck.knowledgeCards.map((c) => ({ text: c.text })),
  };

  res.setHeader("Content-Disposition", `attachment; filename="${deck.name.replace(/[^a-z0-9]/gi, "_")}.json"`);
  res.json(exportData);
});

// Create a new deck
router.post("/", (req, res) => {
  const body = (req as any).body;
  const error = validateDeck(body);
  if (error) {
    res.status(400).json({ error });
    return;
  }

  const deck = createDeck(body);
  res.status(201).json(deck);
});

// Import a deck (same as create but from exported format)
router.post("/import", (req, res) => {
  const body = (req as any).body;
  const error = validateDeck(body);
  if (error) {
    res.status(400).json({ error });
    return;
  }

  const deck = createDeck(body);
  res.status(201).json(deck);
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
    const cards = await generateCards(
      theme.trim(),
      chaosCount || 10,
      knowledgeCount || 25
    );
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
router.put("/:id", (req, res) => {
  const body = (req as any).body;

  // Validate if full card arrays are provided
  if (body.chaosCards || body.knowledgeCards) {
    const merged = {
      name: body.name || "placeholder",
      chaosCards: body.chaosCards,
      knowledgeCards: body.knowledgeCards,
    };
    if (body.chaosCards && body.knowledgeCards) {
      const error = validateDeck(merged);
      if (error) {
        res.status(400).json({ error });
        return;
      }
    }
  }

  const deck = updateDeck(req.params.id, body);
  if (!deck) {
    res.status(404).json({ error: "Deck not found" });
    return;
  }
  res.json(deck);
});

// Delete a deck
router.delete("/:id", (req, res) => {
  const deleted = deleteDeck(req.params.id);
  if (!deleted) {
    res.status(404).json({ error: "Deck not found" });
    return;
  }
  res.json({ success: true });
});

export default router;
