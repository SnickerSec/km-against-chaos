"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Icon } from "@iconify/react";
import { fetchDeck, ttsSpeak, remixDeck, CustomDeck, API_URL } from "@/lib/api";
import { useAuthStore } from "@/lib/auth";
import GameTypeBadge from "@/components/GameTypeBadge";

function ViewDeckContent() {
  const searchParams = useSearchParams();
  const id = searchParams.get("id");
  const router = useRouter();
  const { user, restore, isAdmin, isModerator } = useAuthStore();
  const [deck, setDeck] = useState<CustomDeck | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [voicePlaying, setVoicePlaying] = useState(false);
  const [remixing, setRemixing] = useState(false);

  useEffect(() => { restore(); }, [restore]);

  useEffect(() => {
    if (!id) { setError("No deck ID provided"); setLoading(false); return; }
    fetchDeck(id)
      .then(setDeck)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  const cardBackSrc = deck?.cardBackUrl
    ? (deck.cardBackUrl.startsWith("http") ? deck.cardBackUrl : `${API_URL}${deck.cardBackUrl}`)
    : null;

  const previewVoice = async () => {
    if (!deck) return;
    setVoicePlaying(true);
    try {
      const url = await ttsSpeak(`Welcome to ${deck.name}. ${deck.description || ""}`.slice(0, 400), deck.voiceId || undefined);
      if (url) await new Audio(url).play().catch(() => {});
    } finally { setVoicePlaying(false); }
  };

  const handleRemix = async () => {
    if (!id || !user) { router.push("/"); return; }
    setRemixing(true);
    try {
      const remixed = await remixDeck(id);
      router.push(`/decks/edit?id=${remixed.id}`);
    } catch (e: any) { setError(e.message); }
    finally { setRemixing(false); }
  };

  if (loading) return <div className="p-8 text-gray-400">Loading...</div>;
  if (error || !deck) return <div className="p-8 text-red-400">{error || "Deck not found"}</div>;

  const isOwner = user && deck.ownerId === user.id;
  const canEdit = isOwner || isAdmin || isModerator;
  const sampleChaos = deck.chaosCards.slice(0, 3);
  const sampleKnowledge = deck.knowledgeCards.slice(0, 4);

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6">
      <Link href="/decks" className="text-gray-400 hover:text-white text-sm flex items-center gap-1 mb-4">
        <Icon icon="mdi:arrow-left" /> Back to decks
      </Link>

      <div className="flex flex-col sm:flex-row gap-6 mb-6">
        <div className="w-40 h-56 rounded-xl border-2 border-gray-700 bg-gray-800 overflow-hidden shrink-0 mx-auto sm:mx-0 shadow-xl">
          {cardBackSrc ? (
            <img src={cardBackSrc} alt={`${deck.name} card back`} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Icon icon="mdi:cards-outline" className="text-5xl text-gray-600" />
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <GameTypeBadge gameType={deck.gameType} />
            {deck.maturity && <span className="text-xs text-gray-400 uppercase">{deck.maturity}</span>}
          </div>
          <h1 className="text-3xl font-bold mb-1">{deck.name}</h1>
          {deck.description && <p className="text-gray-400 mb-3">{deck.description}</p>}
          <div className="text-sm text-gray-400 space-y-1 mb-4">
            <p>{deck.chaosCards.length} prompts · {deck.knowledgeCards.length} answers</p>
            {deck.flavorThemes && deck.flavorThemes.length > 0 && (
              <p>Themes: {deck.flavorThemes.join(", ")}</p>
            )}
            {deck.winCondition && (
              <p>Win: {deck.winCondition.mode === "points" ? `${deck.winCondition.value} points` : `${deck.winCondition.value} rounds`}</p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={`/?deck=${deck.id}`} className="px-4 py-2 bg-purple-600 hover:bg-purple-500 rounded-lg font-semibold text-sm">
              Play
            </Link>
            {deck.voiceId !== undefined && (
              <button
                onClick={previewVoice}
                disabled={voicePlaying}
                className="px-4 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-sm flex items-center gap-1 disabled:opacity-50"
              >
                <Icon icon={voicePlaying ? "mdi:loading" : "mdi:volume-high"} className={voicePlaying ? "animate-spin" : ""} />
                Hear voice
              </button>
            )}
            {user && !isOwner && (
              <button
                onClick={handleRemix}
                disabled={remixing}
                className="px-4 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-sm flex items-center gap-1 disabled:opacity-50"
              >
                <Icon icon="mdi:content-copy" /> Remix
              </button>
            )}
            {canEdit && (
              <Link href={`/decks/edit?id=${deck.id}`} className="px-4 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-sm flex items-center gap-1">
                <Icon icon="mdi:pencil" /> Edit
              </Link>
            )}
          </div>
        </div>
      </div>

      {sampleChaos.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm uppercase tracking-wide text-gray-400 mb-2">Sample prompts</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {sampleChaos.map((c) => (
              <div key={c.id} className="bg-gray-900 border-2 border-red-500/50 rounded-xl p-4 text-sm min-h-[5rem]">
                {c.text}
              </div>
            ))}
          </div>
        </div>
      )}

      {sampleKnowledge.length > 0 && (
        <div>
          <h2 className="text-sm uppercase tracking-wide text-gray-400 mb-2">Sample answers</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {sampleKnowledge.map((c) => (
              <div key={c.id} className="bg-gray-100 text-gray-900 rounded-xl p-3 text-sm min-h-[4rem]">
                {c.text}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ViewDeckPage() {
  return (
    <Suspense fallback={<div className="p-8 text-gray-400">Loading...</div>}>
      <ViewDeckContent />
    </Suspense>
  );
}
