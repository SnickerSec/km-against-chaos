"use client";

import { useEffect, useState, useMemo } from "react";
import { Icon } from "@iconify/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuthStore, getAuthHeaders } from "@/lib/auth";
import { fetchAdminSettings, updateAdminSetting, fetchModels, fetchApiKeysStatus, testProvider, ModelInfo } from "@/lib/api";
import GoogleSignIn from "@/components/GoogleSignIn";

const API_URL =
  process.env.NEXT_PUBLIC_SERVER_URL ||
  (typeof window !== "undefined" && window.location.hostname !== "localhost"
    ? ""
    : "http://localhost:3001");

interface UserRow {
  id: string;
  name: string;
  email: string;
  picture: string | null;
  role: string | null;
}

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

  // Dynamic models from OpenRouter
  const [allModels, setAllModels] = useState<ModelInfo[]>([]);
  const [modelSearch, setModelSearch] = useState("");

  // API key status per provider
  const [keyStatus, setKeyStatus] = useState<Record<string, boolean>>({});
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // User roles management
  const [users, setUsers] = useState<UserRow[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [roleStatus, setRoleStatus] = useState<Record<string, { success?: boolean; error?: string }>>({});

  // Deck featured management
  const [adminDecks, setAdminDecks] = useState<{ id: string; name: string; builtIn: boolean; ownerId: string | null; gameType: string; chaosCount: number; knowledgeCount: number }[]>([]);
  const [decksLoading, setDecksLoading] = useState(false);
  const [featuredStatus, setFeaturedStatus] = useState<Record<string, { success?: boolean; error?: string }>>({});

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

    // Fetch users for role management
    setUsersLoading(true);
    fetch(`${API_URL}/api/admin/users`, { headers: getAuthHeaders() })
      .then((r) => r.json())
      .then((data) => { setUsers(data); setUsersLoading(false); })
      .catch((e) => { setUsersError(e.message); setUsersLoading(false); });

    // Fetch decks for featured management
    setDecksLoading(true);
    fetch(`${API_URL}/api/admin/decks`, { headers: getAuthHeaders() })
      .then((r) => r.json())
      .then((data) => { setAdminDecks(data); setDecksLoading(false); })
      .catch(() => setDecksLoading(false));
  }, [user, isAdmin]);

  useEffect(() => {
    if (!user || !isAdmin) return;

    Promise.all([fetchAdminSettings(), fetchModels().catch(() => []), fetchApiKeysStatus().catch(() => ({}))])
      .then(([settings, models, keys]) => {
        setKeyStatus(keys);
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

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testProvider(provider, effectiveModel);
      if (result.success) {
        setTestResult({ success: true, message: `Connected — response: ${result.response}` });
      } else {
        setTestResult({ success: false, message: result.error || "Connection failed" });
      }
    } catch (e: any) {
      setTestResult({ success: false, message: e.message });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await updateAdminSetting("ai", {
        provider,
        model: effectiveModel,
        maxTokens,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleRoleChange = async (userId: string, newRole: string) => {
    const role = newRole === "" ? null : newRole;
    setRoleStatus((prev) => ({ ...prev, [userId]: {} }));
    try {
      const res = await fetch(`${API_URL}/api/admin/users/${userId}/role`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ role }),
      });
      if (!res.ok) {
        const data = await res.json();
        setRoleStatus((prev) => ({ ...prev, [userId]: { error: data.error || "Failed" } }));
        return;
      }
      const updated: UserRow = await res.json();
      setUsers((prev) => prev.map((u) => (u.id === userId ? updated : u)));
      setRoleStatus((prev) => ({ ...prev, [userId]: { success: true } }));
      setTimeout(() => setRoleStatus((prev) => ({ ...prev, [userId]: {} })), 2000);
    } catch (e: any) {
      setRoleStatus((prev) => ({ ...prev, [userId]: { error: e.message } }));
    }
  };

  const handleToggleFeatured = async (deckId: string, featured: boolean) => {
    setFeaturedStatus((prev) => ({ ...prev, [deckId]: {} }));
    try {
      const res = await fetch(`${API_URL}/api/admin/decks/${deckId}/featured`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ featured }),
      });
      if (!res.ok) {
        const data = await res.json();
        setFeaturedStatus((prev) => ({ ...prev, [deckId]: { error: data.error || "Failed" } }));
        return;
      }
      setAdminDecks((prev) => prev.map((d) => d.id === deckId ? { ...d, builtIn: featured } : d));
      setFeaturedStatus((prev) => ({ ...prev, [deckId]: { success: true } }));
      setTimeout(() => setFeaturedStatus((prev) => ({ ...prev, [deckId]: {} })), 2000);
    } catch (e: any) {
      setFeaturedStatus((prev) => ({ ...prev, [deckId]: { error: e.message } }));
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
            API keys are managed as environment variables on Railway.
          </p>
          <div className="bg-gray-800 rounded-lg p-3 mb-4">
            <ul className="text-sm space-y-2">
              {PROVIDERS.map((p) => (
                <li key={p.value} className="flex items-center gap-2">
                  {keyStatus[p.value] ? (
                    <span className="text-green-400 text-xs">●</span>
                  ) : (
                    <span className="text-gray-600 text-xs">●</span>
                  )}
                  <span className="text-gray-300">{p.label}</span>
                  <code className="text-purple-300 text-xs">{p.envVar}</code>
                  {keyStatus[p.value] ? (
                    <span className="text-green-400 text-xs ml-auto">configured</span>
                  ) : (
                    <span className="text-gray-600 text-xs ml-auto">not set</span>
                  )}
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
            <Icon icon="mdi:open-in-new" className="text-purple-300" width={16} />
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
                  onChange={(e) => { handleProviderChange(e.target.value as AiProvider); setTestResult(null); }}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500"
                >
                  {PROVIDERS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label} {keyStatus[p.value] ? "●" : ""}
                    </option>
                  ))}
                </select>
                {keyStatus[provider] ? (
                  <p className="text-green-400 text-xs mt-1">
                    <code className="text-green-300">{currentProviderInfo?.envVar}</code> is configured
                  </p>
                ) : (
                  <p className="text-yellow-400 text-xs mt-1">
                    <code className="text-yellow-300">{currentProviderInfo?.envVar}</code> is not set —{" "}
                    <a href={RAILWAY_VARS_URL} target="_blank" rel="noopener noreferrer" className="underline hover:text-yellow-200">
                      add it on Railway
                    </a>
                  </p>
                )}
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

              {/* Test & Save */}
              <div className="space-y-3">
                {keyStatus[provider] && (
                  <div>
                    <button
                      onClick={handleTest}
                      disabled={testing || !effectiveModel}
                      className="px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded-lg font-semibold text-sm transition-colors"
                    >
                      {testing ? "Testing..." : "Test Connection"}
                    </button>
                    {testResult && (
                      <span className={`text-sm ml-3 ${testResult.success ? "text-green-400" : "text-red-400"}`}>
                        {testResult.message}
                      </span>
                    )}
                  </div>
                )}
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
            </div>
          )}
        </div>
        {/* User Roles */}
        <div className="bg-gray-900 rounded-xl p-6">
          <h2 className="text-xl font-semibold mb-2">User Roles</h2>
          <p className="text-gray-400 text-sm mb-5">
            Assign moderator or admin roles to users. Moderators can edit and delete any deck. Admins have full access including this page.
          </p>

          {usersLoading && <p className="text-gray-400 text-sm">Loading users...</p>}
          {usersError && <p className="text-red-400 text-sm">{usersError}</p>}

          {!usersLoading && users.length > 0 && (
            <div className="space-y-2">
              {users.map((u) => (
                <div key={u.id} className="flex items-center gap-3 bg-gray-800 rounded-lg px-4 py-3">
                  {u.picture ? (
                    <img src={u.picture} alt={u.name} className="w-8 h-8 rounded-full flex-shrink-0" />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-gray-600 flex-shrink-0 flex items-center justify-center text-gray-300 text-xs font-bold">
                      {u.name.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">{u.name}</p>
                    <p className="text-xs text-gray-400 truncate">{u.email}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <select
                      value={u.role ?? ""}
                      onChange={(e) => handleRoleChange(u.id, e.target.value)}
                      className="bg-gray-700 border border-gray-600 rounded-lg px-2 py-1 text-sm focus:outline-none focus:border-purple-500 text-white"
                    >
                      <option value="">None</option>
                      <option value="moderator">Moderator</option>
                      <option value="admin">Admin</option>
                    </select>
                    {roleStatus[u.id]?.success && (
                      <span className="text-green-400 text-xs">Saved</span>
                    )}
                    {roleStatus[u.id]?.error && (
                      <span className="text-red-400 text-xs">{roleStatus[u.id].error}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {!usersLoading && users.length === 0 && !usersError && (
            <p className="text-gray-500 text-sm">No users found.</p>
          )}
        </div>

        {/* Featured Decks */}
        <div className="bg-gray-900 rounded-xl p-6">
          <h2 className="text-xl font-semibold mb-2">Featured Decks</h2>
          <p className="text-gray-400 text-sm mb-5">
            Toggle which decks appear in the Featured section on the home page.
          </p>

          {decksLoading && <p className="text-gray-400 text-sm">Loading decks...</p>}

          {!decksLoading && adminDecks.length > 0 && (
            <div className="space-y-2">
              {adminDecks.map((d) => (
                <div key={d.id} className="flex items-center gap-3 bg-gray-800 rounded-lg px-4 py-3">
                  <button
                    onClick={() => handleToggleFeatured(d.id, !d.builtIn)}
                    className={`w-10 h-6 rounded-full relative transition-colors flex-shrink-0 ${
                      d.builtIn ? "bg-purple-600" : "bg-gray-600"
                    }`}
                  >
                    <span className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                      d.builtIn ? "left-5" : "left-1"
                    }`} />
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-white truncate">{d.name}</p>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                        d.gameType === "joking_hazard"
                          ? "bg-orange-600/30 text-orange-300"
                          : "bg-red-600/30 text-red-300"
                      }`}>
                        {d.gameType === "joking_hazard" ? "JH" : "CAH"}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500">{d.chaosCount} prompts · {d.knowledgeCount} answers</p>
                  </div>
                  <div className="flex-shrink-0">
                    {featuredStatus[d.id]?.success && (
                      <span className="text-green-400 text-xs">Saved</span>
                    )}
                    {featuredStatus[d.id]?.error && (
                      <span className="text-red-400 text-xs">{featuredStatus[d.id].error}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {!decksLoading && adminDecks.length === 0 && (
            <p className="text-gray-500 text-sm">No decks found.</p>
          )}
        </div>
      </div>
    </div>
  );
}
