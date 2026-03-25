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

type AiProvider = "anthropic" | "openai" | "deepseek" | "gemini";

const PROVIDERS: { value: AiProvider; label: string }[] = [
  { value: "anthropic", label: "Anthropic (Claude)" },
  { value: "openai", label: "OpenAI (ChatGPT)" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "gemini", label: "Google (Gemini)" },
];

const MODELS_BY_PROVIDER: Record<AiProvider, string[]> = {
  anthropic: [
    "claude-sonnet-4-20250514",
    "claude-haiku-4-5-20251001",
    "claude-opus-4-20250514",
  ],
  openai: [
    "gpt-4o",
    "gpt-4o-mini",
    "gpt-4.1",
    "gpt-4.1-mini",
    "gpt-4.1-nano",
    "o3-mini",
  ],
  deepseek: [
    "deepseek-chat",
    "deepseek-reasoner",
  ],
  gemini: [
    "gemini-2.5-flash-preview-05-20",
    "gemini-2.5-pro-preview-05-06",
    "gemini-2.0-flash",
    "gemini-2.0-flash-lite",
  ],
};

const DEFAULT_MODEL: Record<AiProvider, string> = {
  anthropic: "claude-sonnet-4-20250514",
  openai: "gpt-4o",
  deepseek: "deepseek-chat",
  gemini: "gemini-2.0-flash",
};

interface AiSettings {
  provider: AiProvider;
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

  const [provider, setProvider] = useState<AiProvider>("anthropic");
  const [model, setModel] = useState("claude-sonnet-4-20250514");
  const [useCustomModel, setUseCustomModel] = useState(false);
  const [customModel, setCustomModel] = useState("");
  const [maxTokens, setMaxTokens] = useState(2048);
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [defaultChaosCount, setDefaultChaosCount] = useState(10);
  const [defaultKnowledgeCount, setDefaultKnowledgeCount] = useState(25);

  // API keys per provider
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({
    anthropic: "",
    openai: "",
    deepseek: "",
    gemini: "",
  });
  const [savingKeys, setSavingKeys] = useState(false);
  const [savedKeys, setSavedKeys] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);

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
          if (ai.provider) setProvider(ai.provider);
          if (ai.model) {
            // Check if model is in the preset list
            const presets = MODELS_BY_PROVIDER[ai.provider || "anthropic"];
            if (presets.includes(ai.model)) {
              setModel(ai.model);
              setUseCustomModel(false);
            } else {
              setCustomModel(ai.model);
              setUseCustomModel(true);
              setModel(presets[0]);
            }
          }
          if (ai.maxTokens) setMaxTokens(ai.maxTokens);
          if (ai.prompt) setPrompt(ai.prompt);
          if (ai.defaultChaosCount) setDefaultChaosCount(ai.defaultChaosCount);
          if (ai.defaultKnowledgeCount) setDefaultKnowledgeCount(ai.defaultKnowledgeCount);
        }
        if (settings.api_keys) {
          setApiKeys((prev) => ({ ...prev, ...settings.api_keys }));
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [user, isAdmin]);

  const handleProviderChange = (newProvider: AiProvider) => {
    setProvider(newProvider);
    setModel(DEFAULT_MODEL[newProvider]);
    setUseCustomModel(false);
    setCustomModel("");
  };

  const effectiveModel = useCustomModel ? customModel : model;

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await updateAdminSetting("ai", {
        provider,
        model: effectiveModel,
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

  const handleSaveKeys = async () => {
    setSavingKeys(true);
    setSavedKeys(false);
    setKeyError(null);
    try {
      await updateAdminSetting("api_keys", apiKeys);
      setSavedKeys(true);
      setTimeout(() => setSavedKeys(false), 3000);
    } catch (e: any) {
      setKeyError(e.message);
    } finally {
      setSavingKeys(false);
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

      <div className="space-y-6">
        {/* API Keys */}
        <div className="bg-gray-900 rounded-xl p-6">
          <h2 className="text-xl font-semibold mb-2">API Keys</h2>
          <p className="text-gray-400 text-sm mb-5">
            Set API keys for each provider. Keys set here override environment variables.
            Existing keys are masked — enter a new value to replace.
          </p>

          {loading ? (
            <p className="text-gray-400">Loading...</p>
          ) : (
            <div className="space-y-4">
              {PROVIDERS.map((p) => (
                <div key={p.value}>
                  <label className="block text-sm font-medium mb-1">{p.label}</label>
                  <input
                    type="text"
                    value={apiKeys[p.value] || ""}
                    onChange={(e) =>
                      setApiKeys((prev) => ({ ...prev, [p.value]: e.target.value }))
                    }
                    placeholder="Paste API key here..."
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-purple-500"
                  />
                </div>
              ))}

              <div className="flex items-center gap-3">
                <button
                  onClick={handleSaveKeys}
                  disabled={savingKeys}
                  className="px-5 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 rounded-lg font-semibold text-sm transition-colors"
                >
                  {savingKeys ? "Saving..." : "Save Keys"}
                </button>
                {savedKeys && <span className="text-green-400 text-sm">Keys saved</span>}
                {keyError && <span className="text-red-400 text-sm">{keyError}</span>}
              </div>
            </div>
          )}
        </div>

        {/* AI Settings */}
        <div className="bg-gray-900 rounded-xl p-6">
          <h2 className="text-xl font-semibold mb-2">AI Card Generation</h2>
          <p className="text-gray-400 text-sm mb-5">
            Configure the AI provider, model, and prompt used when users generate cards for new decks.
            Use {"{{theme}}"}, {"{{chaosCount}}"}, and {"{{knowledgeCount}}"} as placeholders in the prompt.
          </p>

          {loading ? (
            <p className="text-gray-400">Loading settings...</p>
          ) : (
            <div className="space-y-5">
              {/* Provider */}
              <div>
                <label className="block text-sm font-medium mb-1">Provider</label>
                <select
                  value={provider}
                  onChange={(e) => handleProviderChange(e.target.value as AiProvider)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500"
                >
                  {PROVIDERS.map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
              </div>

              {/* Model */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-sm font-medium">Model</label>
                  <button
                    type="button"
                    onClick={() => {
                      setUseCustomModel(!useCustomModel);
                      if (!useCustomModel) setCustomModel(model);
                    }}
                    className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
                  >
                    {useCustomModel ? "Use preset" : "Use custom model"}
                  </button>
                </div>
                {useCustomModel ? (
                  <input
                    type="text"
                    value={customModel}
                    onChange={(e) => setCustomModel(e.target.value)}
                    placeholder="Enter model name, e.g. gpt-4o-2024-08-06"
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-purple-500"
                  />
                ) : (
                  <select
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500"
                  >
                    {MODELS_BY_PROVIDER[provider].map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                )}
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
    </div>
  );
}
