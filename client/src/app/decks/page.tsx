"use client";

import { Suspense, useEffect, useState, useRef, useCallback } from "react";
import { Icon } from "@iconify/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { fetchDecks, fetchDeck, deleteDeck, fetchPacks, createDeckFromPacks, DeckSummary, PackSummary, API_URL } from "@/lib/api";
import { useAuthStore } from "@/lib/auth";
import { getAuthHeaders } from "@/lib/auth";
import { generateDeckPdf } from "@/lib/printDeck";
import GoogleSignIn from "@/components/GoogleSignIn";

type Tab = "my-decks" | "browse-packs";

function DecksPageContent() {
  const [tab, setTab] = useState<Tab>("my-decks");
  const [decks, setDecks] = useState<DeckSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Browse packs state
  const [packs, setPacks] = useState<PackSummary[]>([]);
  const [packsLoading, setPacksLoading] = useState(false);
  const [packsError, setPacksError] = useState<string | null>(null);
  const [packsLoaded, setPacksLoaded] = useState(false);

  // Selected packs: only one base allowed, multiple expansion/themed
  const [selectedBase, setSelectedBase] = useState<string | null>(null);
  const [selectedExpansions, setSelectedExpansions] = useState<Set<string>>(new Set());
  const [selectedThemed, setSelectedThemed] = useState<Set<string>>(new Set());

  // Build form
  const [buildName, setBuildName] = useState("");
  const [building, setBuilding] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [showBuildForm, setShowBuildForm] = useState(false);

  const [printing, setPrinting] = useState<string | null>(null);

  // TGC progress
  const [tgcProgress, setTgcProgress] = useState<{ step: string; progress: number; total: number; detail?: string } | null>(null);
  const [tgcError, setTgcError] = useState<string | null>(null);
  const [tgcCartUrl, setTgcCartUrl] = useState<string | null>(null);

  const user = useAuthStore((s) => s.user);
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const isModerator = useAuthStore((s) => s.isModerator);
  const router = useRouter();
  const searchParams = useSearchParams();

  const load = async () => {
    try {
      setDecks(await fetchDecks());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const loadPacks = async () => {
    if (packsLoaded) return;
    setPacksLoading(true);
    try {
      const data = await fetchPacks();
      setPacks(data);
      setPacksLoaded(true);
    } catch (e: any) {
      setPacksError(e.message);
    } finally {
      setPacksLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // Handle TGC SSO callback
  const tgcStartedRef = useRef(false);
  useEffect(() => {
    const tgcToken = searchParams.get("tgcToken");
    const tgcErr = searchParams.get("tgcError");
    if (tgcErr) {
      setTgcError(decodeURIComponent(tgcErr));
      window.history.replaceState({}, "", "/decks");
      return;
    }
    if (!tgcToken || tgcStartedRef.current) return;
    tgcStartedRef.current = true;

    // Clear URL params without triggering re-render
    window.history.replaceState({}, "", "/decks");

    // Start SSE stream
    setTgcProgress({ step: "Connecting", progress: 0, total: 0, detail: "Starting..." });
    const eventSource = new EventSource(`${API_URL}/api/print/tgc/create?token=${tgcToken}`);
    eventSource.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.error) {
        setTgcError(data.error);
        setTgcProgress(null);
        eventSource.close();
      } else if (data.done) {
        setTgcCartUrl(data.cartUrl);
        setTgcProgress(null);
        eventSource.close();
      } else {
        setTgcProgress(data);
      }
    };
    eventSource.onerror = () => {
      setTgcError("Connection lost during card upload");
      setTgcProgress(null);
      eventSource.close();
    };
    return () => eventSource.close();
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleTabChange = (t: Tab) => {
    setTab(t);
    if (t === "browse-packs") loadPacks();
  };

  const handleRemix = (id: string) => {
    if (!user) { setError("Sign in to remix a deck"); return; }
    router.push(`/decks/new?remixOf=${id}`);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this deck?")) return;
    try {
      await deleteDeck(id);
      setDecks(decks.filter((d) => d.id !== id));
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handlePrint = async (deckId: string) => {
    setPrinting(deckId);
    try {
      const full = await fetchDeck(deckId);
      await generateDeckPdf(full);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setPrinting(null);
    }
  };

  const handleTgc = async (deckId: string) => {
    try {
      const res = await fetch(`${API_URL}/api/print/tgc/auth?deckId=${deckId}`, {
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        return;
      }
      window.location.href = data.url;
    } catch (e: any) {
      setError(e.message);
    }
  };

  const isOwner = (deck: DeckSummary) => user && deck.ownerId === user.id;

  // Pack selection helpers
  const basePacks = packs.filter((p) => p.type === "base");
  const expansionPacks = packs.filter((p) => p.type === "expansion");
  const themedPacks = packs.filter((p) => p.type === "themed");

  const toggleBase = (id: string) => {
    setSelectedBase((prev) => (prev === id ? null : id));
  };

  const toggleExpansion = (id: string) => {
    setSelectedExpansions((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleThemed = (id: string) => {
    setSelectedThemed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectedPackIds = [
    ...(selectedBase ? [selectedBase] : []),
    ...Array.from(selectedExpansions),
    ...Array.from(selectedThemed),
  ];

  const totalSelected = selectedPackIds.length;

  const handleBuild = async () => {
    setBuildError(null);
    if (!buildName.trim()) { setBuildError("Deck name is required"); return; }
    if (!user) { setBuildError("You must be signed in to build a deck"); return; }
    setBuilding(true);
    try {
      await createDeckFromPacks({ packIds: selectedPackIds, name: buildName.trim() });
      await load();
      setTab("my-decks");
      setShowBuildForm(false);
      setBuildName("");
      setSelectedBase(null);
      setSelectedExpansions(new Set());
      setSelectedThemed(new Set());
    } catch (e: any) {
      setBuildError(e.message);
    } finally {
      setBuilding(false);
    }
  };

  const PackCard = ({ pack, selected, onToggle, colorClass, borderClass }: {
    pack: PackSummary;
    selected: boolean;
    onToggle: () => void;
    colorClass: string;
    borderClass: string;
  }) => (
    <button
      onClick={onToggle}
      className={`w-full text-left p-4 rounded-xl border-2 transition-all ${
        selected
          ? `${borderClass} bg-gray-800`
          : "border-gray-700 bg-gray-900 hover:border-gray-500"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`font-semibold text-sm ${colorClass}`}>{pack.type === "base" ? (pack.deckName || pack.name) : pack.name}</span>
            {selected && (
              <span className="text-xs bg-green-700/40 text-green-300 px-2 py-0.5 rounded-full">Selected</span>
            )}
          </div>
          {pack.description && (
            <p className="text-gray-400 text-xs mt-1 line-clamp-2">{pack.description}</p>
          )}
          <p className="text-gray-500 text-xs mt-1">
            {pack.chaosCount} prompts · {pack.knowledgeCount} answers
            {pack.deckName && ` · from "${pack.deckName}"`}
          </p>
        </div>
        <div className={`w-5 h-5 rounded border-2 flex-shrink-0 mt-0.5 flex items-center justify-center ${
          selected ? `${borderClass} bg-current` : "border-gray-600"
        }`}>
          {selected && <Icon icon="mdi:check" className="text-white" width={14} />}
        </div>
      </div>
    </button>
  );

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      {/* TGC Progress Modal */}
      {(tgcProgress || tgcError || tgcCartUrl) && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-full max-w-md shadow-2xl">
            {tgcProgress && (
              <>
                <div className="flex items-center gap-3 mb-4">
                  <Icon icon="mdi:loading" className="animate-spin text-purple-400" width={24} />
                  <h3 className="text-lg font-semibold">Creating on The Game Crafter</h3>
                </div>
                <p className="text-sm text-gray-400 mb-1">{tgcProgress.step}</p>
                <p className="text-xs text-gray-500 mb-3">{tgcProgress.detail}</p>
                {tgcProgress.total > 0 && (
                  <>
                    <div className="w-full bg-gray-800 rounded-full h-3 mb-2">
                      <div
                        className="bg-purple-600 h-3 rounded-full transition-all duration-300"
                        style={{ width: `${Math.round((tgcProgress.progress / tgcProgress.total) * 100)}%` }}
                      />
                    </div>
                    <p className="text-xs text-gray-500 text-right">
                      {tgcProgress.progress} / {tgcProgress.total} cards
                    </p>
                  </>
                )}
              </>
            )}
            {tgcError && (
              <>
                <div className="flex items-center gap-3 mb-4">
                  <Icon icon="mdi:alert-circle" className="text-red-400" width={24} />
                  <h3 className="text-lg font-semibold">Error</h3>
                </div>
                <p className="text-sm text-red-400 mb-4">{tgcError}</p>
                <button
                  onClick={() => setTgcError(null)}
                  className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm font-semibold transition-colors"
                >
                  Close
                </button>
              </>
            )}
            {tgcCartUrl && (
              <>
                <div className="flex items-center gap-3 mb-4">
                  <Icon icon="mdi:check-circle" className="text-green-400" width={24} />
                  <h3 className="text-lg font-semibold">Ready to Order!</h3>
                </div>
                <p className="text-sm text-gray-400 mb-4">Your deck has been created on The Game Crafter. Click below to review and checkout.</p>
                <div className="flex gap-3">
                  <a
                    href={tgcCartUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg text-sm font-semibold text-center transition-colors"
                  >
                    Go to Cart
                  </a>
                  <button
                    onClick={() => setTgcCartUrl(null)}
                    className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm font-semibold transition-colors"
                  >
                    Close
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

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

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => handleTabChange("my-decks")}
          className={`px-4 py-2 rounded-lg font-semibold text-sm transition-colors ${
            tab === "my-decks"
              ? "bg-purple-600 text-white"
              : "bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700"
          }`}
        >
          My Decks
        </button>
        <button
          onClick={() => handleTabChange("browse-packs")}
          className={`px-4 py-2 rounded-lg font-semibold text-sm transition-colors ${
            tab === "browse-packs"
              ? "bg-purple-600 text-white"
              : "bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700"
          }`}
        >
          Browse Packs
        </button>
      </div>

      {/* My Decks tab */}
      {tab === "my-decks" && (
        <>
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
          ) : (user ? decks.filter((d) => isOwner(d)) : []).length === 0 ? (
            <div className="text-center py-12 bg-gray-900 rounded-xl">
              <p className="text-gray-400 text-lg mb-2">No custom decks yet</p>
              <p className="text-gray-500 text-sm">
                {user ? "Create one or import a JSON file to get started" : "Sign in to create decks"}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {decks.filter((d) => isOwner(d) || isAdmin || isModerator).map((deck) => (
                <div
                  key={deck.id}
                  className="flex items-center justify-between bg-gray-900 rounded-xl p-4"
                >
                  <div className="flex-1 min-w-0">
                    {(isOwner(deck) || isAdmin || isModerator) ? (
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
                    <PrintDropdown
                      deckId={deck.id}
                      printing={printing === deck.id}
                      onPdf={() => handlePrint(deck.id)}
                      onTgc={() => handleTgc(deck.id)}
                    />
                    {user && !isOwner(deck) && (
                      <button
                        onClick={() => handleRemix(deck.id)}
                        className="px-3 py-1 text-xs bg-gray-800 hover:bg-gray-700 rounded border border-gray-600 transition-colors"
                      >
                        Remix
                      </button>
                    )}
                    {(isOwner(deck) || isAdmin || isModerator) && (
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
        </>
      )}

      {/* Browse Packs tab */}
      {tab === "browse-packs" && (
        <div className="space-y-8">
          {packsError && <p className="text-red-400 text-sm">{packsError}</p>}

          {packsLoading ? (
            <p className="text-gray-400">Loading packs...</p>
          ) : packs.length === 0 && packsLoaded ? (
            <div className="text-center py-12 bg-gray-900 rounded-xl">
              <p className="text-gray-400 text-lg mb-2">No packs available yet</p>
              <p className="text-gray-500 text-sm">Create a deck with packs to see them here</p>
            </div>
          ) : (
            <>
              {/* Base Games */}
              {basePacks.length > 0 && (
                <div>
                  <h2 className="text-lg font-semibold text-white mb-1">Base Games</h2>
                  <p className="text-gray-500 text-xs mb-3">Select one base game (required)</p>
                  <div className="space-y-2">
                    {basePacks.map((pack) => (
                      <PackCard
                        key={pack.id}
                        pack={pack}
                        selected={selectedBase === pack.id}
                        onToggle={() => toggleBase(pack.id)}
                        colorClass="text-white"
                        borderClass="border-gray-400"
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Expansion Boxes */}
              {expansionPacks.length > 0 && (
                <div>
                  <h2 className="text-lg font-semibold text-yellow-400 mb-1">Expansion Boxes</h2>
                  <p className="text-gray-500 text-xs mb-3">Add any expansions you like</p>
                  <div className="space-y-2">
                    {expansionPacks.map((pack) => (
                      <PackCard
                        key={pack.id}
                        pack={pack}
                        selected={selectedExpansions.has(pack.id)}
                        onToggle={() => toggleExpansion(pack.id)}
                        colorClass="text-yellow-400"
                        borderClass="border-yellow-500"
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Themed Packs */}
              {themedPacks.length > 0 && (
                <div>
                  <h2 className="text-lg font-semibold text-cyan-400 mb-1">Themed Packs</h2>
                  <p className="text-gray-500 text-xs mb-3">Mix in themed card sets</p>
                  <div className="space-y-2">
                    {themedPacks.map((pack) => (
                      <PackCard
                        key={pack.id}
                        pack={pack}
                        selected={selectedThemed.has(pack.id)}
                        onToggle={() => toggleThemed(pack.id)}
                        colorClass="text-cyan-400"
                        borderClass="border-cyan-500"
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Build summary bar */}
              {packsLoaded && packs.length > 0 && (
                <div className="sticky bottom-4">
                  <div className="bg-gray-900 border border-gray-700 rounded-xl p-4 shadow-xl">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-sm font-semibold text-white">
                          {totalSelected === 0
                            ? "No packs selected"
                            : `${totalSelected} pack${totalSelected === 1 ? "" : "s"} selected`}
                        </p>
                        {!selectedBase && (
                          <p className="text-xs text-yellow-400 mt-0.5">Select a base game to continue</p>
                        )}
                      </div>
                      <button
                        disabled={!selectedBase || !user}
                        onClick={() => setShowBuildForm((v) => !v)}
                        className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg font-semibold text-sm transition-colors"
                        title={!user ? "Sign in to build a deck" : !selectedBase ? "Select a base game first" : ""}
                      >
                        Build My Deck
                      </button>
                    </div>

                    {!user && (
                      <p className="text-xs text-gray-500 mt-2">Sign in to build a custom deck from these packs.</p>
                    )}

                    {showBuildForm && user && (
                      <div className="mt-4 pt-4 border-t border-gray-700">
                        <label className="block text-sm font-medium text-gray-300 mb-2">Deck Name</label>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            placeholder="My Custom Deck"
                            value={buildName}
                            onChange={(e) => setBuildName(e.target.value)}
                            className="flex-1 px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-500 text-sm focus:outline-none focus:border-purple-500"
                            onKeyDown={(e) => { if (e.key === "Enter") handleBuild(); }}
                          />
                          <button
                            onClick={handleBuild}
                            disabled={building || !buildName.trim()}
                            className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg font-semibold text-sm transition-colors whitespace-nowrap"
                          >
                            {building ? "Building..." : "Create Deck"}
                          </button>
                        </div>
                        {buildError && <p className="text-red-400 text-xs mt-2">{buildError}</p>}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function DecksPage() {
  return <Suspense><DecksPageContent /></Suspense>;
}

function PrintDropdown({ deckId, printing, onPdf, onTgc }: {
  deckId: string;
  printing: boolean;
  onPdf: () => void;
  onTgc: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        disabled={printing}
        className="px-3 py-1 text-xs bg-gray-800 hover:bg-gray-700 rounded border border-gray-600 transition-colors disabled:opacity-50"
        title="Print options"
      >
        {printing ? (
          <Icon icon="mdi:loading" className="animate-spin" width={14} />
        ) : (
          <Icon icon="mdi:printer" width={14} />
        )}
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-64 bg-gray-800 border border-gray-700 rounded-lg shadow-xl py-1 z-50">
          <button
            onClick={() => { setOpen(false); onPdf(); }}
            className="w-full text-left px-3 py-2 text-sm text-gray-300 hover:text-white hover:bg-gray-700 transition-colors flex items-center gap-2"
          >
            <Icon icon="mdi:file-pdf-box" width={16} className="text-red-400" />
            Download PDF
          </button>
          <button
            onClick={() => { setOpen(false); onTgc(); }}
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
