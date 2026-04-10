import * as fal from "@fal-ai/serverless-client";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import { randomBytes } from "crypto";
import { createLogger } from "./logger.js";

const log = createLogger("art");
import pool from "./db.js";
import path from "path";
import fs from "fs";

// Register Creative Block BB font with fontconfig
const fontsDir = path.resolve(__dirname, "../fonts");
if (fs.existsSync(fontsDir)) {
  const fcDir = path.join(process.env.HOME || "/root", ".config/fontconfig");
  fs.mkdirSync(fcDir, { recursive: true });
  fs.writeFileSync(path.join(fcDir, "fonts.conf"), `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig><dir>${fontsDir}</dir></fontconfig>`);
  log.info("registered custom fonts", { fontsDir });
}

// Configure fal.ai
if (process.env.FAL_KEY) {
  fal.config({ credentials: process.env.FAL_KEY });
}

// ── AI provider support (mirrors aiGenerate.ts) ──

type AiProvider = "anthropic" | "openai" | "deepseek" | "gemini";

interface AiSettings {
  provider: AiProvider;
  model: string;
  maxTokens: number;
}

const DEFAULTS: AiSettings = {
  provider: "deepseek",
  model: "deepseek-chat",
  maxTokens: 2048,
};

async function getAiSettings(): Promise<AiSettings> {
  try {
    const { rows } = await pool.query(
      "SELECT value FROM settings WHERE key = 'ai'"
    );
    if (rows.length > 0) {
      return { ...DEFAULTS, ...rows[0].value };
    }
  } catch {
    // DB not available, use defaults
  }
  return DEFAULTS;
}

function getApiKey(provider: AiProvider): string | undefined {
  const envMap: Record<AiProvider, string> = {
    anthropic: "ANTHROPIC_API_KEY",
    openai: "OPENAI_API_KEY",
    deepseek: "DEEPSEEK_API_KEY",
    gemini: "GEMINI_API_KEY",
  };
  return process.env[envMap[provider]];
}

async function callProvider(settings: AiSettings, prompt: string): Promise<string> {
  const apiKey = getApiKey(settings.provider);
  if (!apiKey) throw new Error(`${settings.provider} API key not configured`);

  switch (settings.provider) {
    case "deepseek": {
      const client = new OpenAI({ apiKey, baseURL: "https://api.deepseek.com" });
      const response = await client.chat.completions.create({
        model: settings.model,
        max_tokens: settings.maxTokens,
        messages: [{ role: "user", content: prompt }],
      });
      const text = response.choices[0]?.message?.content;
      if (!text) throw new Error("Empty response from DeepSeek");
      return text;
    }
    case "openai": {
      const client = new OpenAI({ apiKey });
      const response = await client.chat.completions.create({
        model: settings.model,
        max_tokens: settings.maxTokens,
        messages: [{ role: "user", content: prompt }],
      });
      const text = response.choices[0]?.message?.content;
      if (!text) throw new Error("Empty response from OpenAI");
      return text;
    }
    case "gemini": {
      const genAI = new GoogleGenerativeAI(apiKey);
      const genModel = genAI.getGenerativeModel({
        model: settings.model,
        generationConfig: { maxOutputTokens: settings.maxTokens },
      });
      const result = await genModel.generateContent(prompt);
      const text = result.response.text();
      if (!text) throw new Error("Empty response from Gemini");
      return text;
    }
    case "anthropic":
    default: {
      const client = new Anthropic({ apiKey });
      const message = await client.messages.create({
        model: settings.model,
        max_tokens: settings.maxTokens,
        messages: [{ role: "user", content: prompt }],
      });
      const content = message.content[0];
      if (content.type !== "text" || !content.text) throw new Error("Empty response from Anthropic");
      return content.text;
    }
  }
}

// ── Image model settings ──

export interface ImageModelSettings {
  endpoint: string;
  numInferenceSteps: number;
  guidanceScale: number;
}

export const IMAGE_MODEL_DEFAULTS: ImageModelSettings = {
  endpoint: "fal-ai/flux/schnell",
  numInferenceSteps: 4,
  guidanceScale: 5.0,
};

