"use client";

import { Suspense } from "react";
import { useEffect, useState, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Icon } from "@iconify/react";
import DeckForm from "@/components/DeckForm";
import { fetchDeck, updateDeck, CustomDeck, API_URL } from "@/lib/api";
import { generateDeckPdf } from "@/lib/printDeck";
import { useAuthStore, getAuthHeaders } from "@/lib/auth";

function EditDeckContent() {
  const searchParams = useSearchParams();
  const id = searchParams.get("id");
  const router = useRouter();
  const { user, loading: authLoading, restore, isAdmin, isModerator } = useAuthStore();
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
        if (user && d.ownerId && d.ownerId !== user.id && !isAdmin && !isModerator) {
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
        <div className="flex items-center gap-4">
          <EditPrintDropdown deck={deck} deckId={id!} />
          <Link href="/decks" className="text-gray-400 hover:text-white text-sm">
            Back to Decks
          </Link>
        </div>
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

function EditPrintDropdown({ deck, deckId }: { deck: CustomDeck; deckId: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const handleTgc = async () => {
    setOpen(false);
    try {
      const res = await fetch(`${API_URL}/api/print/tgc/auth?deckId=${deckId}`, {
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (data.error) { alert(data.error); return; }
      window.location.href = data.url;
    } catch (e: any) {
      alert(e.message);
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="text-gray-400 hover:text-purple-400 text-sm transition-colors flex items-center gap-1"
      >
        <Icon icon="mdi:printer" width={16} />
        Print
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-64 bg-gray-800 border border-gray-700 rounded-lg shadow-xl py-1 z-50">
          <button
            onClick={() => { setOpen(false); generateDeckPdf(deck); }}
            className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:text-white hover:bg-gray-700 transition-colors flex items-center gap-2"
          >
            <Icon icon="mdi:file-pdf-box" width={16} className="text-red-400" />
            Download PDF
          </button>
          <button
            onClick={handleTgc}
            className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:text-white hover:bg-gray-700 transition-colors flex items-center gap-2"
          >
            <Icon icon="mdi:cards-playing" width={16} className="text-purple-400" />
            Order from The Game Crafter
          </button>
        </div>
      )}
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
