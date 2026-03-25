import Anthropic from "@anthropic-ai/sdk";
import pool from "./db.js";

const client = new Anthropic();

interface GeneratedCards {
  chaosCards: { text: string; pick: number }[];
  knowledgeCards: { text: string }[];
}

interface AiSettings {
  model: string;
  maxTokens: number;
  prompt: string;
  defaultChaosCount: number;
  defaultKnowledgeCount: number;
}

const DEFAULT_PROMPT = `Generate cards for a "Cards Against Humanity" style party game about the following theme:

Theme: "{{theme}}"

Generate exactly {{chaosCount}} "Chaos" cards (prompts/black cards) and {{knowledgeCount}} "Knowledge" cards (answer/white cards).

Rules:
- Chaos cards are fill-in-the-blank prompts. Use ___ for the blank.
- Most Chaos cards should have pick:1 (one blank). 2-3 can have pick:2 (two blanks).
- Knowledge cards are short, funny answers (2-10 words).
- Be clever, funny, and a bit edgy but not offensive.
- Cards should be specific to the theme, not generic.

Respond ONLY with valid JSON in this exact format, no other text:
{
  "chaosCards": [{"text": "The ___ is broken again.", "pick": 1}],
  "knowledgeCards": [{"text": "A rogue spreadsheet"}]
}`;

const DEFAULTS: AiSettings = {
  model: "claude-sonnet-4-20250514",
  maxTokens: 2048,
  prompt: DEFAULT_PROMPT,
  defaultChaosCount: 10,
  defaultKnowledgeCount: 25,
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

export async function generateCards(
  theme: string,
  chaosCount?: number,
  knowledgeCount?: number
): Promise<GeneratedCards> {
  const settings = await getAiSettings();
  const cc = chaosCount || settings.defaultChaosCount;
  const kc = knowledgeCount || settings.defaultKnowledgeCount;

  const prompt = settings.prompt
    .replace(/\{\{theme\}\}/g, theme)
    .replace(/\{\{chaosCount\}\}/g, String(cc))
    .replace(/\{\{knowledgeCount\}\}/g, String(kc));

  const message = await client.messages.create({
    model: settings.model,
    max_tokens: settings.maxTokens,
    messages: [{ role: "user", content: prompt }],
  });

  const content = message.content[0];
  if (content.type !== "text") {
    throw new Error("Unexpected response type");
  }

  // Extract JSON from response (handle potential markdown code blocks)
  let jsonStr = content.text.trim();
  const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim();
  }

  const parsed = JSON.parse(jsonStr) as GeneratedCards;

  // Validate structure
  if (!Array.isArray(parsed.chaosCards) || !Array.isArray(parsed.knowledgeCards)) {
    throw new Error("Invalid response structure");
  }

  return parsed;
}
