import * as fal from "@fal-ai/serverless-client";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import pool from "./db.js";

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

// ── Art style registry ──

interface ArtStyleConfig {
  basePrompt: string;
  aspectRatio: string;
  negativePrompt: string;
}

const ART_STYLES: Record<string, ArtStyleConfig> = {
  joking_hazard: {
    basePrompt: "single panel webcomic, 1-2 simple stick figures only, round heads, colored shirts, bold black outlines, plain white background, lots of empty space, minimal detail, no text, no speech bubbles, no words, no crowd, no background objects, no watermarks",
    aspectRatio: "4:3",
    negativePrompt: "realistic, photo, 3d render, complex shading, anime, manga, watermarks, logos, signatures, copyright, crowd, group, many people, busy, detailed background, text, words, letters",
  },
  cah: {
    basePrompt: "dark humor editorial cartoon illustration, bold ink style, simple black and white with one accent color, minimalist",
    aspectRatio: "3:4",
    negativePrompt: "photo, realistic, complex, detailed background",
  },
  apples_to_apples: {
    basePrompt: "colorful playful cartoon illustration, friendly rounded style, bright colors, simple clean design",
    aspectRatio: "3:4",
    negativePrompt: "photo, realistic, dark, scary",
  },
  default: {
    basePrompt: "simple cartoon illustration, bold outlines, flat colors, white background",
    aspectRatio: "4:3",
    negativePrompt: "photo, realistic, 3d render",
  },
};

export function getArtStyle(gameType: string): ArtStyleConfig {
  return ART_STYLES[gameType] || ART_STYLES.default;
}

// Generate image prompts for cards using configured AI provider
export async function generateImagePrompts(
  cards: { id: string; text: string }[],
  context: { theme: string; gameType: string; maturity?: string }
): Promise<Map<string, string>> {
  const settings = await getAiSettings();
  const style = getArtStyle(context.gameType);
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
      console.error(`Failed to generate image prompts for batch ${i}:`, err);
    }
  }

  return result;
}

// Build a full image prompt from card text + deck context
function buildImagePrompt(
  cardText: string,
  style: ArtStyleConfig,
  context?: { theme?: string; maturity?: string; flavorThemes?: string[]; wildcard?: string },
): string {
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

  parts.push(cardText);

  return parts.join(", ");
}

// Generate a single card image via fal.ai Flux Schnell
async function generateCardImage(prompt: string, style: ArtStyleConfig): Promise<string | null> {
  if (!process.env.FAL_KEY) {
    console.error("FAL_KEY not configured");
    return null;
  }

  try {
    const result = await fal.subscribe("fal-ai/flux/schnell", {
      input: {
        prompt,
        image_size: style.aspectRatio === "4:3"
          ? { width: 512, height: 384 }
          : { width: 384, height: 512 },
        num_inference_steps: 4,
        num_images: 1,
      },
    }) as any;

    return result?.images?.[0]?.url || null;
  } catch (err) {
    console.error("fal.ai image generation failed:", err);
    return null;
  }
}

