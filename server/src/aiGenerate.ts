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
export type PackType = "base" | "expansion" | "themed";

export interface AiSettings {
  provider: AiProvider;
  model: string;
  maxTokens: number;
}

export interface GenerateContext {
  theme: string;
  gameType: string;
  packType: PackType;
  packName?: string;
  deckName?: string;
  deckDescription?: string;
  chaosCount?: number;
  knowledgeCount?: number;
}

const DEFAULTS: AiSettings = {
  provider: "anthropic",
  model: "claude-sonnet-4-20250514",
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

// ── Prompt builders ──

function buildCardRules(gameType: string): string {
  if (gameType === "cards-against-humanity") {
    return `Rules for this Cards Against Humanity style game:
- Chaos cards are fill-in-the-blank prompts. Use ___ for the blank.
- Most Chaos cards should have pick:1 (one blank). 2-3 can have pick:2 (two blanks).
- Knowledge cards are short, funny answers (2-10 words).
- Be clever, funny, and a bit edgy but not offensive.
- Cards should be specific to the theme, not generic.`;
  }
  // Future game types can be added here
  return "Generate prompt cards and answer cards appropriate for the game type.";
}

function buildCardsPrompt(ctx: GenerateContext, cc: number, kc: number): string {
  const rules = buildCardRules(ctx.gameType);

  const packDesc = ctx.packType === "expansion"
    ? `This is an EXPANSION BOX called "${ctx.packName || "Expansion"}" for an existing deck. It should add mid-sized variety — new prompts and answers that complement but don't repeat the base game.`
    : ctx.packType === "themed"
    ? `This is a small THEMED PACK called "${ctx.packName || "Themed Pack"}" for an existing deck. It should be tightly focused on a single sub-topic within the theme — a concentrated set of cards around one specific angle.`
    : `This is the BASE GAME — the core set of cards that defines the deck.`;

  const deckContext = ctx.deckName
    ? `\nExisting deck: "${ctx.deckName}"${ctx.deckDescription ? ` — ${ctx.deckDescription}` : ""}`
    : "";

  return `Generate cards for a "${ctx.gameType}" style party game.

Theme: "${ctx.theme}"
${deckContext}

${packDesc}

Generate exactly ${cc} "Chaos" cards (prompts) and ${kc} "Knowledge" cards (answers).

${rules}

Respond ONLY with valid JSON in this exact format, no other text:
{
  "chaosCards": [{"text": "The ___ is broken again.", "pick": 1}],
  "knowledgeCards": [{"text": "A rogue spreadsheet"}]
}`;
}

function buildDeckPrompt(ctx: GenerateContext, cc: number, kc: number): string {
  const rules = buildCardRules(ctx.gameType);

  return `Create a complete "${ctx.gameType}" style card game deck based on this theme:

Theme: "${ctx.theme}"

Generate a creative deck name, a short description (1-2 sentences), exactly ${cc} "Chaos" cards (prompts) and ${kc} "Knowledge" cards (answers).

${rules}
- The deck name should be catchy and related to the theme.
- The description should explain what the deck is about in a fun way.

Respond ONLY with valid JSON in this exact format, no other text:
{
  "name": "Deck Name Here",
  "description": "A short, fun description of the deck.",
  "chaosCards": [{"text": "The ___ is broken again.", "pick": 1}],
  "knowledgeCards": [{"text": "A rogue spreadsheet"}]
}`;
}

// ── Provider calls ──

async function callAnthropic(model: string, maxTokens: number, prompt: string): Promise<string> {
  const apiKey = getApiKey("anthropic");
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
  const apiKey = getApiKey("openai");
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
  const apiKey = getApiKey("deepseek");
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
  const apiKey = getApiKey("gemini");
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

// ── Shared helpers ──

async function callProvider(settings: AiSettings, prompt: string): Promise<string> {
  switch (settings.provider) {
    case "openai":
      return callOpenAI(settings.model, settings.maxTokens, prompt);
    case "deepseek":
      return callDeepSeek(settings.model, settings.maxTokens, prompt);
    case "gemini":
      return callGemini(settings.model, settings.maxTokens, prompt);
    case "anthropic":
    default:
      return callAnthropic(settings.model, settings.maxTokens, prompt);
  }
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

// ── Public API ──

export async function generateCards(ctx: GenerateContext): Promise<GeneratedCards> {
  const settings = await getAiSettings();
  const cc = ctx.chaosCount || 10;
  const kc = ctx.knowledgeCount || 25;
  const prompt = buildCardsPrompt(ctx, cc, kc);
  const responseText = await callProvider(settings, prompt);
  return extractJson<GeneratedCards>(responseText, isValidCards);
}

export async function generateDeck(ctx: GenerateContext): Promise<GeneratedDeck> {
  const settings = await getAiSettings();
  const cc = ctx.chaosCount || 10;
  const kc = ctx.knowledgeCount || 25;
  const prompt = buildDeckPrompt(ctx, cc, kc);
  const responseText = await callProvider(settings, prompt);
  return extractJson<GeneratedDeck>(responseText, isValidDeck);
}
