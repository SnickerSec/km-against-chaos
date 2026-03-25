import { getAuthHeaders } from "./auth";

const API_URL = process.env.NEXT_PUBLIC_SERVER_URL || (typeof window !== "undefined" && window.location.hostname !== "localhost" ? "" : "http://localhost:3001");

export interface WinCondition {
  mode: "rounds" | "points";
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
}

export interface CustomDeck {
  id: string;
  name: string;
  description: string;
  chaosCards: { id: string; text: string; pick: number }[];
  knowledgeCards: { id: string; text: string }[];
  winCondition: WinCondition;
  createdAt: string;
  updatedAt: string;
  ownerId?: string | null;
}

export interface DeckExport {
  name: string;
  description: string;
  chaosCards: { text: string; pick?: number }[];
  knowledgeCards: { text: string }[];
  winCondition?: WinCondition;
}

export async function fetchDecks(): Promise<DeckSummary[]> {
  const res = await fetch(`${API_URL}/api/decks`);
  if (!res.ok) throw new Error("Failed to fetch decks");
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
  chaosCards: { text: string; pick: number }[];
  knowledgeCards: { text: string }[];
}

export async function generateCardsAI(
  theme: string,
  chaosCount?: number,
  knowledgeCount?: number
): Promise<GeneratedCards> {
  const res = await fetch(`${API_URL}/api/decks/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify({ theme, chaosCount, knowledgeCount }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || "Failed to generate cards");
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

// Admin API

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
