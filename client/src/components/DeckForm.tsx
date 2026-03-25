"use client";

import { useState } from "react";
import { generateCardsAI } from "@/lib/api";

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

interface Props {
  initial?: DeckFormData;
  onSubmit: (data: DeckFormData) => Promise<void>;
  submitLabel: string;
}

export default function DeckForm({ initial, onSubmit, submitLabel }: Props) {
  const [name, setName] = useState(initial?.name || "");
  const [description, setDescription] = useState(initial?.description || "");
  const [chaosCards, setChaosCards] = useState<CardInput[]>(
    initial?.chaosCards || [{ text: "", pick: 1 }]
  );
  const [knowledgeCards, setKnowledgeCards] = useState<CardInput[]>(
    initial?.knowledgeCards || [{ text: "" }]
  );
  const [winMode, setWinMode] = useState<"rounds" | "points">(initial?.winCondition?.mode || "rounds");
  const [winValue, setWinValue] = useState(initial?.winCondition?.value || 10);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [chaosOpen, setChaosOpen] = useState(!initial || initial.chaosCards.length === 0);
  const [knowledgeOpen, setKnowledgeOpen] = useState(!initial || initial.knowledgeCards.length === 0);

  const updateChaos = (index: number, field: keyof CardInput, value: string | number) => {
    const updated = [...chaosCards];
    updated[index] = { ...updated[index], [field]: value };
    setChaosCards(updated);
  };

  const updateKnowledge = (index: number, value: string) => {
    const updated = [...knowledgeCards];
    updated[index] = { text: value };
    setKnowledgeCards(updated);
  };

  const removeChaos = (index: number) => {
    setChaosCards(chaosCards.filter((_, i) => i !== index));
  };

  const removeKnowledge = (index: number) => {
    setKnowledgeCards(knowledgeCards.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    setError(null);
    if (!name.trim()) { setError("Deck name is required"); return; }

    const validChaos = chaosCards.filter((c) => c.text.trim());
    const validKnowledge = knowledgeCards.filter((c) => c.text.trim());

    if (validChaos.length < 5) { setError("Need at least 5 Chaos cards (prompts) with text"); return; }
    if (validKnowledge.length < 15) { setError("Need at least 15 Knowledge cards (answers) with text"); return; }

    setSaving(true);
    try {
      await onSubmit({
        name: name.trim(),
        description: description.trim(),
        chaosCards: validChaos,
        knowledgeCards: validKnowledge,
        winCondition: { mode: winMode, value: winValue },
      });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
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

      {/* AI Generation — primary way to create a deck */}
      <AIGenerate
        onGenerated={(chaos, knowledge) => {
          setChaosCards([...chaosCards, ...chaos]);
          setKnowledgeCards([...knowledgeCards, ...knowledge]);
        }}
      />

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

      {/* Chaos Cards */}
      <div>
        <button
          type="button"
          onClick={() => setChaosOpen(!chaosOpen)}
          className="flex items-center justify-between w-full mb-3"
        >
          <h2 className="text-lg font-semibold text-red-400">
            Chaos Cards (Prompts) — {chaosCards.filter((c) => c.text.trim()).length}
          </h2>
          <span className="text-gray-400 text-sm">{chaosOpen ? "▲ Collapse" : "▼ Expand"}</span>
        </button>
        {chaosOpen && (
          <>
            <div className="flex items-center justify-between mb-3">
              <p className="text-gray-500 text-xs">
                Use ___ as a blank for players to fill in. Min 5 cards.
              </p>
              <button
                onClick={() => setChaosCards([...chaosCards, { text: "", pick: 1 }])}
                className="px-3 py-1 text-xs bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded border border-red-600/50 transition-colors"
              >
                + Add
              </button>
            </div>
            <div className="space-y-2">
              {chaosCards.map((card, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    type="text"
                    placeholder={`Prompt ${i + 1}, e.g. "The root cause was ___"`}
                    value={card.text}
                    onChange={(e) => updateChaos(i, "text", e.target.value)}
                    className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-red-500 text-sm"
                  />
                  <select
                    value={card.pick || 1}
                    onChange={(e) => updateChaos(i, "pick", parseInt(e.target.value))}
                    className="w-20 px-2 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none"
                  >
                    <option value={1}>Pick 1</option>
                    <option value={2}>Pick 2</option>
                  </select>
                  {chaosCards.length > 1 && (
                    <button
                      onClick={() => removeChaos(i)}
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

      {/* Knowledge Cards */}
      <div>
        <button
          type="button"
          onClick={() => setKnowledgeOpen(!knowledgeOpen)}
          className="flex items-center justify-between w-full mb-3"
        >
          <h2 className="text-lg font-semibold text-purple-400">
            Knowledge Cards (Answers) — {knowledgeCards.filter((c) => c.text.trim()).length}
          </h2>
          <span className="text-gray-400 text-sm">{knowledgeOpen ? "▲ Collapse" : "▼ Expand"}</span>
        </button>
        {knowledgeOpen && (
          <>
            <div className="flex items-center justify-between mb-3">
              <p className="text-gray-500 text-xs">
                Short answers or phrases. Min 15 cards.
              </p>
              <button
                onClick={() => setKnowledgeCards([...knowledgeCards, { text: "" }])}
                className="px-3 py-1 text-xs bg-purple-600/20 hover:bg-purple-600/30 text-purple-400 rounded border border-purple-600/50 transition-colors"
              >
                + Add
              </button>
            </div>
            <div className="space-y-2">
              {knowledgeCards.map((card, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    type="text"
                    placeholder={`Answer ${i + 1}`}
                    value={card.text}
                    onChange={(e) => updateKnowledge(i, e.target.value)}
                    className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-purple-500 text-sm"
                  />
                  {knowledgeCards.length > 1 && (
                    <button
                      onClick={() => removeKnowledge(i)}
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

      {/* Bulk add helper */}
      <BulkAdd
        onAddChaos={(cards) => setChaosCards([...chaosCards, ...cards])}
        onAddKnowledge={(cards) => setKnowledgeCards([...knowledgeCards, ...cards])}
      />

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

function BulkAdd({
  onAddChaos,
  onAddKnowledge,
}: {
  onAddChaos: (cards: CardInput[]) => void;
  onAddKnowledge: (cards: CardInput[]) => void;
}) {
  const [text, setText] = useState("");
  const [type, setType] = useState<"chaos" | "knowledge">("knowledge");

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
    <div className="bg-gray-900 rounded-xl p-4">
      <p className="text-sm font-semibold text-gray-300 mb-2">Bulk Add (one per line)</p>
      <div className="flex gap-2 mb-2">
        <button
          onClick={() => setType("chaos")}
          className={`px-3 py-1 text-xs rounded transition-colors ${
            type === "chaos"
              ? "bg-red-600 text-white"
              : "bg-gray-800 text-gray-400 hover:text-white"
          }`}
        >
          Chaos
        </button>
        <button
          onClick={() => setType("knowledge")}
          className={`px-3 py-1 text-xs rounded transition-colors ${
            type === "knowledge"
              ? "bg-purple-600 text-white"
              : "bg-gray-800 text-gray-400 hover:text-white"
          }`}
        >
          Knowledge
        </button>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
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
  );
}

function AIGenerate({
  onGenerated,
}: {
  onGenerated: (
    chaos: CardInput[],
    knowledge: CardInput[]
  ) => void;
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
    <div className="bg-gradient-to-r from-purple-900/40 to-blue-900/40 rounded-xl p-5 border border-purple-500/40">
      <p className="text-lg font-bold text-purple-200 mb-1">
        AI Card Generator
      </p>
      <p className="text-gray-300 text-sm mb-4">
        Describe a theme and AI will generate all your cards automatically
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