export async function getImageModelSettings(): Promise<ImageModelSettings> {
  try {
    const { rows } = await pool.query("SELECT value FROM settings WHERE key = 'image_model'");
    if (rows.length > 0) {
      return { ...IMAGE_MODEL_DEFAULTS, ...rows[0].value };
    }
  } catch {}
  return IMAGE_MODEL_DEFAULTS;
}

// Available fal.ai models for the admin UI
export const FAL_MODELS = [
  { id: "fal-ai/flux/schnell", name: "FLUX.1 Schnell", price: "$0.003/MP", speed: "~0.4s", stepsDefault: 4, notes: "Fastest, 12B params" },
  { id: "fal-ai/flux/dev", name: "FLUX.1 Dev", price: "$0.025/MP", speed: "~3s", stepsDefault: 28, notes: "Higher quality, 12B params" },
  { id: "fal-ai/flux-2/klein/9b", name: "FLUX.2 Klein 9B", price: "$0.006/MP", speed: "~1s", stepsDefault: 4, notes: "Lightweight 9B, supports negative prompts" },
  { id: "fal-ai/flux-2-pro", name: "FLUX.2 Pro", price: "$0.03/MP", speed: "~5s", stepsDefault: 0, notes: "Best quality, zero-config (no steps/guidance)" },
] as const;

// ── Art style registry ──

interface ArtStyleConfig {
  basePrompt: string;
  aspectRatio: string;
  negativePrompt: string;
}

export const DEFAULT_IMAGE_SUFFIX = "absolutely no text, no letters, no words, no writing, no captions anywhere in the image";

// ── User-selectable art styles (card-game-friendly) ──

export interface ArtStyleOption {
  id: string;
  label: string;
  description: string;
  icon: string;
  config: ArtStyleConfig;
}

