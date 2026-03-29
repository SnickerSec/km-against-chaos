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
}

export interface CustomDeck {
  id: string;
  name: string;
  description: string;
  chaosCards: { id: string; text: string; pick: number; metaType?: string; metaEffect?: any }[];
  knowledgeCards: { id: string; text: string; bonus?: boolean }[];
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
}

export async function fetchDecks(options?: { search?: string; gameType?: string; sort?: string }): Promise<DeckSummary[]> {
  const params = new URLSearchParams();
  if (options?.search) params.set("search", options.search);
  if (options?.gameType) params.set("gameType", options.gameType);
  if (options?.sort) params.set("sort", options.sort);
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
}

export async function generateDeckAI(ctx: GenerateContext): Promise<GeneratedDeck> {
  const res = await fetch(`${API_URL}/api/decks/generate-deck`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify(ctx),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || "Failed to generate deck");
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
    const err = await res.json();
    throw new Error(err.error || "Failed to generate cards");
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

export async function sendFriendRequest(email: string) {
  const res = await fetch(`${API_URL}/api/friends/request`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify({ email }),
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
