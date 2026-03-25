"use client";

import { useState } from "react";
import { generateCardsAI, generateDeckAI } from "@/lib/api";

interface CardInput {
  text: string;
  pick?: number;
}

interface WinCondition {
  mode: "rounds" | "points";
  value: number;
}

interface DeckFormData {
  name: string;
  description: string;
  chaosCards: CardInput[];
  knowledgeCards: CardInput[];
  winCondition: WinCondition;
}

type PackType = "base" | "expansion" | "themed";

interface CardPack {
  id: string;
  type: PackType;
  name: string;
  chaosCards: CardInput[];
  knowledgeCards: CardInput[];
  open: boolean;
}

interface Props {
  initial?: DeckFormData;
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
  const [winMode, setWinMode] = useState<"rounds" | "points">(initial?.winCondition?.mode || "rounds");
  const [winValue, setWinValue] = useState(initial?.winCondition?.value || 10);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [packs, setPacks] = useState<CardPack[]>([
    {
      id: "base",
      type: "base",
      name: "Base Game",
      chaosCards: initial?.chaosCards || [{ text: "", pick: 1 }],
      knowledgeCards: initial?.knowledgeCards || [{ text: "" }],
      open: true,
    },
  ]);

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

  const addPack = (type: PackType) => {
    const defaultName = type === "expansion" ? "Expansion Box" : "Themed Pack";
    setPacks([
      ...packs,
      {
        id: makeId(),
        type,
        name: defaultName,
        chaosCards: [{ text: "", pick: 1 }],
        knowledgeCards: [{ text: "" }],
        open: true,
      },
    ]);
  };

