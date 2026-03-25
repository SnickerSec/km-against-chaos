import { Router } from "express";
import pool from "./db.js";
import { requireAuth, requireAdmin } from "./auth.js";

// Cache OpenRouter models for 1 hour
let modelsCache: { data: any[]; fetchedAt: number } | null = null;
const CACHE_TTL = 60 * 60 * 1000;

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

router.use(requireAuth, requireAdmin);

// Get all settings
router.get("/settings", async (_req, res) => {
  try {
    const { rows } = await pool.query("SELECT key, value FROM settings");
    const settings: Record<string, any> = {};
    for (const row of rows) {
      settings[row.key] = row.value;
    }
    res.json(settings);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Update a setting
router.put("/settings/:key", async (req, res) => {
  const { key } = req.params;
  const { value } = (req as any).body;

  if (value === undefined) {
    res.status(400).json({ error: "Value is required" });
    return;
  }

  try {
    await pool.query(
      `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
      [key, JSON.stringify(value)]
    );
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Fetch models from OpenRouter (cached)
router.get("/models", async (_req, res) => {
  try {
    if (modelsCache && Date.now() - modelsCache.fetchedAt < CACHE_TTL) {
      return res.json(modelsCache.data);
    }

    const response = await fetch("https://openrouter.ai/api/v1/models");
    if (!response.ok) throw new Error("Failed to fetch models from OpenRouter");
    const json = await response.json();

    // Only include text-capable models
    const models = (json.data as any[])
      .filter((m: any) => m.architecture?.output_modalities?.includes("text"))
      .map((m: any) => ({
        id: m.id,
        name: m.name,
        provider: m.id.split("/")[0],
        contextLength: m.context_length,
      }));

    modelsCache = { data: models, fetchedAt: Date.now() };
    res.json(models);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Check which provider API keys are configured
router.get("/api-keys-status", (_req, res) => {
  const keys: Record<string, boolean> = {
    anthropic: !!process.env.ANTHROPIC_API_KEY,
    openai: !!process.env.OPENAI_API_KEY,
    deepseek: !!process.env.DEEPSEEK_API_KEY,
    gemini: !!process.env.GEMINI_API_KEY,
  };
  res.json(keys);
});

// Test connection to an AI provider
router.post("/test-provider", async (req, res) => {
  const { provider, model } = (req as any).body;
  if (!provider || !model) {
    res.status(400).json({ error: "Provider and model are required" });
    return;
  }

  const envMap: Record<string, string> = {
    anthropic: "ANTHROPIC_API_KEY",
    openai: "OPENAI_API_KEY",
    deepseek: "DEEPSEEK_API_KEY",
    gemini: "GEMINI_API_KEY",
  };

  const apiKey = process.env[envMap[provider]];
  if (!apiKey) {
    res.status(400).json({ error: `${envMap[provider]} is not set` });
    return;
  }

  const testPrompt = 'Respond with exactly: {"status":"ok"}';

  try {
    let responseText = "";

    if (provider === "anthropic") {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const client = new Anthropic({ apiKey });
      const message = await client.messages.create({
        model,
        max_tokens: 32,
        messages: [{ role: "user", content: testPrompt }],
      });
      const content = message.content[0];
      responseText = content.type === "text" ? content.text : "";
    } else if (provider === "gemini") {
      const { GoogleGenerativeAI } = await import("@google/generative-ai");
      const genAI = new GoogleGenerativeAI(apiKey);
      const genModel = genAI.getGenerativeModel({ model, generationConfig: { maxOutputTokens: 32 } });
      const result = await genModel.generateContent(testPrompt);
      responseText = result.response.text();
    } else {
      // openai or deepseek (both use OpenAI SDK)
      const { default: OpenAI } = await import("openai");
      const client = new OpenAI({
        apiKey,
        ...(provider === "deepseek" ? { baseURL: "https://api.deepseek.com" } : {}),
      });
      const response = await client.chat.completions.create({
        model,
        max_tokens: 32,
        messages: [{ role: "user", content: testPrompt }],
      });
      responseText = response.choices[0]?.message?.content || "";
    }

    res.json({ success: true, response: responseText.trim().slice(0, 100) });
  } catch (e: any) {
    res.status(500).json({ error: e.message || "Connection failed" });
  }
});

export default router;
