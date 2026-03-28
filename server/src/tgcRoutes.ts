import { Router } from "express";
import sharp from "sharp";
import { getDeck } from "./deckStore.js";
import { requireAuth } from "./auth.js";

const router = Router();
const TGC_API = "https://www.thegamecrafter.com/api";

function getApiKeyId(): string {
  return process.env.TGC_API_KEY_ID || "";
}

// Store TGC sessions after SSO callback (token -> { sessionId, userId, deckId })
const tgcSessions = new Map<string, { sessionId: string; userId: string; deckId: string; createdAt: number }>();

// Cleanup old sessions (older than 30 min)
setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [key, val] of tgcSessions) {
    if (val.createdAt < cutoff) tgcSessions.delete(key);
  }
}, 60 * 1000);

// ── Card image generation ──

const CARD_W = 825;
const CARD_H = 1125;
const SAFE_X = 38;
const SAFE_Y = 38;
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

function generateCardSvg(text: string, type: "chaos" | "knowledge", pick?: number): string {
  const isChaos = type === "chaos";
  const bg = isChaos ? "#141414" : "#ffffff";
  const textColor = isChaos ? "#ffffff" : "#141414";
  const labelColor = isChaos ? "#c83232" : "#6440a0";
  const label = isChaos ? "PROMPT" : "ANSWER";

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
  const form = new URLSearchParams({ ...params, api_key_id: getApiKeyId() });
  const res = await fetch(`${TGC_API}${path}`, { method: "POST", body: form });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  return data.result || data;
}

async function tgcGet(path: string, params: Record<string, string> = {}): Promise<any> {
  const qs = new URLSearchParams({ ...params, api_key_id: getApiKeyId() }).toString();
  const res = await fetch(`${TGC_API}${path}?${qs}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  return data.result || data;
}

async function tgcUploadFile(sessionId: string, folderId: string, name: string, pngBuffer: Buffer): Promise<string> {
  // Build multipart form data manually for reliable Node.js compatibility
  const boundary = `----DeckedUpload${Date.now()}`;
  const fields: Record<string, string> = { session_id: sessionId, folder_id: folderId, name, api_key_id: getApiKeyId() };

  let body = "";
  for (const [key, val] of Object.entries(fields)) {
    body += `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${val}\r\n`;
  }
  body += `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}.png"\r\nContent-Type: image/png\r\n\r\n`;
  const ending = `\r\n--${boundary}--\r\n`;

  const bodyBuffer = Buffer.concat([
    Buffer.from(body, "utf-8"),
    pngBuffer,
    Buffer.from(ending, "utf-8"),
  ]);

  const res = await fetch(`${TGC_API}/file`, {
    method: "POST",
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body: bodyBuffer,
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  return (data.result || data).id;
}

// ── Routes ──

// Check if TGC integration is configured
router.get("/status", (_req, res) => {
  res.json({ configured: !!getApiKeyId() });
});

// Step 1: Start SSO flow
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
    `&permission=view_my_account&permission=view_my_designers&permission=edit_my_designers&permission=view_my_games&permission=edit_my_games&permission=view_my_files&permission=edit_my_files&permission=view_my_carts&permission=edit_my_carts` +
    `&postback_uri=${encodeURIComponent(callbackUrl)}`;

  res.json({ url: ssoUrl });
});

// Step 2: SSO callback — store session and redirect to client progress page
router.get("/callback", async (req, res) => {
  const { sso_id, deckId } = req.query as { sso_id: string; deckId: string };

  if (!sso_id || !deckId) {
    res.status(400).send("Missing sso_id or deckId");
    return;
  }

  try {
    const session = await tgcPost(`/session/sso/${sso_id}`, {
      private_key: process.env.TGC_PRIVATE_KEY || "",
    });

    // Generate a token to identify this order
    const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
    tgcSessions.set(token, {
      sessionId: session.id,
      userId: session.user_id,
      deckId,
      createdAt: Date.now(),
    });

    const clientUrl = process.env.CLIENT_URL || "https://www.decked.gg";
    res.redirect(`${clientUrl}/decks/print?token=${token}`);
  } catch (err: any) {
    console.error("TGC SSO error:", err.message || err);
    const clientUrl = process.env.CLIENT_URL || "https://www.decked.gg";
    res.redirect(`${clientUrl}/decks`);
  }
});