// Composite a speech bubble with text onto an image using sharp
async function addSpeechBubble(imageUrl: string, text: string): Promise<string> {
  // Download the base image
  const response = await fetch(imageUrl);
  const imageBuffer = Buffer.from(await response.arrayBuffer());
  const metadata = await sharp(imageBuffer).metadata();
  const width = metadata.width || 512;
  const height = metadata.height || 384;

  // Render text as an image using sharp's text input (uses pango, no font issues)
  const maxWidth = width - 60;
  const textSvg = `<svg xmlns="http://www.w3.org/2000/svg">
    <style>
      .bubble-text { font: bold 14px "DejaVu Sans", "Noto Sans", "Liberation Sans", sans-serif; fill: #000; }
    </style>
    <text class="bubble-text"><tspan x="0" y="14">${text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")}</tspan></text>
  </svg>`;

  // Create text image with word wrapping via sharp's text input
  const textImage = await sharp({
    text: {
      text: `<span font="14" weight="bold">${text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")}</span>`,
      font: "sans-serif",
      width: maxWidth,
      height: 200,
      align: "centre",
      rgba: true,
    },
  }).png().toBuffer();

  const textMeta = await sharp(textImage).metadata();
  const textWidth = textMeta.width || 200;
  const textHeight = textMeta.height || 20;

  const padding = 12;
  const tailSize = 10;
  const bubbleWidth = textWidth + padding * 2;
  const bubbleHeight = textHeight + padding * 2;
  const bubbleX = Math.round((width - bubbleWidth) / 2);
  const bubbleY = 8;

  // SVG for just the bubble shape (no text)
  const bubbleSvg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect x="${bubbleX}" y="${bubbleY}" width="${bubbleWidth}" height="${bubbleHeight}" rx="8" ry="8" fill="white" stroke="black" stroke-width="2"/>
    <polygon points="${bubbleX + bubbleWidth / 2 - tailSize},${bubbleY + bubbleHeight} ${bubbleX + bubbleWidth / 2 + tailSize},${bubbleY + bubbleHeight} ${bubbleX + bubbleWidth / 2},${bubbleY + bubbleHeight + tailSize}" fill="white" stroke="black" stroke-width="2"/>
    <rect x="${bubbleX + 1}" y="${bubbleY + bubbleHeight - 2}" width="${tailSize * 2}" height="4" fill="white" transform="translate(${bubbleWidth / 2 - tailSize}, 0)"/>
  </svg>`;

  const result = await sharp(imageBuffer)
    .composite([
      { input: Buffer.from(bubbleSvg), top: 0, left: 0 },
      { input: textImage, top: bubbleY + padding, left: bubbleX + padding },
    ])
    .jpeg({ quality: 85 })
    .toBuffer();

  return `data:image/jpeg;base64,${result.toString("base64")}`;
}

// Generate a single preview image for one card (free, no payment required)
export async function generatePreviewImage(
  cardText: string,
  gameType: string,
  theme: string,
  maturity: string = "adult",
  flavorThemes?: string[],
  wildcard?: string,
): Promise<string | null> {
  const style = getArtStyle(gameType);
  const prompt = buildImagePrompt(cardText, style, { theme, maturity, flavorThemes, wildcard });
  const imageUrl = await generateCardImage(prompt, style);
  if (!imageUrl) return null;

  // For Joking Hazard, composite speech bubble with card text
  const isAction = cardText.startsWith("[") || cardText.startsWith("*");
  if (gameType === "joking_hazard" && !isAction) {
    return addSpeechBubble(imageUrl, cardText);
  }
  return imageUrl;
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
    const style = getArtStyle(gameType);
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
    console.log(`[ART] Generating images for ${allCards.length} cards in deck ${deckId}`);

    // Generate images in parallel batches
    const CONCURRENCY = 5;
    const cardImageMap = new Map<string, string>();

    for (let i = 0; i < allCards.length; i += CONCURRENCY) {
      const batch = allCards.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(async (card) => {
          const prompt = buildImagePrompt(card.text, style, context);
          let url = await generateCardImage(prompt, style);
          if (url) {
            // For Joking Hazard non-action cards, composite speech bubble
            const isAction = card.text.startsWith("[") || card.text.startsWith("*");
            if (gameType === "joking_hazard" && !isAction) {
              url = await addSpeechBubble(url, card.text);
            }
            cardImageMap.set(card.id, url);
          }
        })
      );
      // Log failures
      for (let j = 0; j < results.length; j++) {
        if (results[j].status === "rejected") {
          console.error(`[ART] Failed to generate image for card ${batch[j].id}:`, (results[j] as PromiseRejectedResult).reason);
        }
      }
    }

    console.log(`[ART] Generated ${cardImageMap.size}/${allCards.length} images for deck ${deckId}`);

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

    console.log(`[ART] Deck ${deckId} art generation complete`);
  } catch (err) {
    console.error(`[ART] Deck art generation failed for ${deckId}:`, err);
    await pool.query(
      "UPDATE decks SET art_generation_status = 'failed' WHERE id = $1",
      [deckId]
    ).catch(() => {});
  }
}
