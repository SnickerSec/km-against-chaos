import { Router } from "express";
import sharp from "sharp";
import { getDeck } from "./deckStore.js";
import { requireAuth } from "./auth.js";

const router = Router();
const TGC_API = "https://www.thegamecrafter.com/api";

function getApiKeyId(): string {
  return process.env.TGC_API_KEY_ID || "";
}

// Pending TGC orders: sso_id -> { deckId, sessionId }
const pendingOrders = new Map<string, { deckId: string }>();

// ── Card image generation ──

const CARD_W = 825; // poker size with bleed at 300 DPI
const CARD_H = 1125;
const SAFE_X = 38; // ~1/8" bleed
const SAFE_Y = 38;
const INNER_W = CARD_W - SAFE_X * 2;
const INNER_H = CARD_H - SAFE_Y * 2;

function escapeXml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function wrapText(text: string, maxCharsPerLine: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (current.length + word.length + 1 > maxCharsPerLine && current.length > 0) {
      lines.push(current);
      current = word;
    } else {
      current = current ? current + " " + word : word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function generateCardSvg(
  text: string,
  type: "chaos" | "knowledge",
  pick?: number
): string {
  const isChaos = type === "chaos";
  const bg = isChaos ? "#141414" : "#ffffff";
  const textColor = isChaos ? "#ffffff" : "#141414";
  const labelColor = isChaos ? "#c83232" : "#6440a0";
  const label = isChaos ? "PROMPT" : "ANSWER";

  // Estimate font size and wrapping
  const maxChars = 28;
  const lines = wrapText(text, maxChars);
  const fontSize = lines.length > 6 ? 32 : lines.length > 4 ? 36 : 42;
  const lineHeight = fontSize * 1.35;
  const totalTextH = lines.length * lineHeight;
  const textStartY = SAFE_Y + 120 + (INNER_H - 160 - totalTextH) / 2 + fontSize;

  const textLines = lines
    .map((line, i) => `<text x="${SAFE_X + 30}" y="${textStartY + i * lineHeight}" font-family="Arial,Helvetica,sans-serif" font-weight="bold" font-size="${fontSize}" fill="${textColor}">${escapeXml(line)}</text>`)
    .join("\n");

  const pickLabel = isChaos && pick && pick > 1
    ? `<text x="${SAFE_X + 30}" y="${CARD_H - SAFE_Y - 30}" font-family="Arial,Helvetica,sans-serif" font-weight="bold" font-size="28" fill="${labelColor}">PICK ${pick}</text>`
    : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}">
  <rect width="${CARD_W}" height="${CARD_H}" fill="${bg}" rx="24"/>
  <text x="${SAFE_X + 30}" y="${SAFE_Y + 60}" font-family="Arial,Helvetica,sans-serif" font-weight="bold" font-size="28" fill="${labelColor}">${label}</text>
  ${textLines}
  ${pickLabel}
</svg>`;
}

async function renderCardPng(text: string, type: "chaos" | "knowledge", pick?: number): Promise<Buffer> {
  const svg = generateCardSvg(text, type, pick);
  return sharp(Buffer.from(svg)).png().toBuffer();
}

// ── TGC API helpers ──

async function tgcPost(path: string, params: Record<string, string>): Promise<any> {
  const form = new URLSearchParams(params);
  const res = await fetch(`${TGC_API}${path}`, { method: "POST", body: form });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  return data.result || data;
}

async function tgcGet(path: string, params: Record<string, string> = {}): Promise<any> {
  const qs = new URLSearchParams(params).toString();
  const url = qs ? `${TGC_API}${path}?${qs}` : `${TGC_API}${path}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  return data.result || data;
}

async function tgcUploadFile(sessionId: string, folderId: string, name: string, pngBuffer: Buffer): Promise<string> {
  const formData = new FormData();
  formData.append("session_id", sessionId);
  formData.append("folder_id", folderId);
  formData.append("name", name);
  formData.append("file", new Blob([new Uint8Array(pngBuffer)], { type: "image/png" }), `${name}.png`);

  const res = await fetch(`${TGC_API}/file`, { method: "POST", body: formData });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  return (data.result || data).id;
}

// ── Routes ──

// Check if TGC integration is configured
router.get("/status", (_req, res) => {
  res.json({ configured: !!getApiKeyId() });
});

// Step 1: Start SSO flow — redirect user to TGC for auth
router.get("/auth", requireAuth, (req, res) => {
  const apiKeyId = getApiKeyId();
  if (!apiKeyId) {
    res.status(503).json({ error: "The Game Crafter integration not configured" });
    return;
  }

  const deckId = req.query.deckId as string;
  if (!deckId) {
    res.status(400).json({ error: "deckId is required" });
    return;
  }

  const callbackUrl = `${req.protocol}://${req.get("host")}/api/print/tgc/callback?deckId=${deckId}`;

  const ssoUrl = `https://www.thegamecrafter.com/sso?api_key_id=${apiKeyId}` +
    `&permission=edit_my_designers&permission=edit_my_games&permission=edit_my_files&permission=edit_my_carts` +
    `&postback_uri=${encodeURIComponent(callbackUrl)}`;

  res.json({ url: ssoUrl });
});

// Step 2: SSO callback — TGC redirects here after user authorizes
router.get("/callback", async (req, res) => {
  const { sso_id, deckId } = req.query as { sso_id: string; deckId: string };

  if (!sso_id || !deckId) {
    res.status(400).send("Missing sso_id or deckId");
    return;
  }

  try {
    // Get TGC session from SSO
    const session = await tgcPost(`/session/sso/${sso_id}`, {
      private_key: process.env.TGC_PRIVATE_KEY || "",
    });
    const sessionId = session.id;
    const userId = session.user_id;

    // Fetch deck
    const deck = await getDeck(deckId);
    if (!deck) {
      res.status(404).send("Deck not found");
      return;
    }

    // Create or get designer
    let designerId: string;
    try {
      const designers = await tgcGet("/designer", { session_id: sessionId });
      const list = designers.items || [];
      if (list.length > 0) {
        designerId = list[0].id;
      } else {
        const designer = await tgcPost("/designer", {
          session_id: sessionId,
          name: "Decked",
          user_id: userId,
        });
        designerId = designer.id;
      }
    } catch {
      const designer = await tgcPost("/designer", {
        session_id: sessionId,
        name: "Decked",
        user_id: userId,
      });
      designerId = designer.id;
    }

    // Create a folder for card images
    const folder = await tgcPost("/folder", {
      session_id: sessionId,
      name: deck.name,
      user_id: userId,
    });
    const folderId = folder.id;

    // Create game
    const game = await tgcPost("/game", {
      session_id: sessionId,
      name: deck.name,
      designer_id: designerId,
      description: deck.description || `A custom card game created with Decked.`,
    });
    const gameId = game.id;

    // Generate and upload card back image
    const backSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}">
      <rect width="${CARD_W}" height="${CARD_H}" fill="#6b21a8" rx="24"/>
      <text x="${CARD_W / 2}" y="${CARD_H / 2}" text-anchor="middle" dominant-baseline="central" font-family="Arial,Helvetica,sans-serif" font-weight="bold" font-size="72" fill="#c084fc">DECKED</text>
    </svg>`;
    const backPng = await sharp(Buffer.from(backSvg)).png().toBuffer();
    const backFileId = await tgcUploadFile(sessionId, folderId, "card_back", backPng);

    // Create poker deck for prompt cards
    let promptDeckId: string | null = null;
    if (deck.chaosCards.length > 0) {
      const promptDeck = await tgcPost("/deck", {
        session_id: sessionId,
        name: "Prompt Cards",
        game_id: gameId,
        back_id: backFileId,
      });
      promptDeckId = promptDeck.id;

      // Upload and create prompt cards in batches
      for (let i = 0; i < deck.chaosCards.length; i++) {
        const card = deck.chaosCards[i];
        const png = await renderCardPng(card.text, "chaos", card.pick);
        const fileId = await tgcUploadFile(sessionId, folderId, `prompt_${i + 1}`, png);
        await tgcPost("/card", {
          session_id: sessionId,
          name: `Prompt ${i + 1}`,
          deck_id: promptDeckId!,
          face_id: fileId,
          back_from: "Deck",
        });
      }
    }

    // Create poker deck for answer cards
    let answerDeckId: string | null = null;
    if (deck.knowledgeCards.length > 0) {
      const answerDeck = await tgcPost("/deck", {
        session_id: sessionId,
        name: "Answer Cards",
        game_id: gameId,
        back_id: backFileId,
      });
      answerDeckId = answerDeck.id;

      // Upload and create answer cards in batches
      for (let i = 0; i < deck.knowledgeCards.length; i++) {
        const card = deck.knowledgeCards[i];
        const png = await renderCardPng(card.text, "knowledge");
        const fileId = await tgcUploadFile(sessionId, folderId, `answer_${i + 1}`, png);
        await tgcPost("/card", {
          session_id: sessionId,
          name: `Answer ${i + 1}`,
          deck_id: answerDeckId!,
          face_id: fileId,
          back_from: "Deck",
        });
      }
    }

    // Create cart and add game
    const cart = await tgcPost("/cart", { session_id: sessionId });
    const cartId = cart.id;

    // Get the game's SKU to add to cart
    const gameData = await tgcGet(`/game/${gameId}`, { session_id: sessionId });
    if (gameData.sku_id) {
      await tgcPost(`/cart/${cartId}/sku/${gameData.sku_id}`, {
        session_id: sessionId,
        quantity: "1",
      });
    }

    // Redirect to TGC cart
    const clientUrl = process.env.CLIENT_URL || "https://www.decked.gg";
    res.redirect(`https://www.thegamecrafter.com/cart/${cartId}`);
  } catch (err: any) {
    console.error("TGC integration error:", err);
    const clientUrl = process.env.CLIENT_URL || "https://www.decked.gg";
    res.redirect(`${clientUrl}/decks?tgcError=${encodeURIComponent(err.message || "Failed to create order")}`);
  }
});

export default router;