export const ART_STYLE_OPTIONS: ArtStyleOption[] = [
  {
    id: "classic-cartoon",
    label: "Classic Cartoon",
    description: "Bold outlines, flat colors, clean and playful",
    icon: "mdi:draw",
    config: {
      basePrompt: "simple cartoon illustration, bold outlines, flat colors, white background, clean vector style, bright saturated colors",
      aspectRatio: "5:7",
      negativePrompt: "photo, realistic, 3d render, complex shading",
    },
  },
  {
    id: "editorial-ink",
    label: "Editorial Ink",
    description: "Dark humor editorial cartoon, black and white with accent color",
    icon: "mdi:fountain-pen-tip",
    config: {
      basePrompt: "dark humor editorial cartoon illustration, bold ink style, simple black and white with one accent color, minimalist, crosshatching",
      aspectRatio: "5:7",
      negativePrompt: "photo, realistic, complex, detailed background, full color",
    },
  },
  {
    id: "pop-art",
    label: "Pop Art",
    description: "Bold dots, primary colors, comic book halftone",
    icon: "mdi:palette",
    config: {
      basePrompt: "pop art illustration, bold primary colors, Ben-Day dots, thick black outlines, Roy Lichtenstein style, comic book halftone shading, flat graphic design, high contrast",
      aspectRatio: "5:7",
      negativePrompt: "photo, realistic, 3d render, pastel, muted colors, watercolor",
    },
  },
  {
    id: "retro-pixel",
    label: "Retro Pixel",
    description: "16-bit pixel art, nostalgic video game aesthetic",
    icon: "mdi:gamepad-square",
    config: {
      basePrompt: "16-bit pixel art, retro video game style, limited color palette, clean pixel edges, nostalgic SNES era, character sprite, simple background",
      aspectRatio: "5:7",
      negativePrompt: "photo, realistic, 3d render, smooth gradients, high resolution detail, anti-aliased",
    },
  },
  {
    id: "woodcut",
    label: "Woodcut Print",
    description: "Bold black and white woodblock print, vintage feel",
    icon: "mdi:axe",
    config: {
      basePrompt: "woodcut print illustration, bold black and white, strong contrast, hand-carved lines, vintage printmaking, linocut style, dramatic shadows, simple composition",
      aspectRatio: "5:7",
      negativePrompt: "photo, realistic, color, 3d render, smooth gradients, pastel, anime",
    },
  },
  {
    id: "watercolor",
    label: "Watercolor",
    description: "Soft washes, flowing colors, artistic and dreamy",
    icon: "mdi:water",
    config: {
      basePrompt: "watercolor painting, soft flowing colors, visible brushstrokes, artistic washes, light and airy, gentle color bleeding, delicate illustration, white paper background",
      aspectRatio: "5:7",
      negativePrompt: "photo, realistic, 3d render, sharp edges, vector, pixel art, dark, heavy",
    },
  },
  {
    id: "noir-comic",
    label: "Noir Comic",
    description: "Hard-boiled graphic novel, heavy shadows, GTA style",
    icon: "mdi:detective",
    config: {
      basePrompt: "hard-boiled noir comic illustration, heavy black ink line art, high contrast, grayscale with halftone shading, one bold pop of yellow accent color, deadpan serious dramatic pose, semi-realistic proportions with exaggerated features, thick ink outlines, graphic novel aesthetic, GTA loading screen style, clean white background, single character centered",
      aspectRatio: "5:7",
      negativePrompt: "photo, 3d render, anime, manga, cute, cartoonish, pastel colors, full color, rainbow, complex background, text, words, letters, watermarks, logos, stick figure, chibi",
    },
  },
  {
    id: "sticker",
    label: "Sticker",
    description: "Cute die-cut sticker look, thick white border",
    icon: "mdi:sticker-emoji",
    config: {
      basePrompt: "cute sticker illustration, thick white outline border, kawaii style, chibi proportions, simple flat colors, clean vector design, die-cut sticker on plain background, adorable character",
      aspectRatio: "5:7",
      negativePrompt: "photo, realistic, 3d render, complex background, dark, scary, detailed shading",
    },
  },
  {
    id: "tarot",
    label: "Tarot Card",
    description: "Mystical art nouveau, ornate borders, rich gold tones",
    icon: "mdi:cards",
    config: {
      basePrompt: "tarot card illustration, art nouveau style, ornate decorative border, mystical symbolism, rich gold and deep jewel tones, intricate line work, Alphonse Mucha inspired, dramatic composition, single central figure",
      aspectRatio: "5:7",
      negativePrompt: "photo, realistic, 3d render, cartoon, pixel art, modern, minimalist",
    },
  },
  {
    id: "manga",
    label: "Manga",
    description: "Japanese manga style, expressive characters, screen tones",
    icon: "mdi:star-four-points",
    config: {
      basePrompt: "manga illustration, Japanese comic style, expressive character, screen tone shading, dynamic pose, large eyes, clean ink lines, speed lines, black and white with selective color accents",
      aspectRatio: "5:7",
      negativePrompt: "photo, realistic, 3d render, western cartoon, pixel art, watercolor, oil painting",
    },
  },
  {
    id: "vintage-ad",
    label: "Vintage Ad",
    description: "1950s advertisement style, retro Americana",
    icon: "mdi:television-classic",
    config: {
      basePrompt: "1950s vintage advertisement illustration, retro Americana, limited color print, halftone dots, mid-century design, cheerful characters, clean graphic style, nostalgic wholesome aesthetic",
      aspectRatio: "5:7",
      negativePrompt: "photo, modern, 3d render, anime, dark, grunge, complex",
    },
  },
  {
    id: "neon-glow",
    label: "Neon Glow",
    description: "Vibrant neon colors on dark background, synthwave",
    icon: "mdi:lightning-bolt",
    config: {
      basePrompt: "neon glow illustration, vibrant neon pink and cyan and purple, dark background, synthwave aesthetic, glowing outlines, retrowave, electric atmosphere, bold silhouette, simple composition",
      aspectRatio: "5:7",
      negativePrompt: "photo, realistic, natural lighting, pastel, muted, watercolor, daytime",
    },
  },
  {
    id: "chalk-sketch",
    label: "Chalk Sketch",
    description: "Chalkboard drawing, hand-drawn, whimsical doodle",
    icon: "mdi:lead-pencil",
    config: {
      basePrompt: "chalk drawing on dark chalkboard, white and colored chalk, hand-drawn doodle style, whimsical sketch, loose line work, textured chalk strokes, simple illustration, playful",
      aspectRatio: "5:7",
      negativePrompt: "photo, realistic, 3d render, clean vector, digital, smooth, polished",
    },
  },
  {
    id: "ukiyo-e",
    label: "Ukiyo-e",
    description: "Japanese woodblock print, flat colors, flowing lines",
    icon: "mdi:waves",
    config: {
      basePrompt: "ukiyo-e Japanese woodblock print, flat bold colors, flowing lines, Hokusai inspired, traditional Japanese art, dramatic composition, stylized figures, decorative patterns, limited color palette",
      aspectRatio: "5:7",
      negativePrompt: "photo, realistic, 3d render, western art, pixel art, modern digital",
    },
  },
  {
    id: "graffiti",
    label: "Graffiti",
    description: "Street art spray paint style, bold and urban",
    icon: "mdi:spray",
    config: {
      basePrompt: "graffiti street art illustration, spray paint style, bold colors, dripping paint, urban wall texture, wildstyle lettering influence, stencil art, vibrant and rebellious, brick wall background",
      aspectRatio: "5:7",
      negativePrompt: "photo, realistic, 3d render, clean, corporate, watercolor, pastel, delicate",
    },
  },
  {
    id: "paper-cutout",
    label: "Paper Cutout",
    description: "Layered paper craft, shadow depth, handmade feel",
    icon: "mdi:content-cut",
    config: {
      basePrompt: "paper cutout collage illustration, layered construction paper, visible paper texture, drop shadows between layers, handmade craft aesthetic, simple shapes, bold flat colors, playful composition",
      aspectRatio: "5:7",
      negativePrompt: "photo, realistic, 3d render, digital, smooth, gradient, complex shading",
    },
  },
  {
    id: "minimalist",
    label: "Minimalist",
    description: "Simple geometric shapes, limited palette, modern",
    icon: "mdi:circle-outline",
    config: {
      basePrompt: "minimalist illustration, simple geometric shapes, limited two-tone color palette, lots of negative space, modern graphic design, clean lines, abstract representation, sophisticated simplicity",
      aspectRatio: "5:7",
      negativePrompt: "photo, realistic, detailed, complex, busy, ornate, 3d render, textured",
    },
  },
  {
    id: "gothic",
    label: "Gothic",
    description: "Dark medieval, ornate details, moody atmosphere",
    icon: "mdi:skull",
    config: {
      basePrompt: "gothic illustration, dark medieval aesthetic, ornate decorative elements, moody atmospheric, deep burgundy and black, intricate line work, dramatic lighting, cathedral-inspired composition, macabre elegance",
      aspectRatio: "5:7",
      negativePrompt: "photo, realistic, 3d render, bright, cheerful, cartoon, cute, pastel, modern",
    },
  },
];

