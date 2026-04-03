"use client";

import { Suspense } from "react";
import { useEffect, useState, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Icon } from "@iconify/react";
import DeckForm from "@/components/DeckForm";
import { fetchDeck, updateDeck, checkArtStatus, adminGenerateArt, CustomDeck, API_URL } from "@/lib/api";
import { generateDeckPdf } from "@/lib/printDeck";
import { useAuthStore, getAuthHeaders } from "@/lib/auth";

function EditDeckContent() {
  const searchParams = useSearchParams();
  const id = searchParams.get("id");
  const router = useRouter();
  const { user, loading: authLoading, restore, isAdmin, isModerator } = useAuthStore();
  const artParam = searchParams.get("art");
  const [deck, setDeck] = useState<CustomDeck | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [artStatus, setArtStatus] = useState<string | null>(artParam === "generating" ? "pending" : null);

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

  // Poll art generation status after Stripe redirect
  useEffect(() => {
    if (!id || !artStatus || artStatus === "complete" || artStatus === "failed") return;
    const interval = setInterval(async () => {
      try {
        const { artGenerationStatus } = await checkArtStatus(id);
        setArtStatus(artGenerationStatus);
        if (artGenerationStatus === "complete" || artGenerationStatus === "failed") {
          clearInterval(interval);
        }
      } catch {}
    }, 3000);
    return () => clearInterval(interval);
  }, [id, artStatus]);

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
          {isAdmin && !artStatus && (
            <button
              onClick={async () => {
                try {
                  await adminGenerateArt(id!);
                  setArtStatus("pending");
                } catch (err: any) {
                  alert(err.message);
                }
              }}
              className="text-gray-400 hover:text-purple-400 text-sm transition-colors flex items-center gap-1"
            >
              <Icon icon="mdi:image-auto-adjust" width={16} />
              Generate Art
            </button>
          )}
          <EditPrintDropdown deck={deck} deckId={id!} />
          <Link href="/decks" className="text-gray-400 hover:text-white text-sm">
            Back to Decks
          </Link>
        </div>
      </div>

      {artStatus && artStatus !== "complete" && artStatus !== "failed" && (
        <div className="mb-6 bg-purple-900/30 border border-purple-600 rounded-xl p-4 flex items-center gap-3">
          <Icon icon="mdi:loading" className="text-xl text-purple-400 animate-spin" />
          <div>
            <p className="text-sm font-medium text-white">Generating AI art for your cards...</p>
            <p className="text-xs text-gray-400">This takes 1-3 minutes. You can leave and come back.</p>
          </div>
        </div>
      )}
      {artStatus === "complete" && (
        <div className="mb-6 bg-green-900/30 border border-green-600 rounded-xl p-4 flex items-center gap-3">
          <Icon icon="mdi:check-circle" className="text-xl text-green-400" />
          <p className="text-sm font-medium text-white">AI art generation complete!</p>
        </div>
      )}
      {artStatus === "failed" && (
        <div className="mb-6 bg-red-900/30 border border-red-600 rounded-xl p-4 flex items-center gap-3">
          <Icon icon="mdi:alert-circle" className="text-xl text-red-400" />
          <p className="text-sm font-medium text-white">Art generation failed. Contact support for a refund.</p>
        </div>
      )}

      <DeckForm
        initial={{
          name: deck.name,
          description: deck.description,
          chaosCards: deck.chaosCards.map((c) => ({ text: c.text, pick: c.pick, ...(c.imageUrl ? { imageUrl: c.imageUrl } : {}) })),
          knowledgeCards: deck.knowledgeCards.map((c) => ({ text: c.text, ...(c.bonus ? { bonus: true } : {}), ...(c.imageUrl ? { imageUrl: c.imageUrl } : {}) })),
          winCondition: deck.winCondition || { mode: "rounds", value: 10 },
          maturity: deck.maturity,
          flavorThemes: deck.flavorThemes,
          chaosLevel: deck.chaosLevel,
          wildcard: deck.wildcard,
          packs: deck.packs,
          gameType: deck.gameType,
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
