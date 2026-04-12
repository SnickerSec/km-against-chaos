import { getAuthHeaders } from "./auth";

export const API_URL = process.env.NEXT_PUBLIC_SERVER_URL || (typeof window !== "undefined" && window.location.hostname !== "localhost" ? "" : "http://localhost:3001");

export interface WinCondition {
  mode: "rounds" | "points" | "single_round" | "lowest_score";
  value: number;
}

export interface DeckSummary {
  id: string;
  name: string;
  description: string;
  chaosCount: number;
  knowledgeCount: number;
  winCondition: WinCondition;
  builtIn?: boolean;
  ownerId?: string | null;
  ownerName?: string | null;
  maturity?: string;
  flavorThemes?: string[];
  chaosLevel?: number;
  wildcard?: string;
  remixedFrom?: string | null;
  gameType?: string;
  playCount?: number;
  avgRating?: number;
  artTier?: string;
  artGenerationStatus?: string | null;
}

export interface CustomDeck {
  id: string;
  name: string;
  description: string;
  chaosCards: { id: string; text: string; pick: number; metaType?: string; metaEffect?: any; imageUrl?: string }[];
  knowledgeCards: { id: string; text: string; bonus?: boolean; imageUrl?: string }[];
  winCondition: WinCondition;
  createdAt: string;
  updatedAt: string;
  ownerId?: string | null;
  maturity?: string;
  flavorThemes?: string[];
  chaosLevel?: number;
  wildcard?: string;
  remixedFrom?: string | null;
  gameType?: string;
  artTier?: string;
  artGenerationStatus?: string | null;
  artStyle?: string | null;
  cardBackUrl?: string | null;
  packs?: { type: string; name: string; description: string; chaosCards: { text: string; pick?: number }[]; knowledgeCards: { text: string; bonus?: boolean }[] }[];
}

export interface DeckExport {
  name: string;
  description: string;
  chaosCards: { text: string; pick?: number; metaType?: string; metaEffect?: any }[];
  knowledgeCards: { text: string }[];
  winCondition?: WinCondition;
  packs?: { type: string; name: string; description: string; chaosCards: { text: string; pick?: number }[]; knowledgeCards: { text: string }[] }[];
  maturity?: string;
  flavorThemes?: string[];
  chaosLevel?: number;
  wildcard?: string;
  remixedFrom?: string;
}

export interface PackSummary {
  id: string;
  deckId: string | null;
  deckName: string;
  type: string;
  name: string;
  description: string;
  chaosCount: number;
  knowledgeCount: number;
  ownerId: string | null;
  builtIn: boolean;
  gameType: string | null;
}

export async function fetchDecks(options?: { search?: string; gameType?: string; sort?: string; maturity?: string }): Promise<DeckSummary[]> {
  const params = new URLSearchParams();
  if (options?.search) params.set("search", options.search);
  if (options?.gameType) params.set("gameType", options.gameType);
  if (options?.sort) params.set("sort", options.sort);
  if (options?.maturity) params.set("maturity", options.maturity);
  const qs = params.toString();
  const res = await fetch(`${API_URL}/api/decks${qs ? `?${qs}` : ""}`);
  if (!res.ok) throw new Error("Failed to fetch decks");
  return res.json();
}

export async function rateDeck(deckId: string, rating: number) {
  const res = await fetch(`${API_URL}/api/decks/${deckId}/rate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify({ rating }),
  });
  if (!res.ok) throw new Error("Failed to rate deck");
  return res.json();
}

export async function fetchDeck(id: string): Promise<CustomDeck> {
  const res = await fetch(`${API_URL}/api/decks/${id}`);
  if (!res.ok) throw new Error("Deck not found");
  return res.json();
}

export async function createDeck(data: DeckExport): Promise<CustomDeck> {
  const res = await fetch(`${API_URL}/api/decks`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || "Failed to create deck");
  }
  return res.json();
}

export async function updateDeck(
  id: string,
  data: Partial<DeckExport>
): Promise<CustomDeck> {
  const res = await fetch(`${API_URL}/api/decks/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || "Failed to update deck");
  }
  return res.json();
}

export async function uploadDeckCardBack(id: string, file: File): Promise<{ cardBackUrl: string }> {
  const res = await fetch(`${API_URL}/api/decks/${id}/card-back`, {
    method: "POST",
    headers: { "Content-Type": file.type, ...getAuthHeaders() },
    body: file,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to upload card back");
  }
  return res.json();
}

export async function deleteDeckCardBack(id: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/decks/${id}/card-back`, {
    method: "DELETE",
    headers: { ...getAuthHeaders() },
  });
  if (!res.ok) throw new Error("Failed to remove card back");
}

export async function deleteDeck(id: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/decks/${id}`, {
    method: "DELETE",
    headers: { ...getAuthHeaders() },
  });
  if (!res.ok) throw new Error("Failed to delete deck");
}

