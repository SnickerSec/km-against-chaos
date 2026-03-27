import { Router } from "express";
import pool from "./db.js";
import { requireAuth, requireAdmin } from "./auth.js";

// Cache OpenRouter models for 1 hour
let modelsCache: { data: any[]; fetchedAt: number } | null = null;
const CACHE_TTL = 60 * 60 * 1000;

const router = Router();

const ADMIN_BODY_LIMIT = 100 * 1024; // 100 KB

router.use((req, res, next) => {
  if (req.headers["content-type"]?.includes("application/json")) {
    let body = "";
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > ADMIN_BODY_LIMIT) {
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

// Fetch models — use native provider APIs when keys are available, OpenRouter as fallback
router.get("/models", async (_req, res) => {
  try {
    if (modelsCache && Date.now() - modelsCache.fetchedAt < CACHE_TTL) {
      return res.json(modelsCache.data);
    }

    const allModels: { id: string; name: string; provider: string; contextLength?: number }[] = [];

    // Fetch from native provider APIs in parallel
    const fetches: Promise<void>[] = [];

    // DeepSeek — OpenAI-compatible /models endpoint
    if (process.env.DEEPSEEK_API_KEY) {
      fetches.push(
        fetch("https://api.deepseek.com/models", {
          headers: { Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}` },
        })
          .then((r) => r.json())
          .then((json: any) => {
            for (const m of json.data || []) {
              allModels.push({ id: m.id, name: m.id, provider: "deepseek" });
            }
          })
          .catch(() => {})
      );
    }

    // OpenAI — native /models endpoint
    if (process.env.OPENAI_API_KEY) {
      fetches.push(
        fetch("https://api.openai.com/v1/models", {
          headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        })
          .then((r) => r.json())
          .then((json: any) => {
            for (const m of json.data || []) {
              // Filter to chat models (skip embeddings, whisper, dall-e, etc.)
              if (m.id.startsWith("gpt-") || m.id.startsWith("o1") || m.id.startsWith("o3") || m.id.startsWith("o4")) {
                allModels.push({ id: m.id, name: m.id, provider: "openai" });
              }
            }
          })
          .catch(() => {})
      );
    }

    // Anthropic — no public list endpoint, use known models
    if (process.env.ANTHROPIC_API_KEY) {
      allModels.push(
        { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4", provider: "anthropic" },
        { id: "claude-opus-4-20250514", name: "Claude Opus 4", provider: "anthropic" },
        { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5", provider: "anthropic" },
      );
    }

    // Gemini — no simple list endpoint, use known models
    if (process.env.GEMINI_API_KEY) {
      allModels.push(
        { id: "gemini-2.5-flash-preview-05-20", name: "Gemini 2.5 Flash", provider: "google" },
        { id: "gemini-2.5-pro-preview-05-06", name: "Gemini 2.5 Pro", provider: "google" },
        { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash", provider: "google" },
        { id: "gemini-2.0-flash-lite", name: "Gemini 2.0 Flash Lite", provider: "google" },
      );
    }

    await Promise.all(fetches);

    // Fall back to OpenRouter for providers without keys
    const coveredProviders = new Set(allModels.map((m) => m.provider));
    const needsFallback = !coveredProviders.has("anthropic") || !coveredProviders.has("openai")
      || !coveredProviders.has("deepseek") || !coveredProviders.has("google");

    if (needsFallback) {
      try {
        const response = await fetch("https://openrouter.ai/api/v1/models");
        if (response.ok) {
          const json = await response.json();
          const providerMap: Record<string, string> = {
            anthropic: "anthropic",
            openai: "openai",
            deepseek: "deepseek",
            google: "google",
          };
          for (const m of json.data || []) {
            const prefix = m.id.split("/")[0];
            const mapped = providerMap[prefix];
            if (mapped && !coveredProviders.has(mapped) && m.architecture?.output_modalities?.includes("text")) {
              allModels.push({
                id: m.id,
                name: m.name,
                provider: mapped,
                contextLength: m.context_length,
              });
            }
          }
        }
      } catch {
        // OpenRouter unavailable, continue with what we have
      }
    }

    // Sort by provider then name
    allModels.sort((a, b) => a.provider.localeCompare(b.provider) || a.id.localeCompare(b.id));

    modelsCache = { data: allModels, fetchedAt: Date.now() };
    res.json(allModels);
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

// List all users (for role management)
router.get("/users", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, name, email, picture, role FROM users ORDER BY name ASC"
    );
    res.json(rows.map((r: any) => ({ id: r.id, name: r.name, email: r.email, picture: r.picture, role: r.role || null })));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Set a user's role
router.put("/users/:id/role", requireAuth, requireAdmin, async (req, res) => {
  const body = (req as any).body;
  const role = body.role === "admin" || body.role === "moderator" ? body.role : null;
  try {
    const { rows } = await pool.query(
      "UPDATE users SET role = $1 WHERE id = $2 RETURNING id, name, email, picture, role",
      [role, req.params.id]
    );
    if (rows.length === 0) { res.status(404).json({ error: "User not found" }); return; }
    res.json({ id: rows[0].id, name: rows[0].name, email: rows[0].email, picture: rows[0].picture, role: rows[0].role || null });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
