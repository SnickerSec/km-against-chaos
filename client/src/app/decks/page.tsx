"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchDecks, deleteDeck, importDeck, DeckSummary, DeckExport, API_URL } from "@/lib/api";
import { useAuthStore } from "@/lib/auth";
import GoogleSignIn from "@/components/GoogleSignIn";

export default function DecksPage() {
  const [decks, setDecks] = useState<DeckSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const user = useAuthStore((s) => s.user);
  const isAdmin = useAuthStore((s) => s.isAdmin);

  const load = async () => {
    try {
      setDecks(await fetchDecks());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this deck?")) return;
    try {
      await deleteDeck(id);
      setDecks(decks.filter((d) => d.id !== id));
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleImport = async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data: DeckExport = JSON.parse(text);
        await importDeck(data);
        load();
      } catch (e: any) {
        setError(e.message || "Invalid deck file");
      }
    };
    input.click();
  };

  const isOwner = (deck: DeckSummary) => user && deck.ownerId === user.id;

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold">Deck Builder</h1>
          <p className="text-gray-400 text-sm mt-1">Create and manage custom card decks</p>
        </div>
        <div className="flex items-center gap-4">
          <GoogleSignIn />
          <Link href="/" className="text-gray-400 hover:text-white text-sm">
            Back to Decked
          </Link>
        </div>
      </div>

      {user && (
        <div className="flex gap-3 mb-6">
          <Link
            href="/decks/new"
            className="px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg font-semibold text-sm transition-colors"
          >
            Create New Deck
          </Link>
          {isAdmin && (
            <Link
              href="/admin"
              className="px-4 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-600 rounded-lg font-semibold text-sm transition-colors"
            >
              Admin
            </Link>
          )}
          <button
            onClick={handleImport}
            className="px-4 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-600 rounded-lg font-semibold text-sm transition-colors"
          >
            Import JSON
          </button>
        </div>
      )}

      {!user && (
        <p className="text-gray-500 text-sm mb-6">
          Sign in with Google to create and manage your own decks.
        </p>
      )}

      {error && <p className="text-red-400 text-sm mb-4">{error}</p>}

      {loading ? (
        <p className="text-gray-400">Loading decks...</p>
      ) : decks.length === 0 ? (
        <div className="text-center py-12 bg-gray-900 rounded-xl">
          <p className="text-gray-400 text-lg mb-2">No custom decks yet</p>
          <p className="text-gray-500 text-sm">
            {user ? "Create one or import a JSON file to get started" : "Sign in to create decks"}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {decks.map((deck) => (
            <div
              key={deck.id}
              className="flex items-center justify-between bg-gray-900 rounded-xl p-4"
            >
              <div className="flex-1 min-w-0">
                {isOwner(deck) ? (
                  <Link
                    href={`/decks/edit?id=${deck.id}`}
                    className="font-semibold text-lg hover:text-purple-400 transition-colors"
                  >
                    {deck.name}
                  </Link>
                ) : (
                  <span className="font-semibold text-lg">{deck.name}</span>
                )}
                {deck.description && (
                  <p className="text-gray-400 text-sm truncate">{deck.description}</p>
                )}
                <p className="text-gray-500 text-xs mt-1">
                  {deck.chaosCount} prompts · {deck.knowledgeCount} answers
                  {deck.builtIn && " · Built-in"}
                </p>
              </div>
              <div className="flex gap-2 ml-4">
                <a
                  href={`${API_URL}/api/decks/${deck.id}/export`}
                  className="px-3 py-1 text-xs bg-gray-800 hover:bg-gray-700 rounded border border-gray-600 transition-colors"
                >
                  Export
                </a>
                {isOwner(deck) && (
                  <button
                    onClick={() => handleDelete(deck.id)}
                    className="px-3 py-1 text-xs text-red-400 hover:text-red-300 bg-gray-800 hover:bg-gray-700 rounded border border-gray-600 transition-colors"
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
