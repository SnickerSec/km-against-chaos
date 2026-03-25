"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import DeckForm from "@/components/DeckForm";
import { createDeck } from "@/lib/api";
import { useAuthStore } from "@/lib/auth";

export default function NewDeckPage() {
  const router = useRouter();
  const { user, loading, restore } = useAuthStore();

  useEffect(() => {
    restore();
  }, [restore]);

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/decks");
    }
  }, [loading, user, router]);

  if (loading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-400">Loading...</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold">Create New Deck</h1>
        <Link href="/decks" className="text-gray-400 hover:text-white text-sm">
          Back to Decks
        </Link>
      </div>

      <DeckForm
        submitLabel="Create Deck"
        onSubmit={async (data) => {
          await createDeck(data);
          router.push("/decks");
        }}
      />
    </div>
  );
}
