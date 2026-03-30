import * as fal from "@fal-ai/serverless-client";
import Anthropic from "@anthropic-ai/sdk";
import pool from "./db.js";

// Configure fal.ai
if (process.env.FAL_KEY) {
  fal.config({ credentials: process.env.FAL_KEY });
}

// Art style registry — extensible per game type
interface ArtStyleConfig {
  basePrompt: string;
  aspectRatio: string;
  negativePrompt: string;
}

const ART_STYLES: Record<string, ArtStyleConfig> = {
  joking_hazard: {
    basePrompt: "simple webcomic panel, bold black outlines, stick figure characters with round heads and colored shirts, flat colors, white background, Cyanide and Happiness art style, single panel comic",
    aspectRatio: "4:3",
    negativePrompt: "realistic, photo, 3d render, complex shading, anime, manga",
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

// Generate image prompts for cards using Claude
export async function generateImagePrompts(
  cards: { id: string; text: string }[],
  context: { theme: string; gameType: string; maturity?: string }
): Promise<Map<string, string>> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");

  const client = new Anthropic({ apiKey });
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
      const message = await client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2048,
        messages: [{ role: "user", content: prompt }],
      });
      const text = message.content[0].type === "text" ? message.content[0].text : "";
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

// Generate a single card image via fal.ai Flux
async function generateCardImage(prompt: string, style: ArtStyleConfig): Promise<string | null> {
  if (!process.env.FAL_KEY) {
    console.error("FAL_KEY not configured");
    return null;
  }

  const fullPrompt = `${style.basePrompt}, ${prompt}`;

  try {
    const result = await fal.subscribe("fal-ai/flux/schnell", {
      input: {
        prompt: fullPrompt,
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
    const style = getArtStyle(gameType);

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

    // Generate image prompts via Claude
    console.log(`[ART] Generating image prompts for ${allCards.length} cards in deck ${deckId}`);
    const imagePrompts = await generateImagePrompts(allCards, { theme, gameType, maturity });

    // Generate images in parallel batches
    const CONCURRENCY = 5;
    const cardImageMap = new Map<string, string>();
    const cardIds = Array.from(imagePrompts.keys());

    for (let i = 0; i < cardIds.length; i += CONCURRENCY) {
      const batch = cardIds.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(async (cardId) => {
          const prompt = imagePrompts.get(cardId)!;
          const url = await generateCardImage(prompt, style);
          if (url) {
            cardImageMap.set(cardId, url);
          }
        })
      );
      // Log failures
      for (let j = 0; j < results.length; j++) {
        if (results[j].status === "rejected") {
          console.error(`[ART] Failed to generate image for card ${batch[j]}:`, (results[j] as PromiseRejectedResult).reason);
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