export interface GeneratedCards {
  name?: string;
  description?: string;
  chaosCards: { text: string; pick: number }[];
  knowledgeCards: { text: string }[];
}

export interface GeneratedDeck {
  id: string;
  name: string;
  description: string;
  chaosCards: { text: string; pick: number }[];
  knowledgeCards: { text: string }[];
}

export interface GenerateContext {
  theme: string;
  gameType: string;
  packType?: string;
  packName?: string;
  deckName?: string;
  deckDescription?: string;
  chaosCount?: number;
  knowledgeCount?: number;
  // 4-Pillar fields
  maturity?: string;
  flavorThemes?: string[];
  chaosLevel?: number;
  wildcard?: string;
  draftId?: string;
}

export async function generateDeckAI(ctx: GenerateContext): Promise<GeneratedDeck> {
  const res = await fetch(`${API_URL}/api/decks/generate-deck`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify(ctx),
  });
  if (!res.ok) {
    try {
      const err = await res.json();
      throw new Error(err.error || "Failed to generate deck");
    } catch {
      throw new Error(res.status >= 500 ? "Generation timed out — try fewer cards or a simpler theme." : "Failed to generate deck");
    }
  }
  return res.json();
}

export async function generateCardsAI(ctx: GenerateContext): Promise<GeneratedCards> {
  const res = await fetch(`${API_URL}/api/decks/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify(ctx),
  });
  if (!res.ok) {
    try {
      const err = await res.json();
      throw new Error(err.error || "Failed to generate cards");
    } catch {
      throw new Error(res.status >= 500 ? "Generation timed out — try fewer cards." : "Failed to generate cards");
    }
  }
  return res.json();
}

export async function fetchPacks(type?: string): Promise<PackSummary[]> {
  const url = type ? `${API_URL}/api/packs?type=${type}` : `${API_URL}/api/packs`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to fetch packs");
  return res.json();
}

export async function createDeckFromPacks(data: { packIds: string[]; name: string; winCondition?: { mode: string; value: number } }): Promise<CustomDeck> {
  const res = await fetch(`${API_URL}/api/decks/from-packs`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || "Failed to create deck");
  }
  return res.json();
}

export async function remixDeck(sourceId: string): Promise<CustomDeck> {
  const res = await fetch(`${API_URL}/api/decks/${sourceId}/remix`, {
    method: "POST",
    headers: { ...getAuthHeaders() },
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || "Failed to remix deck");
  }
  return res.json();
}

export async function importDeck(data: DeckExport): Promise<CustomDeck> {
  const res = await fetch(`${API_URL}/api/decks/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || "Failed to import deck");
  }
  return res.json();
}

// Stats API

