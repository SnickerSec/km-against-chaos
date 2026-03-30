import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import pool from "./db.js";

interface GeneratedCards {
  name?: string;
  description?: string;
  chaosCards: { text: string; pick: number; metaType?: string; metaEffect?: any }[];
  knowledgeCards: { text: string }[];
}

interface GeneratedDeck {
  name: string;
  description: string;
  chaosCards: { text: string; pick: number; metaType?: string; metaEffect?: any }[];
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
  // 4-Pillar fields
  maturity?: "kid-friendly" | "moderate" | "adult" | "raunchy";
  flavorThemes?: string[];
  chaosLevel?: number; // 0–100: percentage of chaos cards that are meta/rule-breaker cards
  wildcard?: string;
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

// ── Static prompt sections (ordered for prefix-cache efficiency) ──

function buildEngineRules(gameType: string): string {
  if (gameType === "cards-against-humanity") {
    return `=== GAME ENGINE RULES ===
This is a Cards Against Humanity-style party game called "KM Against Chaos".
- Chaos cards are fill-in-the-blank PROMPT cards. Use ___ for each blank.
- Most Chaos cards have pick:1 (one blank). 2–3 per set can have pick:2 (two blanks, e.g. "___ and ___ walk into ___").
- Knowledge cards are short, punchy ANSWER cards (2–10 words).
- Cards should be clever, funny, and specific to the theme — never generic filler.`;
  }
  if (gameType === "uno") {
    return `=== GAME ENGINE RULES ===
This is a Custom-Themed Uno card game. You are creating a THEME TEMPLATE, not individual cards.
The game uses standard Uno mechanics (108 cards: 4 colors, numbers 0-9, Skip, Reverse, Draw Two, Wild, Wild Draw Four).

Your job is to create a thematic skin:
- 4 custom color names (replacing Red, Blue, Green, Yellow) — must be thematic, evocative, and match the flavor/wildcard context
- Custom names for the 5 action cards (Skip, Reverse, Draw Two, Wild, Wild Draw Four) — these should be thematic and fun
- The color names and action names should feel cohesive with the deck's theme, content safety level, and any flavor themes or wildcard context provided
- If a chaos level > 0 is specified, also include "customActions" — an array of themed special action card names and short descriptions that replace some standard actions to mix up gameplay (e.g. "Swap Hands", "Draw Until Match", "Skip Everyone")

OUTPUT FORMAT (JSON only, no chaosCards/knowledgeCards):
{
  "name": "Deck Name",
  "description": "A fun deck description",
  "template": {
    "colorNames": { "red": "Fire", "blue": "Ice", "green": "Earth", "yellow": "Wind" },
    "actionNames": { "skip": "Freeze", "reverse": "Time Warp", "draw_two": "Double Strike", "wild": "Chaos", "wild_draw_four": "Annihilation" },
    "customActions": [{ "name": "Hand Swap", "description": "Swap your entire hand with another player" }]
  }
}`;
  }
  if (gameType === "apples-to-apples" || gameType === "apples_to_apples") {
    return `=== GAME ENGINE RULES ===
This is an Apples to Apples-style party game.
- Green cards are PROMPT cards with a single adjective or short description (NO blanks, NO fill-in-the-blank). Examples: "Scary", "Hilarious", "Unbelievable", "Heartwarming".
- All Green cards have pick:1. Never use ___ blanks.
- Red cards are short NOUN/THING answer cards (1–6 words). Examples: "My first paycheck", "Puppies", "A haunted house", "Grandma's cooking".
- Keep it family-friendly — clever and funny but no explicit or offensive content.
- Cards should be broadly appealing and work in many combinations.`;
  }
  if (gameType === "joking-hazard" || gameType === "joking_hazard") {
    return `=== GAME ENGINE RULES ===
This is a Joking Hazard-style 3-panel comic strip game (text-based, no images).
All cards are PANEL CARDS — the same card type with different border colors.

CARD TYPES BY BORDER COLOR:
1. Black-bordered panels (majority ~80-85%) — versatile, can be used as any panel.
   Regular round: drawn card = Panel 1, Judge plays Panel 2, players submit Panel 3.
2. Red-bordered panels (~15-20%) — strong punchlines that trigger Bonus Rounds.
   Bonus round: red card = Panel 3 (fixed), players submit 2 cards for Panels 1+2.
   Winner gets 2 points. Red cards should be dramatic, absurd, or shocking endings.

WORD COUNT — THIS IS CRITICAL:
- ~25-30% of cards should have NO text at all — just a visual action described in 0 words. Use stage directions in brackets like "[crying]", "[on fire]", "[pointing accusingly]", "[dead]".
- ~50-60% of cards should be 1-5 words. Short exclamations, single speech bubble lines: "OH GOD", "I'm a horse", "Wait!", "Not again", "This is fine".
- The remaining cards can be up to 10 words MAX. Never exceed 10 words on a single card.
- Think comic panel speech bubbles — one short sentence at most. Brevity is everything.

ALL CARDS:
- Complete sentences, short phrases, exclamations, or wordless actions (NOT fill-in-the-blank, no blanks).
- Describe actions, reactions, situations, consequences in as few words as possible.
- Should work in many combinations — avoid cards that only pair with one other.
- Humor: unexpected escalation, absurd consequences, deadpan observations.

OUTPUT FORMAT:
- chaosCards = red-bordered bonus cards: {"text": "...", "pick": 1, "bonus": true}
- knowledgeCards = black-bordered regular cards: {"text": "..."}`;
  }
  if (gameType === "codenames") {
    return `=== GAME ENGINE RULES ===
This is a Codenames-style word guessing game.
- You are generating a WORD POOL for a 5x5 grid game.
- Knowledge cards are single WORDS or short 2-word phrases (e.g., "Apple", "Night Sky", "Dragon").
- Words should be diverse, concrete nouns preferred, with some verbs and adjectives mixed in.
- All words should be related to the theme but distinct enough to create interesting clue connections.
- Generate at least 50 words for variety (the game picks 25 randomly each round).
- No chaos/prompt cards needed — only knowledge (word pool) cards.`;
  }
  return "Generate prompt cards and answer cards appropriate for the game type.";
}

function buildMaturityRules(maturity: string): string {
  switch (maturity) {
    case "kid-friendly":
      return `=== CONTENT SAFETY: KID-FRIENDLY (G-RATED) ===
- Absolutely no profanity, innuendo, violence, drugs, or dark themes.
- Humor must be wholesome, punny, and safe for ages 8+.
- Think Nickelodeon, not Adult Swim.`;
    case "moderate":
      return `=== CONTENT SAFETY: MODERATE (PG-13) ===
- Mild sarcasm and light innuendo are fine. No explicit content.
- Dark humor is okay if it stays tasteful (think The Office, not South Park).
- Avoid slurs, graphic violence, or explicit sexual content.`;
    case "raunchy":
      return `=== CONTENT SAFETY: RAUNCHY (EXPLICIT — R-RATED / NC-17) ===
- This deck is EXPLICITLY meant to be filthy, vulgar, and sexually charged. The user chose "Raunchy" mode because they WANT Cards Against Humanity-level shock humor.
- USE profanity freely: shit, fuck, ass, damn, hell, etc. Cards that are too clean FAIL the brief.
- Include cards about: sex, bodily functions, drugs, drinking, embarrassing situations, crude anatomy humor, awkward hookups, and wildly inappropriate workplace/family scenarios.
- Dark humor and morbid jokes are expected. Think South Park, Always Sunny, or the worst Cards Against Humanity cards.
- Tone: genuinely shocking, laugh-out-loud gross, the kind of cards that make people cover their mouth. If a card could be in a PG-13 movie, it's too tame.
- Do NOT self-censor, hedge, or water down. Every card should make someone uncomfortable while laughing.
- The only hard rule: no hate speech targeting real protected groups.`;
    default: // "adult"
      return `=== CONTENT SAFETY: ADULT (STANDARD CAH) ===
- Standard Cards Against Humanity tone: edgy, dark, politically incorrect, and profane.
- Casual profanity is fine and expected (shit, damn, ass, hell). Don't shy away from it.
- Humor should punch at institutions, absurdity, and human behavior — not at individuals.
- Think "uncomfortable but funny" — the kind of thing that makes people say "oh no" then laugh.
- Cards that could appear in a PG movie are too safe. Aim for a hard R.`;
  }
}

function buildFlavorRules(flavorThemes: string[]): string {
  if (!flavorThemes || flavorThemes.length === 0) return "";
  return `=== THEMATIC FLAVOR OVERLAYS ===
Apply these flavor lenses to the vocabulary, references, and vibe of ALL cards:
${flavorThemes.map((t) => `- ${t}`).join("\n")}
Every card should feel like it could only exist in a deck with these themes.
Use slang, references, aesthetics, and in-jokes specific to these flavor themes.`;
}

function buildMetaCardRules(metaCount: number): string {
  if (metaCount <= 0) return "";
  return `=== META / RULE-BREAKER CARDS ===
Exactly ${metaCount} of the Chaos cards must be "Meta Cards" that manipulate the digital game state.
Meta cards use a special JSON format with metaType and metaEffect fields. Types:

1. score_manipulation — Awards or deducts points:
   {"metaType":"score_manipulation","metaEffect":{"type":"score_add","value":2,"target":"winner"}}
   {"metaType":"score_manipulation","metaEffect":{"type":"score_subtract","value":1,"target":"loser"}}
   {"metaType":"score_manipulation","metaEffect":{"type":"score_add","value":1,"target":"czar"}}
   Valid targets: "winner", "loser", "czar", "all"

2. ui_interference — Messes with other players' screens:
   {"metaType":"ui_interference","metaEffect":{"type":"hide_cards","target":"all_others","durationMs":20000}}
   {"metaType":"ui_interference","metaEffect":{"type":"randomize_icons","target":"all","durationMs":15000}}
   Valid targets: "all_others", "all", "winner", "loser"

3. hand_reset — Forces a hand redraw:
   {"metaType":"hand_reset","metaEffect":{"type":"hand_reset","target":"loser"}}
   {"metaType":"hand_reset","metaEffect":{"type":"hand_reset","target":"all"}}
   Valid targets: "winner", "loser", "all", "all_others"

Meta card text should describe the effect humorously, matching the deck theme.
Example: "CHAOS RULE: The winner of this round steals ___ extra points from last place."
The pick field still applies for meta cards (1 or 2 blanks).`;
}

function buildDynamicSection(ctx: GenerateContext, cc: number, kc: number, metaCount: number): string {
  const packDesc = ctx.packType === "expansion"
    ? `This is an EXPANSION BOX called "${ctx.packName || "Expansion"}" — add mid-sized variety that complements but doesn't repeat the base game.`
    : ctx.packType === "themed"
    ? `This is a small THEMED PACK called "${ctx.packName || "Themed Pack"}" — tightly focused on one specific angle within the theme.`
    : `This is the BASE GAME — the core set that defines the deck.`;

  const deckContext = ctx.deckName
    ? `\nExisting deck: "${ctx.deckName}"${ctx.deckDescription ? ` — ${ctx.deckDescription}` : ""}`
    : "";

  const wildcardSection = ctx.wildcard?.trim()
    ? `\nWILDCARD CONTEXT (hyper-niche — weave this into cards where it fits): "${ctx.wildcard.trim()}"`
    : "";

  const isJH = ctx.gameType === "joking-hazard" || ctx.gameType === "joking_hazard";
  const isA2A = ctx.gameType === "apples-to-apples" || ctx.gameType === "apples_to_apples";
  const standardCount = cc - metaCount;
  const cardBreakdown = isJH
    ? `Generate exactly ${cc} red-bordered bonus panel cards (chaosCards with bonus:true) and ${kc} black-bordered regular panel cards (knowledgeCards).`
    : isA2A
    ? (metaCount > 0
      ? `Generate exactly ${standardCount} standard Green cards (single adjective/description, pick:1, NO blanks) AND ${metaCount} Meta/Rule-Breaker Green cards (${cc} total), plus ${kc} Red cards (nouns/things, 1-6 words).`
      : `Generate exactly ${cc} Green cards (adjectives/descriptions, pick:1, NO blanks) and ${kc} Red cards (nouns/things).`)
    : (metaCount > 0
      ? `Generate exactly ${standardCount} standard fill-in-the-blank Chaos cards AND ${metaCount} Meta/Rule-Breaker Chaos cards (${cc} total), plus ${kc} Knowledge cards.`
      : `Generate exactly ${cc} Chaos cards (prompts) and ${kc} Knowledge cards (answers).`);

  return `=== GENERATION REQUEST ===
Theme: "${ctx.theme}"${deckContext}
${packDesc}${wildcardSection}

${cardBreakdown}
${ctx.packType !== "base" ? `Also generate a short, catchy pack name and a 1-2 sentence description.` : ""}`;
}

function buildCardsPrompt(ctx: GenerateContext, cc: number, kc: number): string {
  const metaCount = Math.round(cc * ((ctx.chaosLevel ?? 0) / 100));
  const maturity = ctx.maturity || "adult";
  const flavorThemes = ctx.flavorThemes || [];

  const sections = [
    buildEngineRules(ctx.gameType),
    buildMaturityRules(maturity),
    flavorThemes.length > 0 ? buildFlavorRules(flavorThemes) : "",
    metaCount > 0 ? buildMetaCardRules(metaCount) : "",
    buildDynamicSection(ctx, cc, kc, metaCount),
  ].filter(Boolean).join("\n\n");

  const metaSchema = metaCount > 0
    ? `{"text": "CHAOS RULE: The winner steals ___ point(s) from last place.", "pick": 1, "metaType": "score_manipulation", "metaEffect": {"type": "score_add", "value": 1, "target": "winner"}}`
    : "";

  const exampleChaos = metaCount > 0
    ? `[{"text": "The ___ is broken again.", "pick": 1}, ${metaSchema}]`
    : `[{"text": "The ___ is broken again.", "pick": 1}]`;

  return `${sections}

Respond ONLY with valid JSON, no other text:
${ctx.packType !== "base" ? `{
  "name": "Pack Name Here",
  "description": "A short description.",
  "chaosCards": ${exampleChaos},
  "knowledgeCards": [{"text": "A rogue spreadsheet"}]
}` : `{
  "chaosCards": ${exampleChaos},
  "knowledgeCards": [{"text": "A rogue spreadsheet"}]
}`}`;
}

function buildDeckPrompt(ctx: GenerateContext, cc: number, kc: number): string {
  const maturity = ctx.maturity || "adult";
  const flavorThemes = ctx.flavorThemes || [];
  const isUno = ctx.gameType === "uno";

  // Uno gets a special prompt — no card counts, just template generation
  if (isUno) {
    const wildcardSection = ctx.wildcard?.trim()
      ? `\nWILDCARD CONTEXT (weave this into the theme names): "${ctx.wildcard.trim()}"`
      : "";
    const chaosSection = (ctx.chaosLevel ?? 0) > 0
      ? `\nChaos Level: ${ctx.chaosLevel}% — include ${Math.max(1, Math.round((ctx.chaosLevel ?? 0) / 10))} custom action cards in the "customActions" array.`
      : "";

    return [
      buildEngineRules(ctx.gameType),
      buildMaturityRules(maturity),
      flavorThemes.length > 0 ? buildFlavorRules(flavorThemes) : "",
    ].filter(Boolean).join("\n\n") + `

=== GENERATION REQUEST ===
Theme: "${ctx.theme}"${wildcardSection}${chaosSection}

The color names and action card names MUST reflect the theme, content safety, and any wildcard context above.
Respond ONLY with valid JSON, no other text.`;
  }

  const metaCount = Math.round(cc * ((ctx.chaosLevel ?? 0) / 100));

  const sections = [
    buildEngineRules(ctx.gameType),
    buildMaturityRules(maturity),
    flavorThemes.length > 0 ? buildFlavorRules(flavorThemes) : "",
    metaCount > 0 ? buildMetaCardRules(metaCount) : "",
    buildDynamicSection(ctx, cc, kc, metaCount),
  ].filter(Boolean).join("\n\n");

  const metaSchema = metaCount > 0
    ? `, {"text": "CHAOS RULE: Last place must ___.", "pick": 1, "metaType": "hand_reset", "metaEffect": {"type": "hand_reset", "target": "loser"}}`
    : "";

  return `${sections}
Also generate a creative deck name and a short (1-2 sentence) description.

Respond ONLY with valid JSON, no other text:
{
  "name": "Deck Name Here",
  "description": "A short, fun description.",
  "chaosCards": [{"text": "The ___ is broken again.", "pick": 1}${metaSchema}],
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
  // Split prompt into static system content (cacheable) and dynamic user content
  // DeepSeek auto-caches the first N tokens of repeated system prompts
  const splitIdx = prompt.indexOf("=== GENERATION REQUEST ===");
  const systemContent = splitIdx > 0 ? prompt.slice(0, splitIdx).trim() : "";
  const userContent = splitIdx > 0 ? prompt.slice(splitIdx).trim() : prompt;

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = systemContent
    ? [
        { role: "system", content: systemContent },
        { role: "user", content: userContent },
      ]
    : [{ role: "user", content: prompt }];

  const response = await client.chat.completions.create({
    model,
    max_tokens: maxTokens,
    messages,
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

  // Strip markdown code fences
  const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim();
  }

  // Strip leading/trailing non-JSON text (find first { and last })
  const firstBrace = jsonStr.indexOf("{");
  const lastBrace = jsonStr.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    jsonStr = jsonStr.slice(firstBrace, lastBrace + 1);
  }

  const parsed = JSON.parse(jsonStr) as T;
  if (!validate(parsed)) {
    console.error("AI response failed validation:", JSON.stringify(parsed).slice(0, 500));
    throw new Error("Invalid response structure");
  }
  return parsed;
}

function isValidCards(obj: any): boolean {
  return Array.isArray(obj.chaosCards) && Array.isArray(obj.knowledgeCards);
}

function isValidUnoDeck(obj: any): boolean {
  return typeof obj.name === "string" && typeof obj.description === "string" && obj.template && typeof obj.template.colorNames === "object";
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
  const validator = ctx.gameType === "uno" ? isValidUnoDeck : isValidDeck;
  return extractJson<GeneratedDeck>(responseText, validator);
}
