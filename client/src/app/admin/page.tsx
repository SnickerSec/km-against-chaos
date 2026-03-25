"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuthStore } from "@/lib/auth";
import { fetchAdminSettings, updateAdminSetting } from "@/lib/api";
import GoogleSignIn from "@/components/GoogleSignIn";

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

const MODELS = [
  "claude-sonnet-4-20250514",
  "claude-haiku-4-5-20251001",
  "claude-opus-4-20250514",
];

interface AiSettings {
  model: string;
  maxTokens: number;
  prompt: string;
  defaultChaosCount: number;
  defaultKnowledgeCount: number;
}

export default function AdminPage() {
  const router = useRouter();
  const { user, isAdmin, loading: authLoading, restore } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [model, setModel] = useState("claude-sonnet-4-20250514");
  const [maxTokens, setMaxTokens] = useState(2048);
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [defaultChaosCount, setDefaultChaosCount] = useState(10);
  const [defaultKnowledgeCount, setDefaultKnowledgeCount] = useState(25);

  useEffect(() => {
    restore();
  }, [restore]);

  useEffect(() => {
    if (!authLoading && (!user || !isAdmin)) {
      router.replace("/");
    }
  }, [authLoading, user, isAdmin, router]);

  useEffect(() => {
    if (!user || !isAdmin) return;
    fetchAdminSettings()
      .then((settings) => {
        if (settings.ai) {
          const ai = settings.ai as AiSettings;
          if (ai.model) setModel(ai.model);
          if (ai.maxTokens) setMaxTokens(ai.maxTokens);
          if (ai.prompt) setPrompt(ai.prompt);
          if (ai.defaultChaosCount) setDefaultChaosCount(ai.defaultChaosCount);
          if (ai.defaultKnowledgeCount) setDefaultKnowledgeCount(ai.defaultKnowledgeCount);
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [user, isAdmin]);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await updateAdminSetting("ai", {
        model,
        maxTokens,
        prompt,
        defaultChaosCount,
        defaultKnowledgeCount,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleResetPrompt = () => {
    setPrompt(DEFAULT_PROMPT);
  };

  if (authLoading || !user || !isAdmin) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-400">Loading...</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold">Admin</h1>
          <p className="text-gray-400 text-sm mt-1">Platform settings</p>
        </div>
        <div className="flex items-center gap-4">
          <GoogleSignIn />
          <Link href="/" className="text-gray-400 hover:text-white text-sm">
            Back to Decked
          </Link>
        </div>
      </div>

      {/* AI Settings */}
      <div className="bg-gray-900 rounded-xl p-6">
        <h2 className="text-xl font-semibold mb-4">AI Card Generation</h2>
        <p className="text-gray-400 text-sm mb-6">
          Configure the AI model and prompt used when users generate cards for new decks.
          Use {"{{theme}}"}, {"{{chaosCount}}"}, and {"{{knowledgeCount}}"} as placeholders in the prompt.
        </p>

        {loading ? (
          <p className="text-gray-400">Loading settings...</p>
        ) : (
          <div className="space-y-5">
            {/* Model */}
            <div>
              <label className="block text-sm font-medium mb-1">Model</label>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500"
              >
                {MODELS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>

            {/* Max Tokens */}
            <div>
              <label className="block text-sm font-medium mb-1">Max Tokens</label>
              <input
                type="number"
                value={maxTokens}
                onChange={(e) => setMaxTokens(parseInt(e.target.value) || 2048)}
                min={256}
                max={8192}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500"
              />
              <p className="text-gray-500 text-xs mt-1">Max response length (256–8192)</p>
            </div>

            {/* Default Counts */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Default Chaos Cards</label>
                <input
                  type="number"
                  value={defaultChaosCount}
                  onChange={(e) => setDefaultChaosCount(parseInt(e.target.value) || 10)}
                  min={5}
                  max={50}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Default Knowledge Cards</label>
                <input
                  type="number"
                  value={defaultKnowledgeCount}
                  onChange={(e) => setDefaultKnowledgeCount(parseInt(e.target.value) || 25)}
                  min={15}
                  max={100}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500"
                />
              </div>
            </div>

            {/* Prompt */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm font-medium">Generation Prompt</label>
                <button
                  onClick={handleResetPrompt}
                  className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
                >
                  Reset to default
                </button>
              </div>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={14}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-purple-500 resize-y"
              />
              <p className="text-gray-500 text-xs mt-1">
                Available placeholders: {"{{theme}}"}, {"{{chaosCount}}"}, {"{{knowledgeCount}}"}
              </p>
            </div>

            {/* Save */}
            <div className="flex items-center gap-3">
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-5 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 rounded-lg font-semibold text-sm transition-colors"
              >
                {saving ? "Saving..." : "Save Settings"}
              </button>
              {saved && <span className="text-green-400 text-sm">Settings saved</span>}
              {error && <span className="text-red-400 text-sm">{error}</span>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
