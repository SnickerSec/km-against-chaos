import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import pool from "./db.js";

interface GeneratedCards {
  chaosCards: { text: string; pick: number }[];
  knowledgeCards: { text: string }[];
}

interface GeneratedDeck {
  name: string;
  description: string;
  chaosCards: { text: string; pick: number }[];
  knowledgeCards: { text: string }[];
}

export type AiProvider = "anthropic" | "openai" | "deepseek" | "gemini";

export interface AiSettings {
  provider: AiProvider;
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
  provider: "anthropic",
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

async function getApiKey(provider: AiProvider): Promise<string | undefined> {
  // Env vars take priority
  const envMap: Record<AiProvider, string> = {
    anthropic: "ANTHROPIC_API_KEY",
    openai: "OPENAI_API_KEY",
    deepseek: "DEEPSEEK_API_KEY",
    gemini: "GEMINI_API_KEY",
  };
  const envKey = process.env[envMap[provider]];
  if (envKey) return envKey;

  // Fall back to DB-stored keys
  try {
    const { rows } = await pool.query(
      "SELECT value FROM settings WHERE key = 'api_keys'"
    );
    if (rows.length > 0 && rows[0].value[provider]) {
      return rows[0].value[provider];
    }
  } catch {
    // DB not available
  }
  return undefined;
}

async function callAnthropic(model: string, maxTokens: number, prompt: string): Promise<string> {
  const apiKey = await getApiKey("anthropic");
  const client = new Anthropic(apiKey ? { apiKey } : undefined);
  const message = await client.messages.create({
    model,
    max_tokens: maxTokens,
    messages: [{ role: "user", content: prompt }],
  });
  const content = message.content[0];
  if (content.type !== "text") throw new Error("Unexpected response type");
  return content.text;
}

async function callOpenAI(model: string, maxTokens: number, prompt: string): Promise<string> {
  const apiKey = await getApiKey("openai");
  if (!apiKey) throw new Error("OpenAI API key not configured");
  const client = new OpenAI({ apiKey });
  const response = await client.chat.completions.create({
    model,
    max_tokens: maxTokens,
    messages: [{ role: "user", content: prompt }],
  });
  const text = response.choices[0]?.message?.content;
  if (!text) throw new Error("Empty response from OpenAI");
  return text;
}

async function callDeepSeek(model: string, maxTokens: number, prompt: string): Promise<string> {
  const apiKey = await getApiKey("deepseek");
  if (!apiKey) throw new Error("DeepSeek API key not configured");
  const client = new OpenAI({
    apiKey,
    baseURL: "https://api.deepseek.com",
  });
  const response = await client.chat.completions.create({
    model,
    max_tokens: maxTokens,
    messages: [{ role: "user", content: prompt }],
  });
  const text = response.choices[0]?.message?.content;
  if (!text) throw new Error("Empty response from DeepSeek");
  return text;
}

async function callGemini(model: string, maxTokens: number, prompt: string): Promise<string> {
  const apiKey = await getApiKey("gemini");
  if (!apiKey) throw new Error("Gemini API key not configured");
  const genAI = new GoogleGenerativeAI(apiKey);
  const genModel = genAI.getGenerativeModel({
    model,
    generationConfig: { maxOutputTokens: maxTokens },
  });
  const result = await genModel.generateContent(prompt);
  const text = result.response.text();
  if (!text) throw new Error("Empty response from Gemini");
  return text;
}

function extractJson<T>(text: string, validate: (obj: any) => boolean): T {
  let jsonStr = text.trim();
  const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim();
  }
  const parsed = JSON.parse(jsonStr) as T;
  if (!validate(parsed)) {
    throw new Error("Invalid response structure");
  }
  return parsed;
}

function isValidCards(obj: any): boolean {
  return Array.isArray(obj.chaosCards) && Array.isArray(obj.knowledgeCards);
}

function isValidDeck(obj: any): boolean {
  return typeof obj.name === "string" && typeof obj.description === "string" && isValidCards(obj);
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

  let responseText: string;

  switch (settings.provider) {
    case "openai":
      responseText = await callOpenAI(settings.model, settings.maxTokens, prompt);
      break;
    case "deepseek":
      responseText = await callDeepSeek(settings.model, settings.maxTokens, prompt);
      break;
    case "gemini":
      responseText = await callGemini(settings.model, settings.maxTokens, prompt);
      break;
    case "anthropic":
    default:
      responseText = await callAnthropic(settings.model, settings.maxTokens, prompt);
      break;
  }

  return extractJson<GeneratedCards>(responseText, isValidCards);
}

const DECK_PROMPT = `Create a complete "Cards Against Humanity" style card game deck based on this theme:

Theme: "{{theme}}"

Generate a creative deck name, a short description (1-2 sentences), exactly {{chaosCount}} "Chaos" cards (prompts/black cards) and {{knowledgeCount}} "Knowledge" cards (answer/white cards).

Rules:
- Chaos cards are fill-in-the-blank prompts. Use ___ for the blank.
- Most Chaos cards should have pick:1 (one blank). 2-3 can have pick:2 (two blanks).
- Knowledge cards are short, funny answers (2-10 words).
- Be clever, funny, and a bit edgy but not offensive.
- Cards should be specific to the theme, not generic.
- The deck name should be catchy and related to the theme.
- The description should explain what the deck is about in a fun way.

Respond ONLY with valid JSON in this exact format, no other text:
{
  "name": "Deck Name Here",
  "description": "A short, fun description of the deck.",
  "chaosCards": [{"text": "The ___ is broken again.", "pick": 1}],
  "knowledgeCards": [{"text": "A rogue spreadsheet"}]
}`;

export async function generateDeck(
  theme: string,
  chaosCount?: number,
  knowledgeCount?: number
): Promise<GeneratedDeck> {
  const settings = await getAiSettings();
  const cc = chaosCount || settings.defaultChaosCount;
  const kc = knowledgeCount || settings.defaultKnowledgeCount;

  const prompt = DECK_PROMPT
    .replace(/\{\{theme\}\}/g, theme)
    .replace(/\{\{chaosCount\}\}/g, String(cc))
    .replace(/\{\{knowledgeCount\}\}/g, String(kc));

  let responseText: string;

  switch (settings.provider) {
    case "openai":
      responseText = await callOpenAI(settings.model, settings.maxTokens, prompt);
      break;
    case "deepseek":
      responseText = await callDeepSeek(settings.model, settings.maxTokens, prompt);
      break;
    case "gemini":
      responseText = await callGemini(settings.model, settings.maxTokens, prompt);
      break;
    case "anthropic":
    default:
      responseText = await callAnthropic(settings.model, settings.maxTokens, prompt);
      break;
  }

  return extractJson<GeneratedDeck>(responseText, isValidDeck);
}