// Game-type defaults map to art style option IDs
const GAME_TYPE_DEFAULT_STYLES: Record<string, string> = {
  joking_hazard: "classic-cartoon", // Joking Hazard has its own special stick-figure style override
  cah: "editorial-ink",
  apples_to_apples: "classic-cartoon",
  superfight: "noir-comic",
};

// Special game-type overrides that differ from the selectable art style options
const GAME_TYPE_STYLE_OVERRIDES: Record<string, ArtStyleConfig> = {
  joking_hazard: {
    basePrompt: "stick figure character, single panel webcomic, round heads, colored shirts, black outlines on characters only, plain white background seamless to edges, no border, no frame, no panel outline, characters large and centered filling most of the frame, close-up framing, minimal detail, no text, no speech bubbles, no words, no crowd, no background objects, no watermarks",
    aspectRatio: "5:7",
    negativePrompt: "realistic, photo, 3d render, complex shading, anime, manga, watermarks, logos, signatures, copyright, crowd, group, many people, busy, detailed background, text, words, letters, border, frame, panel outline, black border",
  },
};

export const DEFAULT_ART_STYLES: Record<string, ArtStyleConfig> = {
  joking_hazard: GAME_TYPE_STYLE_OVERRIDES.joking_hazard,
  cah: ART_STYLE_OPTIONS.find(o => o.id === "editorial-ink")!.config,
  apples_to_apples: ART_STYLE_OPTIONS.find(o => o.id === "classic-cartoon")!.config,
  superfight: ART_STYLE_OPTIONS.find(o => o.id === "noir-comic")!.config,
  default: ART_STYLE_OPTIONS.find(o => o.id === "classic-cartoon")!.config,
};

async function getPromptTemplateOverrides(): Promise<any> {
  try {
    const { rows } = await pool.query("SELECT value FROM settings WHERE key = 'prompt_templates'");
    if (rows.length > 0) return rows[0].value || {};
  } catch {}
  return {};
}