  const handleSubmit = async () => {
    setError(null);
    if (!name.trim()) { setError("Deck name is required"); return; }

    const allChaos = packs.flatMap((p) => p.chaosCards).filter((c) => c.text.trim());
    const allKnowledge = packs.flatMap((p) => p.knowledgeCards).filter((c) => c.text.trim());

    if (allChaos.length < 5) { setError("Need at least 5 prompt cards with text across all packs"); return; }
    if (allKnowledge.length < 15) { setError("Need at least 15 answer cards with text across all packs"); return; }

    setSaving(true);
    try {
      await onSubmit({
        name: name.trim(),
        description: description.trim(),
        chaosCards: allChaos,
        knowledgeCards: allKnowledge,
        winCondition: { mode: winMode, value: winValue },
      });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleGenerateDeck = async (theme: string) => {
    const deck = await generateDeckAI(theme);
    setName(deck.name);
    setDescription(deck.description);
    setPacks((prev) => {
      const basePack = prev.find((p) => p.type === "base");
      const rest = prev.filter((p) => p.type !== "base");
      return [
        {
          ...(basePack || { id: "base", type: "base" as const, name: "Base Game", open: true }),
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
          defaultValue="cards-against-humanity"
        >
          <option value="cards-against-humanity">Cards Against Humanity</option>
        </select>
        <p className="text-gray-500 text-xs mt-1">More game types coming soon</p>
      </div>

      {/* Top-level AI Deck Generator */}
      <DeckAIGenerate onGenerated={handleGenerateDeck} />

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
      </div>

      {/* Win Condition */}
      <div className="bg-gray-900 rounded-xl p-4">
        <h2 className="text-sm font-semibold text-gray-300 mb-3">Win Condition</h2>
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
      </div>

      {/* Card totals */}
      <div className="flex gap-4 text-sm">
        <span className="text-gray-400">
          Total: <span className="text-red-400 font-semibold">{totalChaos}</span> prompts,{" "}
          <span className="text-purple-400 font-semibold">{totalKnowledge}</span> answers
        </span>
      </div>

      {/* Card Packs */}
      {packs.map((pack) => (
        <CardPackEditor
          key={pack.id}
          pack={pack}
          isBase={pack.type === "base"}
          onUpdate={(updater) => updatePack(pack.id, updater)}
          onRemove={() => removePack(pack.id)}
        />
      ))}

      {/* Add expansion / themed pack buttons */}
      {baseHasCards && (
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

      {!baseHasCards && packs.length === 1 && (
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
  onUpdate,
  onRemove,
}: {
  pack: CardPack;
  isBase: boolean;
  onUpdate: (updater: (p: CardPack) => CardPack) => void;
  onRemove: () => void;
}) {
  const style = PACK_LABELS[pack.type];
  const chaosCount = pack.chaosCards.filter((c) => c.text.trim()).length;
  const knowledgeCount = pack.knowledgeCards.filter((c) => c.text.trim()).length;

  const updateChaos = (index: number, field: keyof CardInput, value: string | number) => {
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
            className="text-gray-400 text-sm"
          >
            {pack.open ? "▲" : "▼"}
          </button>
          {isBase ? (
            <h3 className={`font-semibold ${style.color}`}>{pack.name}</h3>
          ) : (
            <input
              type="text"
              value={pack.name}
              onChange={(e) => onUpdate((p) => ({ ...p, name: e.target.value }))}
              className={`bg-transparent font-semibold ${style.color} focus:outline-none border-b border-transparent focus:border-gray-600 text-sm`}
              placeholder="Pack name..."
            />
          )}
          <span className="text-gray-500 text-xs whitespace-nowrap">
            {chaosCount} prompts · {knowledgeCount} answers
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
          {/* AI Generator for this pack */}
          <AIGenerate
            packName={pack.name}
            onGenerated={(chaos, knowledge) => {
              onUpdate((p) => ({
                ...p,
                chaosCards: [...p.chaosCards, ...chaos],
                knowledgeCards: [...p.knowledgeCards, ...knowledge],
              }));
            }}
          />

          {/* Chaos Cards */}
          <CardListEditor
            label="Prompt Cards"
            labelColor="text-red-400"
            cards={pack.chaosCards}
            placeholder={(i) => `Prompt ${i + 1}, e.g. "The root cause was ___"`}
            hint={isBase ? "Use ___ as a blank for players to fill in. Min 5 cards." : "Use ___ as a blank for players to fill in."}
            addButtonColor="bg-red-600/20 hover:bg-red-600/30 text-red-400 border-red-600/50"
            focusColor="focus:border-red-500"
            showPick
            onUpdate={(index, field, value) => updateChaos(index, field, value)}
            onAdd={() => onUpdate((p) => ({ ...p, chaosCards: [...p.chaosCards, { text: "", pick: 1 }] }))}
            onRemove={(index) =>
              onUpdate((p) => ({ ...p, chaosCards: p.chaosCards.filter((_, i) => i !== index) }))
            }
          />

          {/* Knowledge Cards */}
          <CardListEditor
            label="Answer Cards"
            labelColor="text-purple-400"
            cards={pack.knowledgeCards}
            placeholder={(i) => `Answer ${i + 1}`}
            hint={isBase ? "Short answers or phrases. Min 15 cards." : "Short answers or phrases."}
            addButtonColor="bg-purple-600/20 hover:bg-purple-600/30 text-purple-400 border-purple-600/50"
            focusColor="focus:border-purple-500"
            onUpdate={(index, _field, value) => updateKnowledge(index, value as string)}
            onAdd={() => onUpdate((p) => ({ ...p, knowledgeCards: [...p.knowledgeCards, { text: "" }] }))}
            onRemove={(index) =>
              onUpdate((p) => ({ ...p, knowledgeCards: p.knowledgeCards.filter((_, i) => i !== index) }))
            }
          />

          {/* Bulk Add */}
          <BulkAdd
            onAddChaos={(cards) => onUpdate((p) => ({ ...p, chaosCards: [...p.chaosCards, ...cards] }))}
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
  onUpdate: (index: number, field: keyof CardInput, value: string | number) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
}) {
  const [open, setOpen] = useState(true);
  const count = cards.filter((c) => c.text.trim()).length;

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
        <span className="text-gray-500 text-xs">{open ? "▲" : "▼"}</span>
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
              <div key={i} className="flex gap-2">
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
                {cards.length > 1 && (
                  <button
                    onClick={() => onRemove(i)}
                    className="px-2 text-gray-500 hover:text-red-400 transition-colors"
                  >
                    ×
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
}: {
  onAddChaos: (cards: CardInput[]) => void;
  onAddKnowledge: (cards: CardInput[]) => void;
}) {
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
        {open ? "▲ Hide" : "▼ Show"} Bulk Add
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
              Prompts
            </button>
            <button
              onClick={() => setType("knowledge")}
              className={`px-3 py-1 text-xs rounded transition-colors ${
                type === "knowledge"
                  ? "bg-purple-600 text-white"
                  : "bg-gray-800 text-gray-400 hover:text-white"
              }`}
            >
              Answers
            </button>
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            placeholder={
              type === "chaos"
                ? "The real reason for the outage was ___\nNobody told me about ___"
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

function DeckAIGenerate({
  onGenerated,
}: {
  onGenerated: (theme: string) => Promise<void>;
}) {
  const [theme, setTheme] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    if (!theme.trim()) return;
    setGenerating(true);
    setError(null);
    try {
      await onGenerated(theme.trim());
      setTheme("");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="bg-gradient-to-r from-purple-900/50 to-blue-900/50 rounded-xl p-6 border border-purple-500/40">
      <p className="text-xl font-bold text-purple-100 mb-1">
        AI Deck Generator
      </p>
      <p className="text-gray-300 text-sm mb-4">
        Describe a theme and AI will generate a deck name, description, and all the cards for you
      </p>
      <div className="flex gap-2">
        <input
          type="text"
          value={theme}
          onChange={(e) => {
            setTheme(e.target.value);
            setError(null);
          }}
          placeholder='e.g. "Corporate Buzzwords", "IT Service Desk", "Dad Jokes"'
          className="flex-1 px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-purple-500"
          onKeyDown={(e) => e.key === "Enter" && !generating && handleGenerate()}
        />
        <button
          onClick={handleGenerate}
          disabled={generating || !theme.trim()}
          className="px-6 py-3 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 disabled:text-gray-500 rounded-lg font-semibold transition-colors whitespace-nowrap"
        >
          {generating ? "Generating..." : "Generate Deck"}
        </button>
      </div>
      {error && <p className="text-red-400 text-sm mt-3">{error}</p>}
      {generating && (
        <p className="text-purple-300 text-sm mt-3 animate-pulse">
          AI is building your deck — generating name, description, and cards...
        </p>
      )}
    </div>
  );
}

/* ── Pack-level AI Card Generator ── */

function AIGenerate({
  packName,
  onGenerated,
}: {
  packName: string;
  onGenerated: (chaos: CardInput[], knowledge: CardInput[]) => void;
}) {
  const [theme, setTheme] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    if (!theme.trim()) return;
    setGenerating(true);
    setError(null);
    try {
      const cards = await generateCardsAI(theme.trim());
      onGenerated(
        cards.chaosCards.map((c) => ({ text: c.text, pick: c.pick || 1 })),
        cards.knowledgeCards.map((c) => ({ text: c.text }))
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
      <div className="flex gap-2">
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
      {error && <p className="text-red-400 text-xs mt-2">{error}</p>}
      {generating && (
        <p className="text-purple-400 text-xs mt-2 animate-pulse">
          AI is crafting your cards... this may take a moment
        </p>
      )}
    </div>
  );
}
