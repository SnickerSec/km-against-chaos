"use client";

import { Suspense } from "react";
import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import DeckForm from "@/components/DeckForm";
import { fetchDeck, updateDeck, CustomDeck } from "@/lib/api";
import { useAuthStore } from "@/lib/auth";

function EditDeckContent() {
  const searchParams = useSearchParams();
  const id = searchParams.get("id");
  const router = useRouter();
  const { user, loading: authLoading, restore } = useAuthStore();
  const [deck, setDeck] = useState<CustomDeck | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    restore();
  }, [restore]);

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/decks");
    }
  }, [authLoading, user, router]);

  useEffect(() => {
    if (!id) {
      setError("No deck ID provided");
      setLoading(false);
      return;
    }
    fetchDeck(id)
      .then((d) => {
        setDeck(d);
        if (user && d.ownerId && d.ownerId !== user.id) {
          setError("You don't own this deck");
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id, user]);

  if (authLoading || loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-400">Loading deck...</p>
      </div>
    );
  }

  if (error || !deck || !id) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen">
        <p className="text-red-400 mb-4">{error || "Deck not found"}</p>
        <Link href="/decks" className="text-purple-400 hover:underline">
          Back to Decks
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold">Edit Deck</h1>
        <Link href="/decks" className="text-gray-400 hover:text-white text-sm">
          Back to Decks
        </Link>
      </div>

      <DeckForm
        initial={{
          name: deck.name,
          description: deck.description,
          chaosCards: deck.chaosCards.map((c) => ({ text: c.text, pick: c.pick })),
          knowledgeCards: deck.knowledgeCards.map((c) => ({ text: c.text, ...(c.bonus ? { bonus: true } : {}) })),
          winCondition: deck.winCondition || { mode: "rounds", value: 10 },
          maturity: deck.maturity,
          flavorThemes: deck.flavorThemes,
          chaosLevel: deck.chaosLevel,
          wildcard: deck.wildcard,
          packs: deck.packs,
        }}
        submitLabel="Save Changes"
        onSubmit={async (data) => {
          await updateDeck(id, data);
          router.push("/decks");
        }}
      />
    </div>
  );
}

export default function EditDeckPage() {
  return (
    <Suspense>
      <EditDeckContent />
    </Suspense>
  );
}
