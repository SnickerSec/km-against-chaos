const API_URL = process.env.NEXT_PUBLIC_SERVER_URL || (typeof window !== "undefined" && window.location.hostname !== "localhost" ? "" : "http://localhost:3001");

export interface DeckSummary {
  id: string;
  name: string;
  description: string;
  chaosCount: number;
  knowledgeCount: number;
  builtIn?: boolean;
}

export interface CustomDeck {
  id: string;
  name: string;
  description: string;
  chaosCards: { id: string; text: string; pick: number }[];
  knowledgeCards: { id: string; text: string }[];
  createdAt: string;
  updatedAt: string;
}

export interface DeckExport {
  name: string;
  description: string;
  chaosCards: { text: string; pick?: number }[];
  knowledgeCards: { text: string }[];
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
    headers: { "Content-Type": "application/json" },
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
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || "Failed to update deck");
  }
  return res.json();
}

export async function deleteDeck(id: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/decks/${id}`, { method: "DELETE" });
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
    headers: { "Content-Type": "application/json" },
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
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || "Failed to import deck");
  }
  return res.json();
}
