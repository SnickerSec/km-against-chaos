"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuthStore } from "@/lib/auth";
import { fetchAdminSettings, updateAdminSetting, fetchModels, ModelInfo } from "@/lib/api";
import GoogleSignIn from "@/components/GoogleSignIn";

type AiProvider = "anthropic" | "openai" | "deepseek" | "gemini";

const PROVIDERS: { value: AiProvider; label: string; envVar: string }[] = [
  { value: "anthropic", label: "Anthropic (Claude)", envVar: "ANTHROPIC_API_KEY" },
  { value: "openai", label: "OpenAI (ChatGPT)", envVar: "OPENAI_API_KEY" },
  { value: "deepseek", label: "DeepSeek", envVar: "DEEPSEEK_API_KEY" },
  { value: "gemini", label: "Google (Gemini)", envVar: "GEMINI_API_KEY" },
];

const RAILWAY_VARS_URL = "https://railway.com/project/fbd7e636-3d48-41ac-8f03-c19ba6acee7a/service/2d32eef1-13de-4cff-b6d3-17d900210555/variables?environmentId=fc67dbc0-1395-4790-9672-97548a47b1e0";

interface AiSettings {
  provider: AiProvider;
  model: string;
  maxTokens: number;
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
  const [defaultChaosCount, setDefaultChaosCount] = useState(10);
  const [defaultKnowledgeCount, setDefaultKnowledgeCount] = useState(25);

  // Dynamic models from OpenRouter
  const [allModels, setAllModels] = useState<ModelInfo[]>([]);
  const [modelSearch, setModelSearch] = useState("");

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

    Promise.all([fetchAdminSettings(), fetchModels().catch(() => [])])
      .then(([settings, models]) => {
        setAllModels(models);

        if (settings.ai) {
          const ai = settings.ai as AiSettings;
          if (ai.provider) setProvider(ai.provider);
          if (ai.model) {
            setModel(ai.model);
            const found = models.some((m) => m.id === ai.model);
            if (!found && ai.model) {
              setUseCustomModel(true);
              setCustomModel(ai.model);
            }
          }
          if (ai.maxTokens) setMaxTokens(ai.maxTokens);
          if (ai.defaultChaosCount) setDefaultChaosCount(ai.defaultChaosCount);
          if (ai.defaultKnowledgeCount) setDefaultKnowledgeCount(ai.defaultKnowledgeCount);
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [user, isAdmin]);

  // Filter models by selected provider
  const providerPrefixes = useMemo(() => {
    const map: Record<AiProvider, string[]> = {
      anthropic: ["anthropic"],
      openai: ["openai"],
      deepseek: ["deepseek"],
      gemini: ["google"],
    };
    return map[provider] || [];
  }, [provider]);

  const filteredModels = useMemo(() => {
    let models = allModels.filter((m) =>
      providerPrefixes.some((prefix) => m.provider === prefix)
    );
    if (modelSearch.trim()) {
      const q = modelSearch.toLowerCase();
      models = models.filter(
        (m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q)
      );
    }
    return models;
  }, [allModels, providerPrefixes, modelSearch]);

  const handleProviderChange = (newProvider: AiProvider) => {
    setProvider(newProvider);
    setUseCustomModel(false);
    setCustomModel("");
    setModelSearch("");
    const prefix = { anthropic: "anthropic", openai: "openai", deepseek: "deepseek", gemini: "google" }[newProvider];
    const first = allModels.find((m) => m.provider === prefix);
    if (first) setModel(first.id);
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

  if (authLoading || !user || !isAdmin) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-400">Loading...</p>
      </div>
    );
  }

  const currentProviderInfo = PROVIDERS.find((p) => p.value === provider);

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
        {/* API Keys info */}
        <div className="bg-gray-900 rounded-xl p-6">
          <h2 className="text-xl font-semibold mb-2">API Keys</h2>
          <p className="text-gray-400 text-sm mb-3">
            API keys are managed as environment variables on Railway. Set the key for the provider you want to use:
          </p>
          <div className="bg-gray-800 rounded-lg p-3 mb-4">
            <ul className="text-sm text-gray-300 space-y-1 font-mono">
              {PROVIDERS.map((p) => (
                <li key={p.value}>
                  <span className="text-gray-500">{p.label}:</span>{" "}
                  <span className="text-purple-300">{p.envVar}</span>
                </li>
              ))}
            </ul>
          </div>
          <a
            href={RAILWAY_VARS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg font-semibold text-sm transition-colors"
          >
            Manage on Railway
            <span className="text-purple-300">&#x2197;</span>
          </a>
        </div>

        {/* AI Settings */}
        <div className="bg-gray-900 rounded-xl p-6">
          <h2 className="text-xl font-semibold mb-2">AI Card Generation</h2>
          <p className="text-gray-400 text-sm mb-5">
            Configure the AI provider and model used when users generate cards for new decks.
            Prompts are built automatically based on the game type, pack type, and user theme.
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
                <p className="text-gray-500 text-xs mt-1">
                  Requires <code className="text-gray-400">{currentProviderInfo?.envVar}</code> to be set on Railway
                </p>
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
                    {useCustomModel ? "Browse models" : "Enter custom model ID"}
                  </button>
                </div>
                {useCustomModel ? (
                  <input
                    type="text"
                    value={customModel}
                    onChange={(e) => setCustomModel(e.target.value)}
                    placeholder="Enter model ID, e.g. anthropic/claude-sonnet-4"
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-purple-500"
                  />
                ) : (
                  <>
                    {allModels.length > 0 && (
                      <input
                        type="text"
                        value={modelSearch}
                        onChange={(e) => setModelSearch(e.target.value)}
                        placeholder="Search models..."
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm mb-2 focus:outline-none focus:border-purple-500"
                      />
                    )}
                    <select
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      size={Math.min(filteredModels.length, 8)}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1 text-sm focus:outline-none focus:border-purple-500"
                    >
                      {filteredModels.length > 0 ? (
                        filteredModels.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name} ({m.id})
                          </option>
                        ))
                      ) : (
                        <option disabled>
                          {allModels.length === 0 ? "Loading models..." : "No models match"}
                        </option>
                      )}
                    </select>
                    <p className="text-gray-500 text-xs mt-1">
                      {filteredModels.length} models available from {providerPrefixes.join(", ")}
                    </p>
                  </>
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
