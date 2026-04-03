"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import DeckForm from "@/components/DeckForm";
import { createDeck, createCheckoutSession, adminGenerateArt, fetchDeck } from "@/lib/api";
import { useAuthStore } from "@/lib/auth";

function NewDeckContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const remixOf = searchParams.get("remixOf");
  const { user, loading, restore, isAdmin } = useAuthStore();
  const [initialData, setInitialData] = useState<any>(null);
  const [remixLoading, setRemixLoading] = useState(!!remixOf);
  const [remixName, setRemixName] = useState<string | null>(null);

  useEffect(() => {
    restore();
  }, [restore]);

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/decks");
    }
  }, [loading, user, router]);

  useEffect(() => {
    if (!remixOf) return;
    fetchDeck(remixOf)
      .then((deck) => {
        setRemixName(deck.name);
        setInitialData({
          name: `Remix of ${deck.name}`,
          description: deck.description,
          chaosCards: deck.chaosCards.map((c) => ({ text: c.text, pick: c.pick })),
          knowledgeCards: deck.knowledgeCards.map((c) => ({ text: c.text })),
          winCondition: deck.winCondition || { mode: "rounds", value: 10 },
          maturity: deck.maturity,
          flavorThemes: deck.flavorThemes,
          chaosLevel: deck.chaosLevel,
          wildcard: deck.wildcard,
        });
      })
      .catch(() => setInitialData(null))
      .finally(() => setRemixLoading(false));
  }, [remixOf]);

  if (loading || !user || remixLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-400">{remixLoading ? "Loading deck..." : "Loading..."}</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold">
          {remixName ? `Remixing "${remixName}"` : "Create New Deck"}
        </h1>
        <Link href="/decks" className="text-gray-400 hover:text-white text-sm">
          Back to Decks
        </Link>
      </div>

      <DeckForm
        initial={initialData ?? undefined}
        submitLabel={remixOf ? "Save Remix" : "Create Deck"}
        onSubmit={async (data) => {
          const deck = await createDeck({ ...data, remixedFrom: remixOf || undefined });
          if (data.premiumArt && deck.id) {
            if (isAdmin) {
              try {
                await adminGenerateArt(deck.id);
                router.push(`/decks/edit?id=${deck.id}&art=generating`);
                return;
              } catch (err) {
                console.error("Failed to start art generation:", err);
              }
            } else {
              try {
                const { sessionUrl } = await createCheckoutSession(deck.id);
                if (sessionUrl) {
                  window.location.href = sessionUrl;
                  return;
                }
              } catch (err) {
                console.error("Failed to create checkout:", err);
              }
            }
          }
          router.push("/decks");
        }}
      />
    </div>
  );
}

export default function NewDeckPage() {
  return (
    <Suspense>
      <NewDeckContent />
    </Suspense>
  );
}