// Step 3: SSE endpoint — streams progress as cards are created
router.get("/create", async (req, res) => {
  const token = req.query.token as string;
  if (!token) {
    res.status(400).json({ error: "token is required" });
    return;
  }

  const session = tgcSessions.get(token);
  if (!session) {
    res.status(404).json({ error: "Session expired or invalid" });
    return;
  }

  tgcSessions.delete(token);
  const { sessionId, userId, deckId } = session;

  // Prevent request timeout (allow up to 10 minutes for large decks)
  req.setTimeout(600000);
  res.setTimeout(600000);

  // Set up SSE
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  // Send keepalive pings every 15s to prevent proxy/connection timeouts
  const keepalive = setInterval(() => {
    res.write(": keepalive\n\n");
  }, 15000);

  const send = (data: { step: string; progress: number; total: number; detail?: string }) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const sendError = (message: string) => {
    clearInterval(keepalive);
    res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
    res.end();
  };

  const sendDone = (cartUrl: string) => {
    clearInterval(keepalive);
    res.write(`data: ${JSON.stringify({ done: true, cartUrl })}\n\n`);
    res.end();
  };

  try {
    const deck = await getDeck(deckId);
    if (!deck) { sendError("Deck not found"); return; }

    const totalCards = deck.chaosCards.length + deck.knowledgeCards.length;
    let processed = 0;

    send({ step: "Setting up", progress: 0, total: totalCards, detail: "Creating designer..." });

    // Get or create designer
    let designerId: string;
    try {
      const userData = await tgcGet(`/user/${userId}/designers`, { session_id: sessionId });
      const items = userData.items || [];
      if (items.length > 0) {
        designerId = items[0].id;
      } else {
        throw new Error("no designers");
      }
    } catch {
      try {
        const designer = await tgcPost("/designer", {
          session_id: sessionId,
          name: "Decked",
          user_id: userId,
        });
        designerId = designer.id;
      } catch (designerErr: any) {
        sendError(`Designer setup failed: ${designerErr.message}`);
        return;
      }
    }

    send({ step: "Setting up", progress: 0, total: totalCards, detail: "Creating game..." });

    // Create folder
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
      description: deck.description || "A custom card game created with Decked.",
    });
    const gameId = game.id;

    send({ step: "Setting up", progress: 0, total: totalCards, detail: "Uploading card back..." });

    // Upload card back
    const backSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}">
      <rect width="${CARD_W}" height="${CARD_H}" fill="#6b21a8" rx="24"/>
      <text x="${CARD_W / 2}" y="${CARD_H / 2}" text-anchor="middle" dominant-baseline="central" font-family="Arial,Helvetica,sans-serif" font-weight="bold" font-size="72" fill="#c084fc">DECKED</text>
    </svg>`;
    const backPng = await sharp(Buffer.from(backSvg)).png().toBuffer();
    const backFileId = await tgcUploadFile(sessionId, folderId, "card_back", backPng);

    // Create and populate prompt deck
    if (deck.chaosCards.length > 0) {
      send({ step: "Prompt cards", progress: 0, total: totalCards, detail: "Creating prompt deck..." });

      const promptDeck = await tgcPost("/pokerdeck", {
        session_id: sessionId,
        name: "Prompt Cards",
        game_id: gameId,
        back_id: backFileId,
      });
      const promptDeckId = promptDeck.id;

      for (let i = 0; i < deck.chaosCards.length; i++) {
        const card = deck.chaosCards[i];
        processed++;
        send({ step: "Prompt cards", progress: processed, total: totalCards, detail: `Uploading prompt ${i + 1}/${deck.chaosCards.length}` });

        const png = await renderCardPng(card.text, "chaos", card.pick);
        const fileId = await tgcUploadFile(sessionId, folderId, `prompt_${i + 1}`, png);
        await tgcPost("/card", {
          session_id: sessionId,
          name: `Prompt ${i + 1}`,
          deck_id: promptDeckId,
          face_id: fileId,
          back_from: "Deck",
        });
      }
    }

    // Create and populate answer deck
    if (deck.knowledgeCards.length > 0) {
      send({ step: "Answer cards", progress: processed, total: totalCards, detail: "Creating answer deck..." });

      const answerDeck = await tgcPost("/pokerdeck", {
        session_id: sessionId,
        name: "Answer Cards",
        game_id: gameId,
        back_id: backFileId,
      });
      const answerDeckId = answerDeck.id;

      for (let i = 0; i < deck.knowledgeCards.length; i++) {
        const card = deck.knowledgeCards[i];
        processed++;
        send({ step: "Answer cards", progress: processed, total: totalCards, detail: `Uploading answer ${i + 1}/${deck.knowledgeCards.length}` });

        const png = await renderCardPng(card.text, "knowledge");
        const fileId = await tgcUploadFile(sessionId, folderId, `answer_${i + 1}`, png);
        await tgcPost("/card", {
          session_id: sessionId,
          name: `Answer ${i + 1}`,
          deck_id: answerDeckId,
          face_id: fileId,
          back_from: "Deck",
        });
      }
    }

    // Create cart
    send({ step: "Finishing", progress: totalCards, total: totalCards, detail: "Adding to cart..." });

    const cart = await tgcPost("/cart", { session_id: sessionId });
    const cartId = cart.id;

    const gameData = await tgcGet(`/game/${gameId}`, { session_id: sessionId });
    if (gameData.sku_id) {
      await tgcPost(`/cart/${cartId}/sku/${gameData.sku_id}`, {
        session_id: sessionId,
        quantity: "1",
      });
    }

    sendDone(`https://www.thegamecrafter.com/cart/${cartId}`);
  } catch (err: any) {
    clearInterval(keepalive);
    console.error("TGC create error:", err.message || err);
    sendError(err.message || "Failed to create order");
  }
});

export default router;