export async function fetchMyStats() {
  const res = await fetch(`${API_URL}/api/stats/me`, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error("Failed to fetch stats");
  return res.json();
}

export async function fetchGameHistory(page = 1, limit = 20) {
  const res = await fetch(`${API_URL}/api/stats/history?page=${page}&limit=${limit}`, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error("Failed to fetch game history");
  return res.json();
}

export async function fetchLeaderboard(gameType?: string) {
  const params = gameType ? `?gameType=${gameType}` : '';
  const res = await fetch(`${API_URL}/api/stats/leaderboard${params}`);
  if (!res.ok) throw new Error("Failed to fetch leaderboard");
  return res.json();
}

// Friends API

export async function fetchFriends() {
  const res = await fetch(`${API_URL}/api/friends`, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error("Failed to fetch friends");
  return res.json();
}

export async function searchUsers(query: string) {
  const res = await fetch(`${API_URL}/api/users/search?q=${encodeURIComponent(query)}`, { headers: getAuthHeaders() });
  if (!res.ok) return [];
  return res.json();
}

export async function sendFriendRequest(emailOrUserId: string, isUserId = false) {
  const res = await fetch(`${API_URL}/api/friends/request`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify(isUserId ? { userId: emailOrUserId } : { email: emailOrUserId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to send request");
  return data;
}

export async function acceptFriendRequest(friendshipId: string) {
  const res = await fetch(`${API_URL}/api/friends/${friendshipId}/accept`, {
    method: "POST",
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to accept");
  return res.json();
}

export async function removeFriend(friendshipId: string) {
  const res = await fetch(`${API_URL}/api/friends/${friendshipId}`, {
    method: "DELETE",
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to remove");
  return res.json();
}

// Friend Nicknames
export async function setFriendNickname(friendshipId: string, nickname: string) {
  const res = await fetch(`${API_URL}/api/friends/${friendshipId}/nickname`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify({ nickname }),
  });
  if (!res.ok) throw new Error("Failed to set nickname");
  return res.json();
}

// Game History Between Friends
export async function fetchFriendHistory(friendId: string) {
  const res = await fetch(`${API_URL}/api/friends/${friendId}/history`, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error("Failed to fetch history");
  return res.json();
}

// Friends Activity Feed
export async function fetchFriendsFeed() {
  const res = await fetch(`${API_URL}/api/friends/feed`, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error("Failed to fetch feed");
  return res.json();
}

// Friends Leaderboard
export async function fetchFriendsLeaderboard() {
  const res = await fetch(`${API_URL}/api/friends/leaderboard`, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error("Failed to fetch leaderboard");
  return res.json();
}

// Mutual Friends
export async function fetchMutualFriends(userId: string) {
  const res = await fetch(`${API_URL}/api/users/${userId}/mutual-friends`, { headers: getAuthHeaders() });
  if (!res.ok) return [];
  return res.json();
}

// Friend Suggestions
export async function fetchFriendSuggestions() {
  const res = await fetch(`${API_URL}/api/friends/suggestions`, { headers: getAuthHeaders() });
  if (!res.ok) return [];
  return res.json();
}

// Direct Messages
export async function fetchMessages(friendId: string, before?: string) {
  const params = before ? `?before=${encodeURIComponent(before)}` : "";
  const res = await fetch(`${API_URL}/api/friends/${friendId}/messages${params}`, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error("Failed to fetch messages");
  return res.json();
}

export async function sendMessage(friendId: string, content: string) {
  const res = await fetch(`${API_URL}/api/friends/${friendId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) throw new Error("Failed to send message");
  return res.json();
}

export async function markMessagesRead(friendId: string) {
  await fetch(`${API_URL}/api/friends/${friendId}/messages/read`, { method: "POST", headers: getAuthHeaders() });
}

// Notifications
export async function fetchNotifications(unreadOnly = false) {
  const res = await fetch(`${API_URL}/api/notifications${unreadOnly ? "?unread=true" : ""}`, { headers: getAuthHeaders() });
  if (!res.ok) return [];
  return res.json();
}

export async function markNotificationRead(id: string) {
  await fetch(`${API_URL}/api/notifications/${id}/read`, { method: "POST", headers: getAuthHeaders() });
}

export async function markAllNotificationsRead() {
  await fetch(`${API_URL}/api/notifications/read-all`, { method: "POST", headers: getAuthHeaders() });
}

// Push notifications
export async function getVapidPublicKey(): Promise<string | null> {
  try {
    const res = await fetch(`${API_URL}/api/push/vapid-key`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.publicKey || null;
  } catch { return null; }
}

export async function subscribePush(subscription: PushSubscription) {
  await fetch(`${API_URL}/api/push/subscribe`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify({ subscription: subscription.toJSON() }),
  });
}

export async function unsubscribePush(endpoint?: string) {
  await fetch(`${API_URL}/api/push/unsubscribe`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify({ endpoint }),
  });
}

// Unread DM counts
export async function fetchUnreadCounts() {
  const res = await fetch(`${API_URL}/api/friends/unread-counts`, { headers: getAuthHeaders() });
  if (!res.ok) return {};
  return res.json();
}

// Admin API

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  contextLength: number;
}

export async function fetchModels(): Promise<ModelInfo[]> {
  const res = await fetch(`${API_URL}/api/admin/models`, {
    headers: { ...getAuthHeaders() },
  });
  if (!res.ok) throw new Error("Failed to fetch models");
  return res.json();
}

export async function fetchApiKeysStatus(): Promise<Record<string, boolean>> {
  const res = await fetch(`${API_URL}/api/admin/api-keys-status`, {
    headers: { ...getAuthHeaders() },
  });
  if (!res.ok) throw new Error("Failed to fetch API key status");
  return res.json();
}

export async function testProvider(provider: string, model: string): Promise<{ success: boolean; response?: string; error?: string }> {
  const res = await fetch(`${API_URL}/api/admin/test-provider`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify({ provider, model }),
  });
  return res.json();
}

export async function fetchAdminSettings(): Promise<Record<string, any>> {
  const res = await fetch(`${API_URL}/api/admin/settings`, {
    headers: { ...getAuthHeaders() },
  });
  if (!res.ok) throw new Error("Failed to fetch settings");
  return res.json();
}

export async function updateAdminSetting(key: string, value: any): Promise<void> {
  const res = await fetch(`${API_URL}/api/admin/settings/${key}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify({ value }),
  });
  if (!res.ok) throw new Error("Failed to update setting");
}

export interface PromptTemplates {
  artStyles: Record<string, { basePrompt: string; negativePrompt: string; aspectRatio: string }>;
  imagePromptSuffix: string;
  cardEngineRules: Record<string, string>;
  cardMaturityRules: Record<string, string>;
}

export async function fetchPromptTemplates(): Promise<PromptTemplates> {
  const res = await fetch(`${API_URL}/api/admin/prompt-templates`, {
    headers: { ...getAuthHeaders() },
  });
  if (!res.ok) throw new Error("Failed to fetch prompt templates");
  return res.json();
}

export async function updatePromptTemplates(templates: PromptTemplates): Promise<void> {
  const res = await fetch(`${API_URL}/api/admin/prompt-templates`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify(templates),
  });
  if (!res.ok) throw new Error("Failed to update prompt templates");
}

export async function resetPromptTemplates(): Promise<void> {
  const res = await fetch(`${API_URL}/api/admin/prompt-templates`, {
    method: "DELETE",
    headers: { ...getAuthHeaders() },
  });
  if (!res.ok) throw new Error("Failed to reset prompt templates");
}

export interface ImageModelSettings {
  endpoint: string;
  numInferenceSteps: number;
  guidanceScale: number;
}

export interface FalModelInfo {
  id: string;
  name: string;
  description: string;
  price: string;
  tags: string[];
}

export interface ImageModelResponse {
  settings: ImageModelSettings;
  defaults: ImageModelSettings;
  models: FalModelInfo[];
  falKeyConfigured: boolean;
}

export async function fetchImageModel(): Promise<ImageModelResponse> {
  const res = await fetch(`${API_URL}/api/admin/image-model`, {
    headers: { ...getAuthHeaders() },
  });
  if (!res.ok) throw new Error("Failed to fetch image model settings");
  return res.json();
}

export async function updateImageModel(settings: Partial<ImageModelSettings>): Promise<void> {
  const res = await fetch(`${API_URL}/api/admin/image-model`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify(settings),
  });
  if (!res.ok) throw new Error("Failed to update image model settings");
}

export async function toggleFavorite(deckId: string): Promise<{ favorited: boolean }> {
  const res = await fetch(`${API_URL}/api/decks/${deckId}/favorite`, {
    method: "POST",
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to toggle favorite");
  return res.json();
}

export async function getFavorites(): Promise<string[]> {
  const res = await fetch(`${API_URL}/api/decks/user/favorites`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to fetch favorites");
  return res.json();
}

export interface ArtStyleOption {
  id: string;
  label: string;
  description: string;
  icon: string;
}

export async function getArtStyles(): Promise<ArtStyleOption[]> {
  const res = await fetch(`${API_URL}/api/art/styles`);
  if (!res.ok) return [];
  return res.json();
}

export async function generateArtPreview(
  cardText: string, gameType: string, theme: string,
  maturity?: string, flavorThemes?: string[], wildcard?: string, artStyle?: string,
): Promise<{ imageUrl: string; artLibraryId?: string; previewsRemaining?: number }> {
  // Start the job
  const startRes = await fetch(`${API_URL}/api/art/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify({ cardText, gameType, theme, maturity, flavorThemes, wildcard, artStyle }),
  });
  if (!startRes.ok) {
    const data = await startRes.json().catch(() => ({}));
    throw new Error(data.error || "Failed to generate preview");
  }
  const { jobId } = await startRes.json();

  // Poll for result
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const pollRes = await fetch(`${API_URL}/api/art/preview/${jobId}`);
    if (!pollRes.ok) {
      const data = await pollRes.json().catch(() => ({}));
      throw new Error(data.error || "Failed to generate preview");
    }
    const result = await pollRes.json();
    if (result.status === "done") {
      return { imageUrl: result.imageUrl, artLibraryId: result.artLibraryId, previewsRemaining: result.previewsRemaining };
    }
    if (result.status === "error") {
      throw new Error(result.error || "Failed to generate preview");
    }
  }
  throw new Error("Preview generation timed out");
}

export async function createCheckoutSession(deckId: string): Promise<{ sessionUrl: string }> {
  const res = await fetch(`${API_URL}/api/stripe/create-checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify({ deckId }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Failed to create checkout session");
  }
  return res.json();
}

export async function checkArtStatus(deckId: string): Promise<{ artTier: string; artGenerationStatus: string | null }> {
  const res = await fetch(`${API_URL}/api/stripe/art-status/${deckId}`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to check art status");
  return res.json();
}

// Sounds API

export interface SavedSound {
  id: string;
  title: string;
  mp3: string;          // local /api/sounds/file/:id URL
  source_mp3: string;   // original myinstants URL, used for dedup
  created_at: string;
}

export async function searchSounds(q: string): Promise<{ results: { title: string; mp3: string }[] }> {
  const res = await fetch(`${API_URL}/api/sounds/search?q=${encodeURIComponent(q)}`);
  if (!res.ok) throw new Error("Search failed");
  return res.json();
}

export async function fetchSavedSounds(): Promise<SavedSound[]> {
  const res = await fetch(`${API_URL}/api/sounds/saved`, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error("Failed to fetch saved sounds");
  return res.json();
}

export async function saveSound(title: string, mp3: string): Promise<SavedSound> {
  const res = await fetch(`${API_URL}/api/sounds/saved`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify({ title, mp3 }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error || "Failed to save sound");
  }
  return res.json();
}

export async function incrementSoundPlay(id: string): Promise<void> {
  await fetch(`${API_URL}/api/sounds/saved/${id}/play`, {
    method: "POST",
    headers: getAuthHeaders(),
  });
}

export async function deleteSound(id: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/sounds/saved/${id}`, {
    method: "DELETE",
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to delete sound");
}

export async function adminGenerateArt(deckId: string): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`${API_URL}/api/art/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify({ deckId }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Failed to start art generation");
  }
  return res.json();
}

// ── Art Library ──

export interface ArtLibraryEntry {
  id: string;
  prompt: string;
  sourceCardText: string;
  gameType: string;
  deckName: string;
  width: number;
  height: number;
  hasSpeechBubble: boolean;
  useCount: number;
  createdAt: string;
}

export interface ArtLibraryBrowseResult {
  results: ArtLibraryEntry[];
  total: number;
  page: number;
  pages: number;
}

export async function browseArtLibrary(params: {
  q?: string;
  gameType?: string;
  page?: number;
  limit?: number;
}): Promise<ArtLibraryBrowseResult> {
  const searchParams = new URLSearchParams();
  if (params.q) searchParams.set("q", params.q);
  if (params.gameType) searchParams.set("gameType", params.gameType);
  if (params.page) searchParams.set("page", String(params.page));
  if (params.limit) searchParams.set("limit", String(params.limit));
  const res = await fetch(`${API_URL}/api/art-library/browse?${searchParams}`);
  if (!res.ok) throw new Error("Failed to browse art library");
  return res.json();
}

export function artLibraryImageUrl(id: string): string {
  return `${API_URL}/api/art-library/image/${id}`;
}

export function artLibraryThumbUrl(id: string): string {
  return `${API_URL}/api/art-library/thumb/${id}`;
}

export async function trackArtUse(id: string): Promise<void> {
  await fetch(`${API_URL}/api/art-library/use/${id}`, { method: "POST" }).catch(() => {});
}

// ── Card Library ──

export interface CardLibraryEntry {
  id: string;
  text: string;
  cardType: "chaos" | "knowledge";
  pick: number;
  gameType: string;
  maturity: string;
  theme: string;
  useCount: number;
  createdAt: string;
}

export async function browseCardLibrary(opts: {
  q?: string; gameType?: string; cardType?: string; page?: number; limit?: number;
}): Promise<{ results: CardLibraryEntry[]; total: number; page: number; pages: number }> {
  const params = new URLSearchParams();
  if (opts.q) params.set("q", opts.q);
  if (opts.gameType) params.set("gameType", opts.gameType);
  if (opts.cardType) params.set("cardType", opts.cardType);
  if (opts.page) params.set("page", String(opts.page));
  if (opts.limit) params.set("limit", String(opts.limit));
  const qs = params.toString();
  const res = await fetch(`${API_URL}/api/card-library/browse${qs ? `?${qs}` : ""}`);
  if (!res.ok) throw new Error("Failed to browse card library");
  return res.json();
}

export async function trackCardLibraryUse(ids: string[]): Promise<void> {
  await fetch(`${API_URL}/api/card-library/use`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  }).catch(() => {});
}