export async function getArtStyle(gameType: string, artStyle?: string): Promise<ArtStyleConfig> {
  // If user selected a specific art style, use it (unless game type has a forced override)
  if (artStyle && !GAME_TYPE_STYLE_OVERRIDES[gameType]) {
    const option = ART_STYLE_OPTIONS.find(o => o.id === artStyle);
    if (option) return option.config;
  }

  const defaults = DEFAULT_ART_STYLES[gameType] || DEFAULT_ART_STYLES.default;
  try {
    const overrides = await getPromptTemplateOverrides();
    if (overrides.artStyles?.[gameType]) {
      const o = overrides.artStyles[gameType];
      return {
        ...defaults,
        ...(o.basePrompt !== undefined ? { basePrompt: o.basePrompt } : {}),
        ...(o.negativePrompt !== undefined ? { negativePrompt: o.negativePrompt } : {}),
        ...(o.aspectRatio !== undefined ? { aspectRatio: o.aspectRatio } : {}),
      };
    }
  } catch {}
  return defaults;
}

export async function getImageSuffix(): Promise<string> {
  try {
    const overrides = await getPromptTemplateOverrides();
    if (overrides.imagePromptSuffix !== undefined) return overrides.imagePromptSuffix;
  } catch {}
  return DEFAULT_IMAGE_SUFFIX;
}

// ── Art library persistence ──

export async function saveToArtLibrary(opts: {
  imageData: string; // fal.ai URL or data:image/... URI
  prompt: string;
  sourceCardText: string;
  gameType: string;
  deckName?: string;
  width?: number;
  height?: number;
  hasSpeechBubble?: boolean;
  generatedBy?: string;
}): Promise<string | null> {
  try {
    let buffer: Buffer;
    if (opts.imageData.startsWith("data:")) {
      // base64 data URI
      const base64 = opts.imageData.split(",")[1];
      buffer = Buffer.from(base64, "base64");
    } else {
      // HTTP URL — download the image
      const response = await fetch(opts.imageData);
      if (!response.ok) throw new Error(`Failed to fetch image: ${response.status}`);
      buffer = Buffer.from(await response.arrayBuffer());
    }

    const id = randomBytes(8).toString("hex");
    const { rows } = await pool.query(
      `INSERT INTO art_library (id, data, prompt, source_card_text, game_type, deck_name, width, height, has_speech_bubble, generated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (md5(prompt || source_card_text || game_type)) DO UPDATE SET use_count = art_library.use_count
       RETURNING id`,
      [
        id,
        buffer,
        opts.prompt,
        opts.sourceCardText,
        opts.gameType,
        opts.deckName || "",
        opts.width || 384,
        opts.height || 512,
        opts.hasSpeechBubble || false,
        opts.generatedBy || null,
      ]
    );
    return rows[0].id;
  } catch (err) {
    log.error("failed to save to art library", { error: String(err) });
    return null;
  }
}

// Generate image prompts for cards using configured AI provider
export async function generateImagePrompts(
  cards: { id: string; text: string }[],
  context: { theme: string; gameType: string; maturity?: string }
): Promise<Map<string, string>> {
  const settings = await getAiSettings();
  const style = await getArtStyle(context.gameType);
  const result = new Map<string, string>();

  // Batch cards into groups of 30
  const batchSize = 30;
  for (let i = 0; i < cards.length; i += batchSize) {
    const batch = cards.slice(i, i + batchSize);
    const cardList = batch.map((c) => `- ID: "${c.id}" | Text: "${c.text}"`).join("\n");

    const prompt = `You are generating image prompts for a card game called "${context.theme}".
Game type: ${context.gameType}
Art style: ${style.basePrompt}
Maturity: ${context.maturity || "adult"}

For each card below, generate a short (15-25 word) image generation prompt that visually represents the card's text or concept. The prompt should work with the art style above.

For cards with stage directions in [brackets], depict the action described.
For cards with speech/dialogue, show a character saying or reacting to that text.
For cards that are just nouns or concepts, depict them visually.
Keep scenes simple — 1-2 characters max, minimal background.

Cards:
${cardList}

Respond ONLY with valid JSON — an object mapping card IDs to image prompts:
{
  "${batch[0]?.id}": "image prompt here",
  ...
}`;

    try {
      const text = await callProvider(settings, prompt);
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        for (const [id, imagePrompt] of Object.entries(parsed)) {
          if (typeof imagePrompt === "string") {
            result.set(id, imagePrompt);
          }
        }
      }
    } catch (err) {
      log.error("failed to generate image prompts for batch", { batch: i, error: String(err) });
    }
  }

  return result;
}

