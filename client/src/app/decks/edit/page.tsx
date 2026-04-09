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
          // Re-fetch deck to get updated card images
          fetchDeck(id).then((d) => setDeck(d)).catch(() => {});
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

      <ArtGallery deck={deck} />

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
        onGenerateArt={isAdmin ? async (data) => {
          await updateDeck(id, data);
          await adminGenerateArt(id!);
          setArtStatus("pending");
        } : undefined}
      />
    </div>
  );
}

function ArtGallery({ deck }: { deck: CustomDeck }) {
  const cardsWithArt = [
    ...deck.chaosCards.filter((c) => c.imageUrl).map((c) => ({ ...c, type: "chaos" as const })),
    ...deck.knowledgeCards.filter((c) => c.imageUrl).map((c) => ({ ...c, type: "knowledge" as const })),
  ];
  const [expanded, setExpanded] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  useEffect(() => {
    if (lightboxIndex === null) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") setLightboxIndex((i) => i !== null ? Math.min(i + 1, cardsWithArt.length - 1) : null);
      else if (e.key === "ArrowLeft") setLightboxIndex((i) => i !== null ? Math.max(i - 1, 0) : null);
      else if (e.key === "Escape") setLightboxIndex(null);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [lightboxIndex, cardsWithArt.length]);

  if (cardsWithArt.length === 0) return null;

  const activeCard = lightboxIndex !== null ? cardsWithArt[lightboxIndex] : null;

  return (
    <>
      <div className="mb-6">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 text-sm font-medium text-purple-400 hover:text-purple-300 transition-colors"
        >
          <Icon icon={expanded ? "mdi:chevron-down" : "mdi:chevron-right"} width={20} />
          <Icon icon="mdi:image-multiple" width={16} />
          Card Art Gallery ({cardsWithArt.length} cards)
        </button>
        {expanded && (
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {cardsWithArt.map((card, i) => (
              <div
                key={card.id}
                onClick={() => setLightboxIndex(i)}
                className="cursor-pointer group rounded-lg overflow-hidden border border-gray-700 hover:border-purple-500 transition-colors"
              >
                <img
                  src={card.imageUrl}
                  alt={card.text}
                  className="w-full aspect-[5/7] object-cover"
                  loading="lazy"
                />
                <div className="p-1.5 bg-gray-800">
                  <p className="text-[10px] text-gray-400 truncate">{card.text}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {activeCard && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setLightboxIndex(null)}
        >
          <div className="relative max-w-2xl w-full flex flex-col items-center" onClick={(e) => e.stopPropagation()}>
            {/* Navigation arrows */}
            {lightboxIndex! > 0 && (
              <button
                onClick={() => setLightboxIndex(lightboxIndex! - 1)}
                className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-12 text-white/70 hover:text-white transition-colors"
              >
                <Icon icon="mdi:chevron-left" width={40} />
              </button>
            )}
            {lightboxIndex! < cardsWithArt.length - 1 && (
              <button
                onClick={() => setLightboxIndex(lightboxIndex! + 1)}
                className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-12 text-white/70 hover:text-white transition-colors"
              >
                <Icon icon="mdi:chevron-right" width={40} />
              </button>
            )}

            <img
              src={activeCard.imageUrl}
              alt={activeCard.text}
              className="max-w-full max-h-[70vh] rounded-lg"
            />
            <div className="mt-3 text-center">
              <p className="text-white text-sm">{activeCard.text}</p>
              <p className="text-gray-500 text-xs mt-1">
                {lightboxIndex! + 1} / {cardsWithArt.length} · {activeCard.type === "chaos" ? "Prompt" : "Answer"} card
              </p>
            </div>
          </div>
        </div>
      )}
    </>
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
