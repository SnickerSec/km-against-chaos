"use client";

import { useState, useRef } from "react";
import { Icon } from "@iconify/react";
import { generateCardsAI, generateDeckAI, type GenerateContext } from "@/lib/api";

// ── 4-Pillar constants ──

const MATURITY_LEVELS = [
  { id: "kid-friendly", label: "Kid-Friendly", icon: "mdi:emoticon-happy", desc: "G-rated, wholesome fun" },
  { id: "moderate",     label: "Moderate",     icon: "mdi:emoticon-cool", desc: "PG-13, mild innuendo" },
  { id: "adult",        label: "Adult",        icon: "mdi:emoticon-devil", desc: "Standard CAH edge" },
  { id: "raunchy",      label: "Raunchy",      icon: "mdi:fire",          desc: "Explicit, no limits" },
] as const;

const FLAVOR_THEMES = [
  { id: "90s-nostalgia",    label: "90s Nostalgia",      icon: "mdi:cassette" },
  { id: "cyber-dystopia",   label: "Cyber-Dystopia",     icon: "mdi:robot-angry" },
  { id: "medieval-fantasy", label: "Medieval Fantasy",   icon: "mdi:sword" },
  { id: "space-opera",      label: "Space Opera",        icon: "mdi:rocket" },
  { id: "corporate-hell",   label: "Corporate Hell",     icon: "mdi:briefcase" },
  { id: "beach-vacation",   label: "Beach Vacation",     icon: "mdi:umbrella-beach" },
  { id: "zombie-apocalypse","label": "Zombie Apocalypse","icon": "mdi:skull" },
  { id: "anime-fever",      label: "Anime Fever",        icon: "mdi:star-four-points" },
  { id: "cooking-show",     label: "Cooking Show",       icon: "mdi:chef-hat" },
  { id: "true-crime",       label: "True Crime",         icon: "mdi:magnify" },
  { id: "reality-tv",       label: "Reality TV",         icon: "mdi:television-play" },
  { id: "political-chaos",  label: "Political Chaos",    icon: "mdi:gavel" },
  { id: "gaming-culture",   label: "Gaming Culture",     icon: "mdi:controller-classic" },
  { id: "gen-z-speak",      label: "Gen Z Speak",        icon: "mdi:lightning-bolt" },
  { id: "boomer-classics",  label: "Boomer Classics",    icon: "mdi:newspaper" },
  { id: "conspiracy",       label: "Conspiracy Theories","icon": "mdi:alien" },
  { id: "crypto-bro",       label: "Crypto / NFT",       icon: "mdi:bitcoin" },
  { id: "horror-movie",     label: "Horror Movie",       icon: "mdi:ghost" },
  { id: "wild-west",        label: "Wild West",          icon: "mdi:pistol" },
  { id: "academia",         label: "Academia / PhD Life","icon": "mdi:school" },
  { id: "superheroes",       label: "Superheroes",        icon: "mdi:shield-star" },
  { id: "fairy-tales",       label: "Fairy Tales",        icon: "mdi:castle" },
  { id: "pets-animals",      label: "Pets & Animals",     icon: "mdi:paw" },
  { id: "sports",            label: "Sports",             icon: "mdi:trophy" },
  { id: "road-trip",         label: "Road Trip",          icon: "mdi:car-convertible" },
  { id: "holidays",          label: "Holidays",           icon: "mdi:party-popper" },
  { id: "music-genres",      label: "Music Genres",       icon: "mdi:music-note" },
  { id: "mythical-creatures",label: "Mythical Creatures",  icon: "mdi:unicorn" },
  { id: "theme-park",        label: "Theme Park",         icon: "mdi:ferris-wheel" },
  { id: "survival-island",   label: "Survival Island",    icon: "mdi:island" },
  { id: "time-travel",       label: "Time Travel",        icon: "mdi:clock-fast" },
  { id: "detective-noir",    label: "Detective Noir",     icon: "mdi:detective" },
  { id: "pirate-adventure",  label: "Pirate Adventure",   icon: "mdi:pirate" },
  { id: "breakfast-club",    label: "Breakfast Club",     icon: "mdi:food-croissant" },
  { id: "sitcom-vibes",      label: "Sitcom Vibes",       icon: "mdi:sofa" },
  { id: "high-school",       label: "High School",        icon: "mdi:bus-school" },
  { id: "dating-disasters",  label: "Dating Disasters",   icon: "mdi:heart-broken" },
  { id: "florida-man",       label: "Florida Man",        icon: "mdi:weather-sunny-alert" },
  { id: "diy-fails",         label: "DIY Fails",          icon: "mdi:hammer-wrench" },
  { id: "social-media",      label: "Social Media",       icon: "mdi:cellphone" },
  { id: "mythology",         label: "World Mythology",    icon: "mdi:lightning-bolt-circle" },
  { id: "heist-movie",       label: "Heist Movie",        icon: "mdi:safe" },
  { id: "dad-jokes",         label: "Dad Jokes",          icon: "mdi:emoticon-wink" },
  { id: "fast-food",         label: "Fast Food",          icon: "mdi:hamburger" },
  { id: "camping",           label: "Camping",            icon: "mdi:campfire" },
];

interface CardInput {
  text: string;
  pick?: number;
  bonus?: boolean;
}

interface WinCondition {
  mode: "rounds" | "points" | "single_round" | "lowest_score";
  value: number;
}

interface DeckFormData {
  name: string;
  description: string;
  chaosCards: CardInput[];
  knowledgeCards: CardInput[];
  winCondition: WinCondition;
  packs?: { type: string; name: string; description: string; chaosCards: CardInput[]; knowledgeCards: CardInput[] }[];
  // 4-Pillar recipe fields
  maturity?: string;
  flavorThemes?: string[];
  chaosLevel?: number;
  wildcard?: string;
  gameType?: string;
}

type PackType = "base" | "expansion" | "themed";

interface CardPack {
  id: string;
  type: PackType;
  name: string;
  description: string;
  chaosCards: CardInput[];
  knowledgeCards: CardInput[];
  open: boolean;
}

interface Props {
  initial?: DeckFormData & { maturity?: string; flavorThemes?: string[]; chaosLevel?: number; wildcard?: string };
  onSubmit: (data: DeckFormData) => Promise<void>;
  submitLabel: string;
}

const PACK_LABELS: Record<PackType, { label: string; color: string; border: string }> = {
  base: { label: "Base Game", color: "text-white", border: "border-gray-600" },
  expansion: { label: "Expansion Box", color: "text-yellow-400", border: "border-yellow-600/50" },
  themed: { label: "Themed Pack", color: "text-cyan-400", border: "border-cyan-600/50" },
};

function makeId() {
  return Math.random().toString(36).slice(2, 8);
}

