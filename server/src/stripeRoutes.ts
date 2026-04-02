import { Router } from "express";
import Stripe from "stripe";
import { requireAuth } from "./auth.js";
import pool from "./db.js";
import { generateDeckArt, generatePreviewImage } from "./imageGenerate.js";

const router = Router();

const BODY_SIZE_LIMIT = 100 * 1024;

// Manual JSON body parsing (consistent with other route files)
router.use((req, res, next) => {
  // Skip body parsing for webhook route — it needs raw body
  if (req.path === "/api/stripe/webhook") { next(); return; }
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

const PRICE_CENTS = parseInt(process.env.PREMIUM_ART_PRICE_CENTS || "150", 10);

function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return new Stripe(key);
}

// Create checkout session for premium art
router.post("/api/stripe/create-checkout", requireAuth, async (req: any, res) => {
  const stripe = getStripe();
  if (!stripe) {
    res.status(503).json({ error: "Payments not configured" });
    return;
  }

  const { deckId } = req.body || {};
  if (!deckId) {
    res.status(400).json({ error: "deckId is required" });
    return;
  }

  // Verify deck exists and user owns it
  const { rows } = await pool.query("SELECT * FROM decks WHERE id = $1", [deckId]);
  if (rows.length === 0) {
    res.status(404).json({ error: "Deck not found" });
    return;
  }
  if (rows[0].owner_id !== req.user.id) {
    res.status(403).json({ error: "Not your deck" });
    return;
  }
  if (rows[0].art_tier === "premium") {
    res.status(400).json({ error: "Deck already has premium art" });
    return;
  }

  const clientUrl = process.env.CLIENT_URL || "http://localhost:3000";

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [{
        price_data: {
          currency: "usd",
          product_data: {
            name: `Premium Art — ${rows[0].name}`,
            description: "AI-generated comic panel art for your deck",
          },
          unit_amount: PRICE_CENTS,
        },
        quantity: 1,
      }],
      mode: "payment",
      success_url: `${clientUrl}/decks/edit?id=${deckId}&art=generating`,
      cancel_url: `${clientUrl}/decks/edit?id=${deckId}&art=cancelled`,
      metadata: { deckId, userId: req.user.id },
    });

    res.json({ sessionUrl: session.url });
  } catch (err: any) {
    console.error("Stripe checkout creation failed:", err);
    res.status(500).json({ error: "Failed to create checkout session" });
  }
});

// Stripe webhook
router.post("/api/stripe/webhook", async (req: any, res) => {
  const stripe = getStripe();
  if (!stripe) {
    res.status(503).json({ error: "Payments not configured" });
    return;
  }

  const sig = req.headers["stripe-signature"];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!sig || !webhookSecret) {
    res.status(400).json({ error: "Missing signature or webhook secret" });
    return;
  }

  let event: Stripe.Event;
  try {
    // req.rawBody is set by the raw body middleware in index.ts
    event = stripe.webhooks.constructEvent(req.rawBody, sig, webhookSecret);
  } catch (err: any) {
    console.error("Webhook signature verification failed:", err.message);
    res.status(400).json({ error: "Invalid signature" });
    return;
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const deckId = session.metadata?.deckId;

    if (deckId) {
      console.log(`[STRIPE] Payment completed for deck ${deckId}`);

      // Update deck tier and kick off generation
      await pool.query(
        "UPDATE decks SET art_tier = 'premium', art_generation_status = 'pending' WHERE id = $1",
        [deckId]
      );

      // Fire-and-forget art generation
      generateDeckArt(deckId).catch((err) => {
        console.error(`[STRIPE] Art generation failed for deck ${deckId}:`, err);
      });
    }
  }

  res.json({ received: true });
});

// Rate limit: 3 free previews per user per day
const previewUsage = new Map<string, { count: number; resetAt: number }>();
const PREVIEW_LIMIT = 3;

function checkPreviewLimit(userId: string): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const entry = previewUsage.get(userId);
  if (!entry || now >= entry.resetAt) {
    previewUsage.set(userId, { count: 0, resetAt: now + 24 * 60 * 60 * 1000 });
    return { allowed: true, remaining: PREVIEW_LIMIT };
  }
  return { allowed: entry.count < PREVIEW_LIMIT, remaining: PREVIEW_LIMIT - entry.count };
}

// Generate a free preview image for one card
router.post("/api/art/preview", requireAuth, async (req: any, res) => {
  if (!process.env.FAL_KEY) {
    res.status(503).json({ error: "Art generation not configured" });
    return;
  }

  const userId = req.user.id;
  const { allowed, remaining } = checkPreviewLimit(userId);
  if (!allowed) {
    res.status(429).json({ error: "Preview limit reached (3 per day). Purchase premium art to generate for all cards." });
    return;
  }

  const { cardText, gameType, theme, maturity, flavorThemes, wildcard } = req.body || {};
  if (!cardText || !gameType) {
    res.status(400).json({ error: "cardText and gameType are required" });
    return;
  }

  try {
    const imageUrl = await generatePreviewImage(
      cardText,
      gameType,
      theme || "Custom Deck",
      maturity || "adult",
      flavorThemes,
      wildcard,
    );
    if (!imageUrl) {
      res.status(500).json({ error: "Failed to generate preview" });
      return;
    }
    // Count successful preview
    const entry = previewUsage.get(userId)!;
    entry.count++;
    res.json({ imageUrl, previewsRemaining: PREVIEW_LIMIT - entry.count });
  } catch (err: any) {
    console.error("Preview generation failed:", err);
    res.status(500).json({ error: "Failed to generate preview" });
  }
});

// Check art generation status
router.get("/api/stripe/art-status/:deckId", requireAuth, async (req: any, res) => {
  const { deckId } = req.params;
  const { rows } = await pool.query(
    "SELECT art_tier, art_generation_status FROM decks WHERE id = $1 AND owner_id = $2",
    [deckId, req.user.id]
  );
  if (rows.length === 0) {
    res.status(404).json({ error: "Deck not found" });
    return;
  }
  res.json({
    artTier: rows[0].art_tier,
    artGenerationStatus: rows[0].art_generation_status,
  });
});

export default router;
