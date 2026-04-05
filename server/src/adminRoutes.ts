import { Router } from "express";
import pool from "./db.js";
import { requireAuth, requireAdmin } from "./auth.js";
import { DEFAULT_ART_STYLES, DEFAULT_IMAGE_SUFFIX, FAL_MODELS, FAL_LORA_MODELS, IMAGE_MODEL_DEFAULTS } from "./imageGenerate.js";
import { GAME_TYPE_KEYS, MATURITY_KEYS, getDefaultEngineRules, getDefaultMaturityRules } from "./aiGenerate.js";

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

// List all decks (for featured management)
router.get("/decks", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, built_in, owner_id, game_type,
              jsonb_array_length(chaos_cards) as chaos_count,
              jsonb_array_length(knowledge_cards) as knowledge_count
       FROM decks ORDER BY built_in DESC, created_at DESC`
    );
    res.json(rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      builtIn: r.built_in,
      ownerId: r.owner_id || null,
      gameType: r.game_type || "cah",
      chaosCount: parseInt(r.chaos_count),
      knowledgeCount: parseInt(r.knowledge_count),
    })));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Toggle featured (built_in) status on a deck
router.put("/decks/:id/featured", async (req, res) => {
  const { featured } = (req as any).body;
  if (typeof featured !== "boolean") {
    res.status(400).json({ error: "featured (boolean) is required" });
    return;
  }
  try {
    const { rows } = await pool.query(
      "UPDATE decks SET built_in = $1 WHERE id = $2 RETURNING id, name, built_in",
      [featured, req.params.id]
    );
    if (rows.length === 0) { res.status(404).json({ error: "Deck not found" }); return; }
    res.json({ id: rows[0].id, name: rows[0].name, builtIn: rows[0].built_in });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Get prompt templates (defaults merged with overrides)
router.get("/prompt-templates", async (_req, res) => {
  try {
    // Load overrides from settings
    const { rows } = await pool.query("SELECT value FROM settings WHERE key = 'prompt_templates'");
    const overrides = rows.length > 0 ? rows[0].value || {} : {};

    // Build art styles with defaults + overrides
    const artStyles: Record<string, any> = {};
    for (const [key, style] of Object.entries(DEFAULT_ART_STYLES)) {
      artStyles[key] = {
        basePrompt: overrides.artStyles?.[key]?.basePrompt ?? style.basePrompt,
        negativePrompt: overrides.artStyles?.[key]?.negativePrompt ?? style.negativePrompt,
        aspectRatio: overrides.artStyles?.[key]?.aspectRatio ?? style.aspectRatio,
        ...(style.loras ? { loras: overrides.artStyles?.[key]?.loras ?? style.loras } : {}),
      };
    }

    // Build card engine rules with defaults + overrides
    const cardEngineRules: Record<string, string> = {};
    for (const gt of GAME_TYPE_KEYS) {
      cardEngineRules[gt] = overrides.cardEngineRules?.[gt] ?? getDefaultEngineRules(gt);
    }

    // Build maturity rules with defaults + overrides
    const cardMaturityRules: Record<string, string> = {};
    for (const m of MATURITY_KEYS) {
      cardMaturityRules[m] = overrides.cardMaturityRules?.[m] ?? getDefaultMaturityRules(m);
    }

    res.json({
      artStyles,
      imagePromptSuffix: overrides.imagePromptSuffix ?? DEFAULT_IMAGE_SUFFIX,
      cardEngineRules,
      cardMaturityRules,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Update prompt templates (stores only overrides that differ from defaults)
router.put("/prompt-templates", async (req, res) => {
  const body = (req as any).body;
  if (!body || typeof body !== "object") {
    res.status(400).json({ error: "Invalid body" });
    return;
  }

  try {
    // Build overrides object — only store values that differ from defaults
    const overrides: any = {};

    if (body.artStyles) {
      overrides.artStyles = {};
      for (const [key, style] of Object.entries(body.artStyles as Record<string, any>)) {
        const defaults = DEFAULT_ART_STYLES[key];
        if (!defaults) continue;
        const o: any = {};
        if (style.basePrompt !== undefined && style.basePrompt !== defaults.basePrompt) o.basePrompt = style.basePrompt;
        if (style.negativePrompt !== undefined && style.negativePrompt !== defaults.negativePrompt) o.negativePrompt = style.negativePrompt;
        if (style.aspectRatio !== undefined && style.aspectRatio !== defaults.aspectRatio) o.aspectRatio = style.aspectRatio;
        if (style.loras !== undefined) o.loras = style.loras;
        if (Object.keys(o).length > 0) overrides.artStyles[key] = o;
      }
      if (Object.keys(overrides.artStyles).length === 0) delete overrides.artStyles;
    }

    if (body.imagePromptSuffix !== undefined && body.imagePromptSuffix !== DEFAULT_IMAGE_SUFFIX) {
      overrides.imagePromptSuffix = body.imagePromptSuffix;
    }

    if (body.cardEngineRules) {
      overrides.cardEngineRules = {};
      for (const gt of GAME_TYPE_KEYS) {
        if (body.cardEngineRules[gt] !== undefined && body.cardEngineRules[gt] !== getDefaultEngineRules(gt)) {
          overrides.cardEngineRules[gt] = body.cardEngineRules[gt];
        }
      }
      if (Object.keys(overrides.cardEngineRules).length === 0) delete overrides.cardEngineRules;
    }

    if (body.cardMaturityRules) {
      overrides.cardMaturityRules = {};
      for (const m of MATURITY_KEYS) {
        if (body.cardMaturityRules[m] !== undefined && body.cardMaturityRules[m] !== getDefaultMaturityRules(m)) {
          overrides.cardMaturityRules[m] = body.cardMaturityRules[m];
        }
      }
      if (Object.keys(overrides.cardMaturityRules).length === 0) delete overrides.cardMaturityRules;
    }

    await pool.query(
      `INSERT INTO settings (key, value, updated_at) VALUES ('prompt_templates', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
      [JSON.stringify(overrides)]
    );

    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Reset prompt templates to defaults
router.delete("/prompt-templates", async (_req, res) => {
  try {
    await pool.query("DELETE FROM settings WHERE key = 'prompt_templates'");
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Cache fal.ai models list for 1 hour
let falModelsCache: { data: any[]; fetchedAt: number } | null = null;
const FAL_CACHE_TTL = 60 * 60 * 1000;

async function fetchFalModels(): Promise<any[]> {
  if (falModelsCache && Date.now() - falModelsCache.fetchedAt < FAL_CACHE_TTL) {
    return falModelsCache.data;
  }

  const falKey = process.env.FAL_KEY;
  const allModels: any[] = [];

  try {
    // Fetch text-to-image models from fal.ai API
    const url = "https://fal.ai/api/models?category=text-to-image&limit=100";
    const response = await fetch(url);
    if (!response.ok) throw new Error(`fal.ai API returned ${response.status}`);
    const json = await response.json();

    // Fetch pricing from fal.ai platform API (requires FAL_KEY)
    // Docs: https://fal.ai/docs/documentation/model-apis/pricing
    let pricingMap: Record<string, { unit_price: number; unit: string }> = {};
    if (falKey && json.items?.length) {
      try {
        const endpointIds = json.items
          .filter((m: any) => !m.deprecated)
          .map((m: any) => m.id);

        // Batch in groups of 50 (API limit)
        for (let i = 0; i < endpointIds.length; i += 50) {
          const batch = endpointIds.slice(i, i + 50);
          const pricingUrl = `https://api.fal.ai/v1/models/pricing?${batch.map((id: string) => `endpoint_id=${encodeURIComponent(id)}`).join("&")}`;
          const pricingRes = await fetch(pricingUrl, {
            headers: { Authorization: `Key ${falKey}` },
          });
          if (pricingRes.ok) {
            const pricingData = await pricingRes.json();
            for (const p of pricingData.prices || []) {
              if (p.endpoint_id) pricingMap[p.endpoint_id] = p;
            }
          }
        }
      } catch {
        // Pricing fetch failed, continue without
      }
    }

    for (const m of json.items || []) {
      if (m.deprecated) continue;

      // Get pricing — prefer structured API data, fall back to markdown parsing
      let priceStr = "";
      const pricing = pricingMap[m.id];
      if (pricing) {
        const unitLabel = pricing.unit === "megapixels" || pricing.unit === "processed megapixels"
          ? "MP"
          : pricing.unit === "images" ? "img"
          : pricing.unit === "seconds" ? "sec"
          : pricing.unit || "req";
        priceStr = `$${pricing.unit_price}/${unitLabel}`;
      } else if (m.pricingInfoOverride) {
        // Fallback: parse from markdown when API pricing unavailable
        const perMatch = m.pricingInfoOverride.match(/\*\*\$([0-9.]+)\*\*\s+per\s+(\w+)/i);
        const forMatch = m.pricingInfoOverride.match(/\*\*\$([0-9.]+)\*\*\s+for\s+the\s+first\s+(\w+)/i);
        const costMatch = m.pricingInfoOverride.match(/cost\s+\*\*\$([0-9.]+)\*\*/i);
        if (perMatch) {
          const unit = perMatch[2].toLowerCase();
          priceStr = `$${perMatch[1]}/${unit === "megapixel" ? "MP" : unit === "image" ? "img" : unit}`;
        } else if (forMatch) {
          priceStr = `$${forMatch[1]}/${forMatch[2].toLowerCase() === "megapixel" ? "MP" : forMatch[2]}`;
        } else if (costMatch) {
          priceStr = `$${costMatch[1]}/img`;
        }
      }

      allModels.push({
        id: m.id,
        name: m.title || m.id,
        description: m.shortDescription || "",
        price: priceStr,
        loraSupport: (m.id.includes("/lora") || m.tags?.includes("lora")) ?? false,
        category: m.category || "text-to-image",
        tags: m.tags || [],
      });
    }

    falModelsCache = { data: allModels, fetchedAt: Date.now() };
  } catch (err) {
    console.error("[ADMIN] Failed to fetch fal.ai models:", err);
    // Fall back to hardcoded lists
    for (const m of FAL_MODELS) {
      allModels.push({ ...m, loraSupport: false, description: m.notes, tags: [] });
    }
    for (const m of FAL_LORA_MODELS) {
      allModels.push({ ...m, loraSupport: true, description: m.notes, tags: ["lora"] });
    }
  }

  return allModels;
}

// Get image model settings + available models
router.get("/image-model", async (_req, res) => {
  try {
    const [settingsResult, models] = await Promise.all([
      pool.query("SELECT value FROM settings WHERE key = 'image_model'"),
      fetchFalModels(),
    ]);
    const settings = settingsResult.rows.length > 0
      ? { ...IMAGE_MODEL_DEFAULTS, ...settingsResult.rows[0].value }
      : IMAGE_MODEL_DEFAULTS;

    res.json({
      settings,
      defaults: IMAGE_MODEL_DEFAULTS,
      models,
      falKeyConfigured: !!process.env.FAL_KEY,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Update image model settings
router.put("/image-model", async (req, res) => {
  const body = (req as any).body;
  if (!body || typeof body !== "object") {
    res.status(400).json({ error: "Invalid body" });
    return;
  }

  try {
    const settings: any = {};
    if (body.endpoint) settings.endpoint = body.endpoint;
    if (body.loraEndpoint) settings.loraEndpoint = body.loraEndpoint;
    if (body.numInferenceSteps !== undefined) settings.numInferenceSteps = Number(body.numInferenceSteps);
    if (body.loraNumInferenceSteps !== undefined) settings.loraNumInferenceSteps = Number(body.loraNumInferenceSteps);
    if (body.guidanceScale !== undefined) settings.guidanceScale = Number(body.guidanceScale);

    await pool.query(
      `INSERT INTO settings (key, value, updated_at) VALUES ('image_model', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
      [JSON.stringify(settings)]
    );
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