export default function DeckForm({ initial, onSubmit, submitLabel }: Props) {
  const [name, setName] = useState(initial?.name || "");
  const [description, setDescription] = useState(initial?.description || "");
  const [winMode, setWinMode] = useState<WinCondition["mode"]>(initial?.winCondition?.mode || "rounds");
  const [winValue, setWinValue] = useState(initial?.winCondition?.value || 10);
  const [gameType, setGameType] = useState(
    initial?.gameType === "joking_hazard" ? "joking-hazard"
    : initial?.gameType === "apples_to_apples" ? "apples-to-apples"
    : initial?.gameType === "uno" ? "uno"
    : initial?.gameType === "codenames" ? "codenames"
    : "cards-against-humanity"
  );

  // Uno template state
  const [unoColorNames, setUnoColorNames] = useState<Record<string, string>>(
    initial?.gameType === "uno" && initial?.chaosCards?.[0]
      ? ((initial.chaosCards[0] as any).colorNames || { red: "Red", blue: "Blue", green: "Green", yellow: "Yellow" })
      : { red: "Red", blue: "Blue", green: "Green", yellow: "Yellow" }
  );
  const [unoActionNames, setUnoActionNames] = useState<Record<string, string>>(
    initial?.gameType === "uno" && initial?.chaosCards?.[0]
      ? ((initial.chaosCards[0] as any).actionNames || {})
      : {}
  );
  const [chaosCount, setChaosCount] = useState(10);
  const [knowledgeCount, setKnowledgeCount] = useState(25);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // 4-Pillar recipe state
  const [maturity, setMaturity] = useState(initial?.maturity || "adult");
  const [flavorThemes, setFlavorThemes] = useState<string[]>(initial?.flavorThemes || []);
  const [chaosLevel, setChaosLevel] = useState(initial?.chaosLevel ?? 0);
  const [wildcard, setWildcard] = useState(initial?.wildcard || "");

  const [packs, setPacks] = useState<CardPack[]>(() => {
    if (initial?.packs && initial.packs.length > 0) {
      return initial.packs.map((p, i) => ({
        id: i === 0 && p.type === "base" ? "base" : makeId(),
        type: p.type as PackType,
        name: p.name,
        description: p.description || "",
        chaosCards: p.chaosCards.length > 0 ? p.chaosCards : [{ text: "", pick: 1 }],
        knowledgeCards: p.knowledgeCards.length > 0 ? p.knowledgeCards : [{ text: "" }],
        open: false,
      }));
    }
    return [{
      id: "base",
      type: "base",
      name: "Base Game",
      description: "",
      chaosCards: initial?.chaosCards || [{ text: "", pick: 1 }],
      knowledgeCards: initial?.knowledgeCards || [{ text: "" }],
      open: !initial,
    }];
  });

  // Check if base game has enough cards to unlock expansions/packs
  const basePack = packs.find((p) => p.type === "base")!;
  const baseHasCards =
    basePack.chaosCards.filter((c) => c.text.trim()).length >= 5 &&
    basePack.knowledgeCards.filter((c) => c.text.trim()).length >= 15;

  const totalChaos = packs.flatMap((p) => p.chaosCards).filter((c) => c.text.trim()).length;
  const totalKnowledge = packs.flatMap((p) => p.knowledgeCards).filter((c) => c.text.trim()).length;

  const updatePack = (packId: string, updater: (pack: CardPack) => CardPack) => {
    setPacks(packs.map((p) => (p.id === packId ? updater(p) : p)));
  };

  const removePack = (packId: string) => {
    setPacks(packs.filter((p) => p.id !== packId));
  };

  const newPackRef = useRef<string | null>(null);

  const addPack = (type: PackType) => {
    const defaultName = type === "expansion" ? "Expansion Box" : "Themed Pack";
    const id = makeId();
    newPackRef.current = id;
    setPacks([
      ...packs,
      {
        id,
        type,
        name: defaultName,
        description: "",
        chaosCards: [{ text: "", pick: 1 }],
        knowledgeCards: [{ text: "" }],
        open: true,
      },
    ]);
  };

  const handleSubmit = async () => {
    setError(null);
    if (!name.trim()) { setError("Deck name is required"); return; }

    const isJH = gameType === "joking-hazard";
    const isUno = gameType === "uno";
    const isCodenames = gameType === "codenames";

    let allChaos: CardInput[];
    let allKnowledge: CardInput[];

    if (isCodenames) {
      allChaos = [];
      allKnowledge = packs.flatMap((p) => p.knowledgeCards).filter((c) => c.text.trim());
      if (allKnowledge.length < 25) { setError("Need at least 25 words for the word pool"); return; }
    } else if (isUno) {
      // Uno: store template as a single chaos card
      const template = {
        colorNames: unoColorNames,
        actionNames: Object.keys(unoActionNames).length > 0 ? unoActionNames : undefined,
        themeDescription: description.trim(),
      };
      allChaos = [{ text: JSON.stringify(template), pick: 1 } as any];
      allKnowledge = [];
    } else if (isJH) {
      // JH: all cards are in knowledgeCards. Auto-split:
      // - Red (bonus) cards → chaosCards (drawn from deck, trigger bonus rounds)
      // - ~30% of black cards → chaosCards (drawn as regular Panel 1 starters)
      // - Remaining black cards → knowledgeCards (dealt to hands)
      const allPanels = packs.flatMap((p) => p.knowledgeCards).filter((c) => c.text.trim());
      const redCards = allPanels.filter((c) => c.bonus);
      const blackCards = allPanels.filter((c) => !c.bonus);

      if (allPanels.length < 20) { setError("Need at least 20 panel cards for a Joking Hazard deck"); return; }

      // Shuffle black cards and split ~30% to draw pile, rest to hands
      const shuffledBlack = [...blackCards].sort(() => Math.random() - 0.5);
      const drawCount = Math.max(5, Math.round(blackCards.length * 0.3));
      const blackForDeck = shuffledBlack.slice(0, drawCount).map((c) => ({ ...c, pick: 1 }));
      const blackForHands = shuffledBlack.slice(drawCount);

      allChaos = [...redCards.map((c) => ({ ...c, pick: 1, bonus: true })), ...blackForDeck];
      allKnowledge = blackForHands;
    } else {
      allChaos = packs.flatMap((p) => p.chaosCards).filter((c) => c.text.trim());
      allKnowledge = packs.flatMap((p) => p.knowledgeCards).filter((c) => c.text.trim());

      if (!isUno && allChaos.length < 5) { setError("Need at least 5 prompt cards with text across all packs"); return; }
      if (!isUno && allKnowledge.length < 15) { setError("Need at least 15 answer cards with text across all packs"); return; }
    }

    const packData = packs.map((p) => ({
      type: p.type,
      name: p.name,
      description: p.description,
      chaosCards: isJH ? [] : p.chaosCards.filter((c) => c.text.trim()),
      knowledgeCards: p.knowledgeCards.filter((c) => c.text.trim()),
    })).filter((p) => p.chaosCards.length > 0 || p.knowledgeCards.length > 0);

    setSaving(true);
    try {
      await onSubmit({
        name: name.trim(),
        description: description.trim(),
        chaosCards: allChaos,
        knowledgeCards: allKnowledge,
        winCondition: { mode: winMode, value: winValue },
        packs: packData,
        maturity,
        flavorThemes,
        chaosLevel,
        wildcard: wildcard.trim(),
        gameType: isCodenames ? "codenames" : isUno ? "uno" : isJH ? "joking_hazard" : gameType === "apples-to-apples" ? "apples_to_apples" : "cah",
      });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleChaosCount = (val: number) => {
    const clamped = Math.max(5, Math.min(30, val));
    setChaosCount(clamped);
    if (knowledgeCount <= clamped) {
      setKnowledgeCount(clamped + 5);
    }
  };

  const handleKnowledgeCount = (val: number) => {
    const clamped = Math.max(chaosCount + 1, Math.min(50, val));
    setKnowledgeCount(clamped);
  };

  const handleGenerateDeck = async (theme: string) => {
    const isJH = gameType === "joking-hazard";
    const isUno = gameType === "uno";
    const isCodenames = gameType === "codenames";
    const deck = await generateDeckAI({
      theme, gameType,
      chaosCount: isJH ? Math.round(knowledgeCount * 0.18) : (isUno || isCodenames) ? 0 : chaosCount,
      knowledgeCount: isJH ? knowledgeCount : isUno ? 0 : isCodenames ? 50 : knowledgeCount,
      maturity, flavorThemes, chaosLevel,
      wildcard: wildcard.trim() || undefined,
    });
    setName(deck.name);
    setDescription(deck.description);

    // For Uno, try to parse template from the response
    if (isUno) {
      try {
        // AI might return template data in various formats
        const templateData = (deck as any).template || (deck as any).unoTemplate;
        if (templateData?.colorNames) {
          setUnoColorNames(templateData.colorNames);
          if (templateData.actionNames) setUnoActionNames(templateData.actionNames);
        }
      } catch {}
      return;
    }
    setPacks((prev) => {
      const basePack = prev.find((p) => p.type === "base");
      const rest = prev.filter((p) => p.type !== "base");

      if (isJH) {
        // Merge all generated cards into one panel pool
        const bonusPanels = deck.chaosCards.map((c) => ({ text: c.text, bonus: true }));
        const regularPanels = deck.knowledgeCards.map((c) => ({ text: c.text }));
        return [
          {
            ...(basePack || { id: "base", type: "base" as const, name: "Base Game", description: "", open: true }),
            chaosCards: [],
            knowledgeCards: [...bonusPanels, ...regularPanels],
          },
          ...rest,
        ];
      }

      return [
        {
          ...(basePack || { id: "base", type: "base" as const, name: "Base Game", description: "", open: true }),
          chaosCards: deck.chaosCards.map((c) => ({ text: c.text, pick: c.pick || 1 })),
          knowledgeCards: deck.knowledgeCards.map((c) => ({ text: c.text })),
        },
        ...rest,
      ];
    });
  };

  return (
    <div className="space-y-8">
      {/* Game Type */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1">Game Type</label>
        <select
          className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-purple-500"
          value={gameType}
          onChange={(e) => {
            const gt = e.target.value;
            setGameType(gt);
            if ((gt === "apples-to-apples" || gt === "uno" || gt === "codenames") && (maturity === "adult" || maturity === "raunchy")) {
              setMaturity("kid-friendly");
            }
            if (gt === "uno") {
              setWinMode("single_round");
              setWinValue(500);
            } else if (gt === "codenames") {
              setWinMode("single_round");
              setWinValue(1);
            } else if (gameType === "uno" || gameType === "codenames") {
              setWinMode("rounds");
              setWinValue(10);
            }
          }}
        >
          <option value="cards-against-humanity">Cards Against Humanity</option>
          <option value="joking-hazard">Joking Hazard (Comic Strip)</option>
          <option value="apples-to-apples">Apples to Apples</option>
          <option value="uno">Uno (Custom Theme)</option>
          <option value="codenames">Codenames (Word Grid)</option>
        </select>
        <p className="text-gray-500 text-xs mt-1">
          {gameType === "joking-hazard"
            ? "3-panel comic strip game — the Judge plays Panel 2, others compete for the funniest Panel 3"
            : gameType === "apples-to-apples"
            ? "Family-friendly party game — a Judge plays a Green card, players submit Red cards to match"
            : gameType === "uno"
            ? "Turn-based card matching game — custom-themed colors and action cards with standard Uno rules"
            : gameType === "codenames"
            ? "Team word-guessing game — Spymasters give clues to help their team find words on a 5x5 grid"
            : "Fill-in-the-blank party game — a Czar reads a prompt, players submit answers"}
        </p>

        {/* Card counts — only on create */}
        {!initial && gameType !== "uno" && gameType !== "codenames" && (
          gameType === "joking-hazard" ? (
            <div className="mt-3">
              <label className="block text-xs text-gray-400 mb-1">Panel cards to generate</label>
              <input
                type="number"
                value={knowledgeCount}
                onChange={(e) => setKnowledgeCount(Math.max(20, Math.min(80, parseInt(e.target.value) || 40)))}
                min={20}
                max={80}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-purple-500"
              />
              <p className="text-gray-600 text-xs mt-1">
                AI will generate ~15-20% as red (bonus) cards. Min 20, max 80.
              </p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 mt-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Prompt cards to generate</label>
                  <input
                    type="number"
                    value={chaosCount}
                    onChange={(e) => handleChaosCount(parseInt(e.target.value) || 10)}
                    min={5}
                    max={30}
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-purple-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Answer cards to generate</label>
                  <input
                    type="number"
                    value={knowledgeCount}
                    onChange={(e) => handleKnowledgeCount(parseInt(e.target.value) || 25)}
                    min={chaosCount + 1}
                    max={50}
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-purple-500"
                  />
                </div>
              </div>
              <p className="text-gray-600 text-xs mt-1">
                Answer cards must outnumber prompt cards. Max 30 prompts, 50 answers.
              </p>
            </>
          )
        )}
      </div>

      {/* AI Generation — settings + generate button merged */}
      <AIGenerationPanel
        gameType={gameType}
        isCreate={!initial}
        maturity={maturity}
        setMaturity={setMaturity}
        flavorThemes={flavorThemes}
        setFlavorThemes={setFlavorThemes}
        chaosLevel={chaosLevel}
        setChaosLevel={setChaosLevel}
        wildcard={wildcard}
        setWildcard={setWildcard}
        onGenerate={handleGenerateDeck}
      />

      {/* Add packs (edit mode only) */}
      {initial && (
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => addPack("expansion")}
            className="flex-1 py-3 bg-yellow-600/10 hover:bg-yellow-600/20 border border-yellow-600/40 rounded-xl text-yellow-400 font-semibold text-sm transition-colors"
          >
            + Add Expansion Box
          </button>
          <button
            type="button"
            onClick={() => addPack("themed")}
            className="flex-1 py-3 bg-cyan-600/10 hover:bg-cyan-600/20 border border-cyan-600/40 rounded-xl text-cyan-400 font-semibold text-sm transition-colors"
          >
            + Add Themed Pack
          </button>
        </div>
      )}

      {/* Deck info */}
      <div className="space-y-3">
        <input
          type="text"
          placeholder="Deck Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-purple-500 text-lg"
        />
        <input
          type="text"
          placeholder="Description (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-purple-500 text-sm"
        />

        {/* Uno Theme — color names & action names under deck info */}
        {gameType === "uno" && (
          <div className="bg-gray-900 rounded-xl p-4 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-gray-400 mb-2 uppercase tracking-wide">Color Names</label>
              <div className="grid grid-cols-2 gap-2">
                {(["red", "blue", "green", "yellow"] as const).map((color) => {
                  const bgMap = { red: "border-red-600", blue: "border-blue-600", green: "border-green-600", yellow: "border-yellow-500" };
                  return (
                    <div key={color} className="flex items-center gap-2">
                      <div className={`w-4 h-4 rounded-full border-2 ${bgMap[color]}`} style={{ backgroundColor: color === "yellow" ? "#eab308" : color }} />
                      <input
                        type="text"
                        value={unoColorNames[color] || ""}
                        onChange={(e) => setUnoColorNames({ ...unoColorNames, [color]: e.target.value })}
                        placeholder={color.charAt(0).toUpperCase() + color.slice(1)}
                        className="flex-1 px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-purple-500"
                      />
                    </div>
                  );
                })}
              </div>
              <p className="text-gray-600 text-xs mt-1">Name the 4 colors for your theme (e.g. Fire, Ice, Earth, Wind) — auto-filled by AI generation</p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-400 mb-2 uppercase tracking-wide">Action Card Names (optional)</label>
              <div className="grid grid-cols-2 gap-2">
                {(["skip", "reverse", "draw_two", "wild", "wild_draw_four"] as const).map((action) => {
                  const defaults: Record<string, string> = { skip: "Skip", reverse: "Reverse", draw_two: "Draw Two", wild: "Wild", wild_draw_four: "Wild Draw Four" };
                  return (
                    <input
                      key={action}
                      type="text"
                      value={unoActionNames[action] || ""}
                      onChange={(e) => setUnoActionNames({ ...unoActionNames, [action]: e.target.value })}
                      placeholder={defaults[action]}
                      className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-purple-500"
                    />
                  );
                })}
              </div>
              <p className="text-gray-600 text-xs mt-1">Rename action cards to match your theme — auto-filled by AI generation</p>
            </div>
          </div>
        )}
      </div>

      {/* Win Condition */}
      <div className="bg-gray-900 rounded-xl p-4">
        <h2 className="text-sm font-semibold text-gray-300 mb-3">Win Condition</h2>
        {gameType === "codenames" ? (
          <p className="text-gray-400 text-sm">First team to find all their words wins. Single round game.</p>
        ) : gameType === "uno" ? (
          <>
            <div className="flex gap-2 mb-3 flex-wrap">
              <button
                type="button"
                onClick={() => { setWinMode("single_round"); setWinValue(500); }}
                className={`flex-1 py-2 px-3 rounded-lg text-sm font-semibold transition-colors ${
                  winMode === "single_round"
                    ? "bg-purple-600 text-white"
                    : "bg-gray-800 text-gray-400 hover:text-white"
                }`}
              >
                Single Round
              </button>
              <button
                type="button"
                onClick={() => { setWinMode("points"); setWinValue(500); }}
                className={`flex-1 py-2 px-3 rounded-lg text-sm font-semibold transition-colors ${
                  winMode === "points"
                    ? "bg-purple-600 text-white"
                    : "bg-gray-800 text-gray-400 hover:text-white"
                }`}
              >
                First to 500
              </button>
              <button
                type="button"
                onClick={() => { setWinMode("lowest_score"); setWinValue(500); }}
                className={`flex-1 py-2 px-3 rounded-lg text-sm font-semibold transition-colors ${
                  winMode === "lowest_score"
                    ? "bg-purple-600 text-white"
                    : "bg-gray-800 text-gray-400 hover:text-white"
                }`}
              >
                Lowest Score
              </button>
            </div>
            {(winMode === "points" || winMode === "lowest_score") && (
              <div className="flex items-center gap-3 mb-2">
                <label className="text-gray-400 text-sm whitespace-nowrap">
                  {winMode === "points" ? "Points to win:" : "Point limit:"}
                </label>
                <input
                  type="number"
                  min={50}
                  max={1000}
                  step={50}
                  value={winValue}
                  onChange={(e) => setWinValue(Math.max(50, Math.min(1000, parseInt(e.target.value) || 500)))}
                  className="w-24 px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm text-center focus:outline-none focus:border-purple-500"
                />
              </div>
            )}
            <p className="text-gray-600 text-xs mt-2">
              {winMode === "single_round"
                ? "First to empty their hand wins. One round, no scoring."
                : winMode === "points"
                ? `Official rules: winner banks opponents' card points each round. First to ${winValue} wins.`
                : `Play until someone hits ${winValue} points. Each player keeps their own remaining card points. Lowest total score wins.`}
            </p>
          </>
        ) : (
          <>
            <div className="flex gap-3 mb-3">
              <button
                type="button"
                onClick={() => setWinMode("rounds")}
                className={`flex-1 py-2 px-3 rounded-lg text-sm font-semibold transition-colors ${
                  winMode === "rounds"
                    ? "bg-purple-600 text-white"
                    : "bg-gray-800 text-gray-400 hover:text-white"
                }`}
              >
                Round-based
              </button>
              <button
                type="button"
                onClick={() => setWinMode("points")}
                className={`flex-1 py-2 px-3 rounded-lg text-sm font-semibold transition-colors ${
                  winMode === "points"
                    ? "bg-purple-600 text-white"
                    : "bg-gray-800 text-gray-400 hover:text-white"
                }`}
              >
                First to N points
              </button>
            </div>
            <div className="flex items-center gap-3">
              <label className="text-gray-400 text-sm whitespace-nowrap">
                {winMode === "rounds" ? "Number of rounds:" : "Points to win:"}
              </label>
              <input
                type="number"
                min={1}
                max={winMode === "rounds" ? 50 : 25}
                value={winValue}
                onChange={(e) => setWinValue(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-20 px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm text-center focus:outline-none focus:border-purple-500"
              />
            </div>
            <p className="text-gray-600 text-xs mt-2">
              {winMode === "rounds"
                ? `Game ends after ${winValue} round${winValue !== 1 ? "s" : ""}. Highest score wins.`
                : `First player to reach ${winValue} point${winValue !== 1 ? "s" : ""} wins instantly.`}
            </p>
          </>
        )}
      </div>

      {/* Card totals (not for Uno) */}
      {gameType !== "uno" && gameType !== "codenames" && (
        <div className="flex gap-4 text-sm">
          <span className="text-gray-400">
            Total: <span className="text-red-400 font-semibold">{totalChaos}</span> prompts,{" "}
            <span className="text-purple-400 font-semibold">{totalKnowledge}</span> answers
          </span>
        </div>
      )}

      {/* Codenames word pool editor */}
      {gameType === "codenames" && (
        <div className="bg-gray-900 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-cyan-400 uppercase tracking-wide">Word Pool</h2>
            <span className="text-xs text-gray-500">{packs[0]?.knowledgeCards.filter(c => c.text.trim()).length || 0} words (min 25)</span>
          </div>
          <p className="text-gray-500 text-xs">Add words or short phrases for the 5x5 grid. The game picks 25 randomly each round. More words = more variety.</p>
          <div className="space-y-1.5">
            {(packs[0]?.knowledgeCards || []).map((card, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="text"
                  value={card.text}
                  onChange={(e) => {
                    const updated = [...(packs[0]?.knowledgeCards || [])];
                    updated[i] = { ...updated[i], text: e.target.value };
                    updatePack(packs[0].id, (p) => ({ ...p, knowledgeCards: updated }));
                  }}
                  placeholder={`Word ${i + 1}, e.g. "Dragon", "Night Sky"`}
                  className="flex-1 px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-cyan-500 placeholder-gray-600"
                />
                {(packs[0]?.knowledgeCards.length || 0) > 1 && (
                  <button
                    type="button"
                    onClick={() => {
                      const updated = (packs[0]?.knowledgeCards || []).filter((_, idx) => idx !== i);
                      updatePack(packs[0].id, (p) => ({ ...p, knowledgeCards: updated }));
                    }}
                    className="text-gray-600 hover:text-red-400 text-xs"
                  >
                    x
                  </button>
                )}
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              updatePack(packs[0].id, (p) => ({ ...p, knowledgeCards: [...p.knowledgeCards, { text: "" }] }));
            }}
            className="w-full py-2 bg-cyan-600/20 hover:bg-cyan-600/30 border border-cyan-600/50 rounded-lg text-cyan-400 text-sm font-medium transition-colors"
          >
            + Add Word
          </button>
        </div>
      )}

      {/* Card Packs (not for Uno or Codenames) */}
      {gameType !== "uno" && gameType !== "codenames" && packs.map((pack) => (
        <div
          key={pack.id}
          ref={(el) => {
            if (el && newPackRef.current === pack.id) {
              newPackRef.current = null;
              setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
            }
          }}
        >
          <CardPackEditor
            pack={pack}
            isBase={pack.type === "base"}
            gameType={gameType}
            deckName={name}
            deckDescription={description}
            pillars={{ maturity, flavorThemes, chaosLevel, wildcard }}
            onUpdate={(updater) => updatePack(pack.id, updater)}
            onRemove={() => removePack(pack.id)}
          />
        </div>
      ))}

      {/* Add expansion / themed pack buttons (create mode only, after base has cards, not for Uno) */}
      {!initial && baseHasCards && gameType !== "uno" && gameType !== "codenames" && (
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => addPack("expansion")}
            className="flex-1 py-3 bg-yellow-600/10 hover:bg-yellow-600/20 border border-yellow-600/40 rounded-xl text-yellow-400 font-semibold text-sm transition-colors"
          >
            + Add Expansion Box
          </button>
          <button
            type="button"
            onClick={() => addPack("themed")}
            className="flex-1 py-3 bg-cyan-600/10 hover:bg-cyan-600/20 border border-cyan-600/40 rounded-xl text-cyan-400 font-semibold text-sm transition-colors"
          >
            + Add Themed Pack
          </button>
        </div>
      )}

      {!initial && !baseHasCards && packs.length === 1 && (
        <p className="text-gray-500 text-xs text-center">
          Add at least 5 prompt cards and 15 answer cards to the Base Game to unlock Expansion Boxes and Themed Packs
        </p>
      )}

      {error && <p className="text-red-400 text-sm">{error}</p>}

      <button
        onClick={handleSubmit}
        disabled={saving}
        className="w-full py-3 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 rounded-lg font-semibold text-lg transition-colors"
      >
        {saving ? "Saving..." : submitLabel}
      </button>
    </div>
  );
}

/* ── Card Pack Editor ── */

function CardPackEditor({
  pack,
  isBase,
  gameType,
  deckName,
  deckDescription,
  pillars,
  onUpdate,
  onRemove,
}: {
  pack: CardPack;
  isBase: boolean;
  gameType: string;
  deckName: string;
  deckDescription: string;
  pillars: { maturity: string; flavorThemes: string[]; chaosLevel: number; wildcard: string };
  onUpdate: (updater: (p: CardPack) => CardPack) => void;
  onRemove: () => void;
}) {
  const style = PACK_LABELS[pack.type];
  const chaosCardCount = pack.chaosCards.filter((c) => c.text.trim()).length;
  const knowledgeCardCount = pack.knowledgeCards.filter((c) => c.text.trim()).length;

  const updateChaos = (index: number, field: keyof CardInput, value: string | number | boolean) => {
    onUpdate((p) => {
      const updated = [...p.chaosCards];
      updated[index] = { ...updated[index], [field]: value };
      return { ...p, chaosCards: updated };
    });
  };

  const updateKnowledge = (index: number, value: string) => {
    onUpdate((p) => {
      const updated = [...p.knowledgeCards];
      updated[index] = { text: value };
      return { ...p, knowledgeCards: updated };
    });
  };

  return (
    <div className={`bg-gray-900 rounded-xl border ${style.border} overflow-hidden`}>
      {/* Pack header */}
      <div className="flex items-center justify-between p-4">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <button
            type="button"
            onClick={() => onUpdate((p) => ({ ...p, open: !p.open }))}
            className="text-gray-400"
          >
            <Icon icon={pack.open ? "mdi:chevron-up" : "mdi:chevron-down"} width={18} />
          </button>
          <h3 className={`font-semibold ${style.color}`}>{pack.name || (pack.type === "expansion" ? "Expansion Box" : "Themed Pack")}</h3>
          <span className="text-gray-500 text-xs whitespace-nowrap">
            {chaosCardCount} {gameType === "apples-to-apples" ? "green" : "prompts"} · {knowledgeCardCount} {gameType === "apples-to-apples" ? "red" : "answers"}
          </span>
        </div>
        {!isBase && (
          <button
            type="button"
            onClick={onRemove}
            className="text-gray-500 hover:text-red-400 text-sm ml-2 transition-colors"
          >
            Remove
          </button>
        )}
      </div>

      {pack.open && (
        <div className="px-4 pb-4 space-y-5">
          {/* AI Generator for expansion/themed packs (base uses top-level generator) */}
          {!isBase && (
            <AIGenerate
              packName={pack.name}
              packType={pack.type}
              gameType={gameType}
              deckName={deckName}
              deckDescription={pack.description || deckDescription}
              pillars={pillars}
              onGenerated={(chaos, knowledge, generatedName, generatedDescription) => {
                onUpdate((p) => ({
                  ...p,
                  ...(generatedName ? { name: generatedName } : {}),
                  ...(generatedDescription ? { description: generatedDescription } : {}),
                  chaosCards: [...p.chaosCards, ...chaos],
                  knowledgeCards: [...p.knowledgeCards, ...knowledge],
                }));
              }}
            />
          )}

          {/* Name and description fields for expansion/themed packs */}
          {!isBase && (
            <div className="space-y-2">
              <input
                type="text"
                value={pack.name}
                onChange={(e) => onUpdate((p) => ({ ...p, name: e.target.value }))}
                placeholder="Pack name..."
                className={`w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg font-semibold ${style.color} focus:outline-none focus:border-gray-500 text-sm`}
              />
              <textarea
                value={pack.description}
                onChange={(e) => onUpdate((p) => ({ ...p, description: e.target.value }))}
                placeholder="Pack description (optional)..."
                rows={2}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-gray-500 text-sm resize-none"
              />
            </div>
          )}

          {gameType === "joking-hazard" ? (
            /* JH: Single unified panel cards editor — all cards are panels, toggle red for bonus */
            <CardListEditor
              label="Panel Cards"
              labelColor="text-purple-400"
              cards={pack.knowledgeCards}
              placeholder={(i) => `Panel ${i + 1}, e.g. "One of them quietly starts crying"`}
              hint={isBase
                ? "All cards are panels. Toggle RED for bonus punchlines (~15-20%). Min 20 cards total."
                : "Panel cards for this pack. Toggle RED for bonus cards."}
              addButtonColor="bg-purple-600/20 hover:bg-purple-600/30 text-purple-400 border-purple-600/50"
              focusColor="focus:border-purple-500"
              showBonus
              packBadge={isBase ? undefined : { name: pack.name, type: pack.type }}
              onUpdate={(index, field, value) => {
                onUpdate((p) => {
                  const updated = [...p.knowledgeCards];
                  updated[index] = { ...updated[index], [field]: value };
                  return { ...p, knowledgeCards: updated };
                });
              }}
              onAdd={() => onUpdate((p) => ({ ...p, knowledgeCards: [...p.knowledgeCards, { text: "" }] }))}
              onRemove={(index) =>
                onUpdate((p) => ({ ...p, knowledgeCards: p.knowledgeCards.filter((_, i) => i !== index) }))
              }
            />
          ) : (
            <>
              {/* Chaos / Green Cards */}
              <CardListEditor
                label={gameType === "apples-to-apples" ? "Green Cards" : "Prompt Cards"}
                labelColor={gameType === "apples-to-apples" ? "text-green-400" : "text-red-400"}
                cards={pack.chaosCards}
                placeholder={(i) => gameType === "apples-to-apples"
                  ? `Green card ${i + 1}, e.g. "Scary", "Hilarious"`
                  : `Prompt ${i + 1}, e.g. "The root cause was ___"`}
                hint={gameType === "apples-to-apples"
                  ? (isBase ? "Single adjective or short description per card. No blanks. Min 5 cards." : "Single adjective or short description per card. No blanks.")
                  : (isBase ? "Use ___ as a blank for players to fill in. Min 5 cards." : "Use ___ as a blank for players to fill in.")}
                addButtonColor={gameType === "apples-to-apples"
                  ? "bg-green-600/20 hover:bg-green-600/30 text-green-400 border-green-600/50"
                  : "bg-red-600/20 hover:bg-red-600/30 text-red-400 border-red-600/50"}
                focusColor={gameType === "apples-to-apples" ? "focus:border-green-500" : "focus:border-red-500"}
                showPick={gameType !== "apples-to-apples"}
                packBadge={isBase ? undefined : { name: pack.name, type: pack.type }}
                onUpdate={(index, field, value) => updateChaos(index, field, value)}
                onAdd={() => onUpdate((p) => ({ ...p, chaosCards: [...p.chaosCards, { text: "", pick: 1 }] }))}
                onRemove={(index) =>
                  onUpdate((p) => ({ ...p, chaosCards: p.chaosCards.filter((_, i) => i !== index) }))
                }
              />

              {/* Knowledge / Red Cards */}
              <CardListEditor
                label={gameType === "apples-to-apples" ? "Red Cards" : "Answer Cards"}
                labelColor={gameType === "apples-to-apples" ? "text-red-400" : "text-purple-400"}
                cards={pack.knowledgeCards}
                placeholder={(i) => gameType === "apples-to-apples"
                  ? `Red card ${i + 1}, e.g. "Puppies", "My first paycheck"`
                  : `Answer ${i + 1}`}
                hint={gameType === "apples-to-apples"
                  ? (isBase ? "Nouns, things, or short phrases. Min 15 cards." : "Nouns, things, or short phrases.")
                  : (isBase ? "Short answers or phrases. Min 15 cards." : "Short answers or phrases.")}
                addButtonColor={gameType === "apples-to-apples"
                  ? "bg-red-600/20 hover:bg-red-600/30 text-red-400 border-red-600/50"
                  : "bg-purple-600/20 hover:bg-purple-600/30 text-purple-400 border-purple-600/50"}
                focusColor={gameType === "apples-to-apples" ? "focus:border-red-500" : "focus:border-purple-500"}
                packBadge={isBase ? undefined : { name: pack.name, type: pack.type }}
                onUpdate={(index, _field, value) => updateKnowledge(index, value as string)}
                onAdd={() => onUpdate((p) => ({ ...p, knowledgeCards: [...p.knowledgeCards, { text: "" }] }))}
                onRemove={(index) =>
                  onUpdate((p) => ({ ...p, knowledgeCards: p.knowledgeCards.filter((_, i) => i !== index) }))
                }
              />
            </>
          )}

          {/* Bulk Add */}
          <BulkAdd
            gameType={gameType}
            onAddChaos={gameType === "joking-hazard"
              ? (cards) => onUpdate((p) => ({ ...p, knowledgeCards: [...p.knowledgeCards, ...cards] }))
              : (cards) => onUpdate((p) => ({ ...p, chaosCards: [...p.chaosCards, ...cards] }))}
            onAddKnowledge={(cards) =>
              onUpdate((p) => ({ ...p, knowledgeCards: [...p.knowledgeCards, ...cards] }))
            }
          />
        </div>
      )}
    </div>
  );
}

/* ── Card List Editor ── */

function CardListEditor({
  label,
  labelColor,
  cards,
  placeholder,
  hint,
  addButtonColor,
  focusColor,
  showPick,
  showBonus,
  packBadge,
  onUpdate,
  onAdd,
  onRemove,
}: {
  label: string;
  labelColor: string;
  cards: CardInput[];
  placeholder: (i: number) => string;
  hint: string;
  addButtonColor: string;
  focusColor: string;
  showPick?: boolean;
  showBonus?: boolean;
  packBadge?: { name: string; type: PackType };
  onUpdate: (index: number, field: keyof CardInput, value: string | number | boolean) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
}) {
  const [open, setOpen] = useState(true);
  const count = cards.filter((c) => c.text.trim()).length;

  const badgeClass = packBadge?.type === "themed"
    ? "text-cyan-300 bg-cyan-900/40 border border-cyan-600/40"
    : "text-yellow-300 bg-yellow-900/40 border border-yellow-600/40";

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center justify-between w-full mb-2"
      >
        <h4 className={`text-sm font-semibold ${labelColor}`}>
          {label} — {count}
        </h4>
        <Icon icon={open ? "mdi:chevron-up" : "mdi:chevron-down"} className="text-gray-500" width={16} />
      </button>
      {open && (
        <>
          <div className="flex items-center justify-between mb-2">
            <p className="text-gray-500 text-xs">{hint}</p>
            <button
              onClick={onAdd}
              className={`px-3 py-1 text-xs rounded border transition-colors ${addButtonColor}`}
            >
              + Add
            </button>
          </div>
          <div className="space-y-2">
            {cards.map((card, i) => (
              <div key={i} className="flex gap-2 items-center">
                {packBadge && (
                  <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium leading-tight max-w-[80px] truncate ${badgeClass}`}>
                    {packBadge.name}
                  </span>
                )}
                <input
                  type="text"
                  placeholder={placeholder(i)}
                  value={card.text}
                  onChange={(e) => onUpdate(i, "text", e.target.value)}
                  className={`flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-600 focus:outline-none ${focusColor} text-sm`}
                />
                {showPick && (
                  <select
                    value={card.pick || 1}
                    onChange={(e) => onUpdate(i, "pick", parseInt(e.target.value))}
                    className="w-20 px-2 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none"
                  >
                    <option value={1}>Pick 1</option>
                    <option value={2}>Pick 2</option>
                  </select>
                )}
                {showBonus && (
                  <button
                    type="button"
                    onClick={() => onUpdate(i, "bonus" as keyof CardInput, !card.bonus)}
                    className={`shrink-0 px-2 py-2 rounded-lg text-xs font-semibold border transition-colors ${
                      card.bonus
                        ? "bg-red-600/30 border-red-500 text-red-300"
                        : "bg-gray-800 border-gray-700 text-gray-500 hover:border-gray-500"
                    }`}
                    title={card.bonus ? "Bonus card (red) — worth 2 pts" : "Make this a bonus card (red border)"}
                  >
                    {card.bonus ? "RED" : "red"}
                  </button>
                )}
                {cards.length > 1 && (
                  <button
                    onClick={() => onRemove(i)}
                    className="p-1 text-gray-500 hover:text-red-400 transition-colors"
                  >
                    <Icon icon="mdi:close" width={16} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ── Bulk Add ── */

function BulkAdd({
  onAddChaos,
  onAddKnowledge,
  gameType = "cards-against-humanity",
}: {
  onAddChaos: (cards: CardInput[]) => void;
  onAddKnowledge: (cards: CardInput[]) => void;
  gameType?: string;
}) {
  const isJH = gameType === "joking-hazard";
  const [text, setText] = useState("");
  const [type, setType] = useState<"chaos" | "knowledge">("knowledge");
  const [open, setOpen] = useState(false);

  const handleAdd = () => {
    const lines = text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (lines.length === 0) return;

    if (type === "chaos") {
      onAddChaos(lines.map((l) => ({ text: l, pick: 1 })));
    } else {
      onAddKnowledge(lines.map((l) => ({ text: l })));
    }
    setText("");
  };

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
      >
        <Icon icon={open ? "mdi:chevron-up" : "mdi:chevron-down"} width={14} className="inline" />
        {open ? " Hide" : " Show"} Bulk Add
      </button>
      {open && (
        <div className="mt-2 bg-gray-800/50 rounded-lg p-3">
          <div className="flex gap-2 mb-2">
            <button
              onClick={() => setType("chaos")}
              className={`px-3 py-1 text-xs rounded transition-colors ${
                type === "chaos"
                  ? "bg-red-600 text-white"
                  : "bg-gray-800 text-gray-400 hover:text-white"
              }`}
            >
              {isJH ? "Scenes" : "Prompts"}
            </button>
            <button
              onClick={() => setType("knowledge")}
              className={`px-3 py-1 text-xs rounded transition-colors ${
                type === "knowledge"
                  ? "bg-purple-600 text-white"
                  : "bg-gray-800 text-gray-400 hover:text-white"
              }`}
            >
              {isJH ? "Panels" : "Answers"}
            </button>
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            placeholder={
              type === "chaos"
                ? isJH
                  ? "Two coworkers stare at a whiteboard\nA meeting that should have been an email"
                  : "The real reason for the outage was ___\nNobody told me about ___"
                : isJH
                  ? "One of them quietly starts crying\nEveryone pretends nothing happened"
                  : "Undocumented tribal knowledge\nA 47-slide PowerPoint"
            }
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-600 focus:outline-none text-sm resize-none"
          />
          <button
            onClick={handleAdd}
            className="mt-2 px-4 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm font-medium transition-colors"
          >
            Add Lines
          </button>
        </div>
      )}
    </div>
  );
}

/* ── Top-level AI Deck Generator ── */

function AIGenerationPanel({
  gameType,
  isCreate,
  maturity,
  setMaturity,
  flavorThemes,
  setFlavorThemes,
  chaosLevel,
  setChaosLevel,
  wildcard,
  setWildcard,
  onGenerate,
}: {
  gameType: string;
  isCreate: boolean;
  maturity: string;
  setMaturity: (v: string) => void;
  flavorThemes: string[];
  setFlavorThemes: (v: string[]) => void;
  chaosLevel: number;
  setChaosLevel: (v: number) => void;
  wildcard: string;
  setWildcard: (v: string) => void;
  onGenerate: (theme: string) => Promise<void>;
}) {
  const [theme, setTheme] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [themeSearch, setThemeSearch] = useState("");

  const handleGenerate = async () => {
    if (!theme.trim()) return;
    setGenerating(true);
    setError(null);
    try {
      await onGenerate(theme.trim());
      setTheme("");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="bg-gradient-to-r from-purple-900/30 to-blue-900/30 rounded-xl border border-purple-500/30 overflow-hidden">
      <div className="p-5 space-y-5">
        {/* Header + Theme input (create mode) */}
        {isCreate && (
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Icon icon="mdi:creation" className="text-purple-400" width={20} />
              <span className="font-bold text-lg text-purple-100">AI Deck Generator</span>
            </div>
            <p className="text-gray-400 text-xs mb-3">
              {gameType === "joking-hazard"
                ? "Describe a theme — AI generates scene & panel cards"
                : gameType === "codenames"
                ? "Describe a theme — AI generates a word pool for the grid"
                : gameType === "uno"
                ? "Describe a theme — AI generates themed color names, action cards, and deck info"
                : "Describe a theme — AI generates deck name, description, and all cards"}
            </p>
            <input
              type="text"
              value={theme}
              onChange={(e) => { setTheme(e.target.value); setError(null); }}
              placeholder='e.g. "Corporate Buzzwords", "IT Service Desk", "Dad Jokes"'
              className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-purple-500"
              onKeyDown={(e) => e.key === "Enter" && !generating && handleGenerate()}
            />
          </div>
        )}

        {!isCreate && (
          <div className="flex items-center gap-2">
            <Icon icon="mdi:tune-variant" className="text-purple-400" width={18} />
            <span className="font-semibold text-sm text-gray-200">Generation Settings</span>
          </div>
        )}

        {/* Content Safety */}
        <div>
          <label className="block text-xs font-semibold text-gray-400 mb-2 uppercase tracking-wide">Content Safety</label>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {MATURITY_LEVELS.filter((level) =>
              (gameType === "apples-to-apples" || gameType === "uno" || gameType === "codenames") ? level.id === "kid-friendly" || level.id === "moderate" : true
            ).map((level) => (
              <button
                key={level.id}
                type="button"
                onClick={() => setMaturity(level.id)}
                className={`flex flex-col items-center gap-1 p-3 rounded-lg border text-sm font-medium transition-colors ${
                  maturity === level.id
                    ? "bg-purple-600/30 border-purple-500 text-purple-200"
                    : "bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500"
                }`}
              >
                <Icon icon={level.icon} width={20} />
                <span className="text-xs">{level.label}</span>
              </button>
            ))}
          </div>
          <p className="text-gray-600 text-xs mt-1">{MATURITY_LEVELS.find((m) => m.id === maturity)?.desc}</p>
        </div>

        {/* Flavor Themes */}
        <div>
          <label className="block text-xs font-semibold text-gray-400 mb-2 uppercase tracking-wide">
            Flavor Themes
            {flavorThemes.length > 0 && (
              <span className="ml-2 text-purple-400 normal-case font-normal">{flavorThemes.length} selected</span>
            )}
          </label>
          <input
            type="text"
            value={themeSearch}
            onChange={(e) => setThemeSearch(e.target.value)}
            placeholder="Search themes..."
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-purple-500 text-sm mb-2"
          />
          <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto">
            {FLAVOR_THEMES.filter((t) => t.label.toLowerCase().includes(themeSearch.toLowerCase())).map((ft) => {
              const active = flavorThemes.includes(ft.id);
              return (
                <button
                  key={ft.id}
                  type="button"
                  onClick={() => setFlavorThemes(active ? flavorThemes.filter((id) => id !== ft.id) : [...flavorThemes, ft.id])}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                    active
                      ? "bg-cyan-600/30 border-cyan-500 text-cyan-200"
                      : "bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600"
                  }`}
                >
                  <Icon icon={ft.icon} width={13} />
                  {ft.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Chaos Level */}
        <div>
          <label className="block text-xs font-semibold text-gray-400 mb-1 uppercase tracking-wide">
            Chaos Level — <span className="text-orange-400">{chaosLevel}%</span>{gameType === "uno" ? " custom actions" : " meta cards"}
          </label>
          <input type="range" min={0} max={50} step={5} value={chaosLevel} onChange={(e) => setChaosLevel(parseInt(e.target.value))} className="w-full accent-orange-500" />
          <div className="flex justify-between text-xs text-gray-600 mt-0.5">
            <span>0% — {gameType === "uno" ? "standard Uno actions" : gameType === "joking-hazard" ? "all comic panels" : gameType === "apples-to-apples" ? "all adjective prompts" : "all fill-in-the-blank"}</span>
            <span>50% — {gameType === "uno" ? "half are custom actions" : "half are rule-breakers"}</span>
          </div>
          {chaosLevel > 0 && (
            <p className="text-orange-400/80 text-xs mt-1">
              {gameType === "uno"
                ? `~${chaosLevel}% of action cards will be replaced with custom themed actions that mix up gameplay`
                : `~${chaosLevel}% of ${gameType === "joking-hazard" ? "scene" : gameType === "apples-to-apples" ? "green" : "prompt"} cards will be meta cards that manipulate scores, UI, or hands`}
            </p>
          )}
        </div>

        {/* Wildcard Context */}
        <div>
          <label className="block text-xs font-semibold text-gray-400 mb-1 uppercase tracking-wide">Wildcard Context</label>
          <input
            type="text"
            value={wildcard}
            onChange={(e) => setWildcard(e.target.value)}
            placeholder='e.g. "Inside jokes about our team", "References to our podcast"'
            maxLength={200}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-purple-500 text-sm"
          />
          <p className="text-gray-600 text-xs mt-1">Hyper-niche context woven into the AI-generated cards</p>
        </div>

        {/* Generate button (create mode) */}
        {isCreate && (
          <div>
            <button
              type="button"
              onClick={handleGenerate}
              disabled={generating || !theme.trim()}
              className="w-full py-3 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 disabled:text-gray-500 rounded-lg font-semibold text-lg transition-colors"
            >
              {generating ? "Generating..." : "Generate Deck"}
            </button>
            {error && <p className="text-red-400 text-sm mt-2">{error}</p>}
            {generating && (
              <p className="text-purple-300 text-sm mt-2 animate-pulse">
                AI is building your deck — this may take a moment...
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Pack-level AI Card Generator ── */

function AIGenerate({
  packName,
  packType,
  gameType,
  deckName,
  deckDescription,
  pillars,
  onGenerated,
}: {
  packName: string;
  packType: string;
  gameType: string;
  deckName: string;
  deckDescription: string;
  pillars?: { maturity: string; flavorThemes: string[]; chaosLevel: number; wildcard: string };
  onGenerated: (chaos: CardInput[], knowledge: CardInput[], name?: string, description?: string) => void;
}) {
  const defaultPrompts = packType === "themed" ? 2 : 5;
  const defaultAnswers = packType === "themed" ? 6 : 12;

  const [theme, setTheme] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [promptCount, setPromptCount] = useState(defaultPrompts);
  const [answerCount, setAnswerCount] = useState(defaultAnswers);

  const handleGenerate = async () => {
    if (!theme.trim()) return;
    setGenerating(true);
    setError(null);
    try {
      const cards = await generateCardsAI({
        theme: theme.trim(),
        gameType,
        packType,
        packName,
        deckName,
        deckDescription,
        chaosCount: promptCount,
        knowledgeCount: answerCount,
        ...(pillars ? {
          maturity: pillars.maturity,
          flavorThemes: pillars.flavorThemes,
          chaosLevel: pillars.chaosLevel,
          wildcard: pillars.wildcard.trim() || undefined,
        } : {}),
      });
      onGenerated(
        cards.chaosCards.map((c) => ({ text: c.text, pick: c.pick || 1 })),
        cards.knowledgeCards.map((c) => ({ text: c.text })),
        cards.name,
        cards.description,
      );
      setTheme("");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="bg-gradient-to-r from-purple-900/30 to-blue-900/30 rounded-lg p-4 border border-purple-500/20">
      <p className="text-sm font-semibold text-purple-200 mb-1">
        AI Card Generator
      </p>
      <p className="text-gray-400 text-xs mb-3">
        Add more cards to {packName}
      </p>
      <div className="flex gap-2 mb-3">
        <input
          type="text"
          value={theme}
          onChange={(e) => {
            setTheme(e.target.value);
            setError(null);
          }}
          placeholder='e.g. "Corporate Buzzwords" or "IT Service Desk"'
          className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-purple-500 text-sm"
          onKeyDown={(e) => e.key === "Enter" && !generating && handleGenerate()}
        />
        <button
          onClick={handleGenerate}
          disabled={generating || !theme.trim()}
          className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 disabled:text-gray-500 rounded-lg text-sm font-semibold transition-colors whitespace-nowrap"
        >
          {generating ? "Generating..." : "Generate"}
        </button>
      </div>
      <div className="flex gap-4">
        <label className="flex items-center gap-2 text-xs text-gray-400">
          <span>{gameType === "joking-hazard" ? "Scenes" : "Prompts"}</span>
          <input
            type="number"
            min={1}
            max={30}
            value={promptCount}
            onChange={(e) => setPromptCount(Math.max(1, Math.min(30, parseInt(e.target.value) || 1)))}
            className="w-14 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-white text-xs focus:outline-none focus:border-purple-500 text-center"
          />
        </label>
        <label className="flex items-center gap-2 text-xs text-gray-400">
          <span>{gameType === "joking-hazard" ? "Panels" : "Answers"}</span>
          <input
            type="number"
            min={1}
            max={75}
            value={answerCount}
            onChange={(e) => setAnswerCount(Math.max(1, Math.min(75, parseInt(e.target.value) || 1)))}
            className="w-14 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-white text-xs focus:outline-none focus:border-purple-500 text-center"
          />
        </label>
      </div>
      {error && <p className="text-red-400 text-xs mt-2">{error}</p>}
      {generating && (
        <p className="text-purple-400 text-xs mt-2 animate-pulse">
          AI is crafting your cards... this may take a moment
        </p>
      )}
    </div>
  );
}