// Convert card text to a visual-only scene description using AI
async function cardTextToVisualPrompt(cardText: string): Promise<string> {
  const settings = await getAiSettings();
  const prompt = `Convert this card game text into a short (10-20 word) visual scene description for an image generator. Describe ONLY what to draw — characters, poses, expressions, objects, actions. Do NOT include any words, dialogue, text, letters, or speech in the description. Replace any spoken words with the character's emotion or physical action instead.

Card text: "${cardText}"

Respond with ONLY the visual description, nothing else.`;

  try {
    const description = await callProvider(settings, prompt);
    return description.trim().replace(/^["']|["']$/g, "");
  } catch (err) {
    log.error("failed to convert card text to visual prompt, using fallback", { error: String(err) });
    // Fallback: strip quoted speech and just describe the action
    return cardText
      .replace(/["'].*?["']/g, "")
      .replace(/[!?.]+/g, "")
      .trim() || cardText;
  }
}

// Build a full image prompt from card text + deck context
async function buildImagePrompt(
  cardText: string,
  style: ArtStyleConfig,
  context?: { theme?: string; maturity?: string; flavorThemes?: string[]; wildcard?: string },
): Promise<string> {
  const suffix = await getImageSuffix();

  // Use AI to convert card text to a purely visual description
  const visualDescription = await cardTextToVisualPrompt(cardText);

  const parts = [style.basePrompt];
  if (context?.flavorThemes?.length) {
    parts.push(context.flavorThemes.join(", ") + " theme");
  }
  if (context?.wildcard) {
    parts.push(context.wildcard);
  }
  if (context?.maturity && context.maturity !== "adult") {
    parts.push(`${context.maturity} tone`);
  }

  parts.push(visualDescription);
  if (suffix) {
    parts.push(suffix);
  }

  return parts.join(", ");
}

// Generate a single card image via fal.ai Flux
async function generateCardImage(prompt: string, style: ArtStyleConfig): Promise<string | null> {
  if (!process.env.FAL_KEY) {
    log.error("FAL_KEY not configured");
    return null;
  }

  const settings = await getImageModelSettings();

  const imageSize = style.aspectRatio === "4:3"
    ? { width: 512, height: 384 }
    : style.aspectRatio === "5:7"
    ? { width: 384, height: 536 }
    : { width: 384, height: 512 };

  try {
    const input: any = {
      prompt,
      image_size: imageSize,
      num_images: 1,
    };

    if (settings.numInferenceSteps > 0) input.num_inference_steps = settings.numInferenceSteps;
    if (settings.guidanceScale > 0) input.guidance_scale = settings.guidanceScale;
    if (style.negativePrompt) input.negative_prompt = style.negativePrompt;

    const result = await fal.subscribe(settings.endpoint, { input }) as any;

    return result?.images?.[0]?.url || null;
  } catch (err) {
    log.error("fal.ai image generation failed", { error: String(err) });
    return null;
  }
}

// Composite text onto an image (Joking Hazard style: white strip at top with text + curved tail)
async function addSpeechBubble(imageUrl: string, text: string): Promise<string> {
  try {
    // Download the base image
    const response = await fetch(imageUrl);
    const imageBuffer = Buffer.from(await response.arrayBuffer());
    const metadata = await sharp(imageBuffer).metadata();
    const origWidth = metadata.width || 384;
    const origHeight = metadata.height || 536;

    // Truncate very long text to avoid Sharp/Pango overflow
    const truncated = text.length > 200 ? text.slice(0, 197) + "..." : text;
    const escaped = truncated.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const maxTextWidth = Math.min(origWidth - 24, 600);
    const maxStripHeight = Math.round(origHeight * 0.25); // Cap text area at 25% of image

    // Try font size 14, fall back to 11 if text is too tall
    let textImage: Buffer = Buffer.alloc(0);
    let textWidth = 200;
    let textHeight = 20;

    for (const fontSize of [14, 11]) {
      textImage = await sharp({
        text: {
          text: `<span font="CreativeBlock BB ${fontSize}">${escaped}</span>`,
          font: "CreativeBlock BB",
          width: maxTextWidth,
          dpi: 200,
          align: "centre",
          rgba: true,
        },
      }).png().toBuffer();

      const textMeta = await sharp(textImage!).metadata();
      textWidth = textMeta.width || 200;
      textHeight = textMeta.height || 20;

      if (textHeight + 22 <= maxStripHeight) break; // 22 = padding*2 + tailSize
    }

    // White strip height: text height + padding + tail
    const padding = 6;
    const tailSize = 10;
    const stripHeight = textHeight + padding * 2 + tailSize;

    // Keep original dimensions — white strip on top, image fills the rest
    const finalWidth = origWidth;
    const finalHeight = origHeight;

    const textX = Math.round((finalWidth - textWidth) / 2);
    const textY = padding;

    // Curved tail from bottom of text area pointing down-left
    const tailStartX = Math.round(finalWidth * 0.45);
    const tailEndX = Math.round(finalWidth * 0.40);
    const tailStartY = textY + textHeight + 4;
    const tailEndY = stripHeight - 2;
    const tailCpX = tailStartX - 10;
    const tailCpY = tailStartY + (tailEndY - tailStartY) * 0.6;

    // SVG for the tail line
    const tailSvg = `<svg width="${finalWidth}" height="${finalHeight}" xmlns="http://www.w3.org/2000/svg">
      <path d="M ${tailStartX} ${tailStartY} Q ${tailCpX} ${tailCpY} ${tailEndX} ${tailEndY}" fill="none" stroke="black" stroke-width="1.5" stroke-linecap="round"/>
    </svg>`;

    // Resize original image to fit below the white strip, maintaining width
    const imageAreaHeight = finalHeight - stripHeight;
    const resizedImage = await sharp(imageBuffer)
      .resize(finalWidth, imageAreaHeight, { fit: "cover", position: "top" })
      .toBuffer();

    // Create white canvas, then composite resized image below strip and text on top
    const result = await sharp({
      create: {
        width: finalWidth,
        height: finalHeight,
        channels: 3,
        background: { r: 255, g: 255, b: 255 },
      },
    })
      .composite([
        // Original image placed below the white strip
        { input: resizedImage, top: stripHeight, left: 0 },
        // Black text
        { input: textImage, top: textY, left: textX },
        // Curved tail line
        { input: Buffer.from(tailSvg), top: 0, left: 0 },
      ])
      .jpeg({ quality: 85 })
      .toBuffer();

    return `data:image/jpeg;base64,${result.toString("base64")}`;
  } catch (err) {
    log.error("speech bubble compositing failed, using plain image", { error: String(err) });
    return imageUrl;
  }
}

// Generate a single preview image for one card (free, no payment required)
export async function generatePreviewImage(
  cardText: string,
  gameType: string,
  theme: string,
  maturity: string = "adult",
  flavorThemes?: string[],
  wildcard?: string,
  userId?: string,
  artStyle?: string,
): Promise<{ imageUrl: string; artLibraryId?: string } | null> {
  const style = await getArtStyle(gameType, artStyle);
  const prompt = await buildImagePrompt(cardText, style, { theme, maturity, flavorThemes, wildcard });
  const imageUrl = await generateCardImage(prompt, style);
  if (!imageUrl) return null;

  // For Joking Hazard, composite speech bubble with card text
  const isAction = cardText.startsWith("[") || cardText.startsWith("*");
  const hasSpeechBubble = gameType === "joking_hazard" && !isAction;
  const finalImage = hasSpeechBubble ? await addSpeechBubble(imageUrl, cardText) : imageUrl;

  // Persist to art library (fire-and-forget)
  const imageSize = style.aspectRatio === "4:3"
    ? { width: 512, height: 384 }
    : style.aspectRatio === "5:7"
    ? { width: 384, height: 536 }
    : { width: 384, height: 512 };

  const artId = await saveToArtLibrary({
    imageData: finalImage,
    prompt,
    sourceCardText: cardText,
    gameType,
    deckName: theme,
    width: imageSize.width,
    height: imageSize.height,
    hasSpeechBubble,
    generatedBy: userId,
  });

  return { imageUrl: finalImage, artLibraryId: artId || undefined };
}

// Main pipeline: generate art for all cards in a deck
export async function generateDeckArt(deckId: string): Promise<void> {
  try {
    // Update status to generating
    await pool.query(
      "UPDATE decks SET art_generation_status = 'generating' WHERE id = $1",
      [deckId]
    );

    // Fetch the deck
    const { rows } = await pool.query("SELECT * FROM decks WHERE id = $1", [deckId]);
    if (rows.length === 0) throw new Error("Deck not found");
    const deck = rows[0];

    const chaosCards: any[] = deck.chaos_cards || [];
    const knowledgeCards: any[] = deck.knowledge_cards || [];
    const gameType = deck.game_type || "cah";
    const theme = deck.name;
    const maturity = deck.maturity || "adult";
    const flavorThemes: string[] = deck.flavor_themes || [];
    const wildcard: string = deck.wildcard || "";
    const artStyleId: string = deck.art_style || "";
    const style = await getArtStyle(gameType, artStyleId);
    const context = { theme, maturity, flavorThemes, wildcard };

    // Collect all cards that need images
    const allCards = [
      ...chaosCards.map((c: any) => ({ id: c.id, text: c.text })),
      ...knowledgeCards.map((c: any) => ({ id: c.id, text: c.text })),
    ];

    if (allCards.length === 0) {
      await pool.query(
        "UPDATE decks SET art_generation_status = 'complete' WHERE id = $1",
        [deckId]
      );
      return;
    }

    // Generate images directly from card text — art style provides the visual direction
    log.info("generating images", { deckId, cardCount: allCards.length });

    // Generate images in parallel batches
    const CONCURRENCY = 5;
    const cardImageMap = new Map<string, string>();

    for (let i = 0; i < allCards.length; i += CONCURRENCY) {
      const batch = allCards.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(async (card) => {
          const prompt = await buildImagePrompt(card.text, style, context);
          let url = await generateCardImage(prompt, style);
          if (url) {
            // For Joking Hazard non-action cards, composite speech bubble
            const isAction = card.text.startsWith("[") || card.text.startsWith("*");
            const hasSpeechBubble = gameType === "joking_hazard" && !isAction;
            if (hasSpeechBubble) {
              url = await addSpeechBubble(url, card.text);
            }
            cardImageMap.set(card.id, url);

            // Save to art library (fire-and-forget)
            const imgSize = style.aspectRatio === "4:3"
              ? { width: 512, height: 384 }
              : style.aspectRatio === "5:7"
              ? { width: 384, height: 536 }
              : { width: 384, height: 512 };
            saveToArtLibrary({
              imageData: url,
              prompt,
              sourceCardText: card.text,
              gameType,
              deckName: theme,
              width: imgSize.width,
              height: imgSize.height,
              hasSpeechBubble,
              generatedBy: deck.owner_id || undefined,
            }).catch((e) => log.error("art library save failed", { error: String(e) }));
          }
        })
      );
      // Log failures
      for (let j = 0; j < results.length; j++) {
        if (results[j].status === "rejected") {
          log.error("failed to generate image for card", { cardId: batch[j].id, error: String((results[j] as PromiseRejectedResult).reason) });
        }
      }
    }

    log.info("image generation batch complete", { deckId, generated: cardImageMap.size, total: allCards.length });

    // Update cards with image URLs
    const updatedChaos = chaosCards.map((c: any) => ({
      ...c,
      ...(cardImageMap.has(c.id) ? { imageUrl: cardImageMap.get(c.id) } : {}),
    }));
    const updatedKnowledge = knowledgeCards.map((c: any) => ({
      ...c,
      ...(cardImageMap.has(c.id) ? { imageUrl: cardImageMap.get(c.id) } : {}),
    }));

    // Save updated cards and mark complete
    await pool.query(
      `UPDATE decks SET chaos_cards = $1, knowledge_cards = $2, art_generation_status = 'complete' WHERE id = $3`,
      [JSON.stringify(updatedChaos), JSON.stringify(updatedKnowledge), deckId]
    );

    log.info("deck art generation complete", { deckId });
  } catch (err) {
    log.error("deck art generation failed", { deckId, error: String(err) });
    await pool.query(
      "UPDATE decks SET art_generation_status = 'failed' WHERE id = $1",
      [deckId]
    ).catch(() => {});
  }
}
