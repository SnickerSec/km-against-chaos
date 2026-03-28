"use client";

import { useEffect, useState, useRef } from "react";
import { Icon } from "@iconify/react";
import Link from "next/link";
import { API_URL } from "@/lib/api";

interface Progress {
  step: string;
  progress: number;
  total: number;
  detail?: string;
}

export default function TgcPrintPage() {
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cartUrl, setCartUrl] = useState<string | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    if (!token) {
      setError("Missing token. Please try again from the Decks page.");
      return;
    }
    startedRef.current = true;
    window.history.replaceState({}, "", "/decks/print");

    setProgress({ step: "Connecting", progress: 0, total: 0, detail: "Starting..." });
    const eventSource = new EventSource(`${API_URL}/api/print/tgc/create?token=${token}`);
    eventSource.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.error) {
          setError(data.error);
          setProgress(null);
          eventSource.close();
        } else if (data.done) {
          setCartUrl(data.cartUrl);
          setProgress(null);
          eventSource.close();
        } else {
          setProgress(data);
        }
      } catch {
        setError("Invalid response from server");
        setProgress(null);
        eventSource.close();
      }
    };
    eventSource.onerror = () => {
      setError("Connection lost during card upload. Please try again.");
      setProgress(null);
      eventSource.close();
    };
    return () => eventSource.close();
  }, []);

  const pct = progress && progress.total > 0
    ? Math.round((progress.progress / progress.total) * 100)
    : 0;

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-8 w-full max-w-md shadow-2xl">
        {progress && (
          <>
            <div className="flex items-center gap-3 mb-6">
              <Icon icon="mdi:loading" className="animate-spin text-purple-400" width={28} />
              <h2 className="text-xl font-bold">Creating Your Deck</h2>
            </div>
            <p className="text-sm text-gray-300 mb-1">{progress.step}</p>
            <p className="text-xs text-gray-500 mb-4">{progress.detail}</p>
            {progress.total > 0 && (
              <>
                <div className="w-full bg-gray-800 rounded-full h-4 mb-2 overflow-hidden">
                  <div
                    className="bg-purple-600 h-4 rounded-full transition-all duration-300"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="text-xs text-gray-500 text-right">
                  {progress.progress} / {progress.total} cards ({pct}%)
                </p>
              </>
            )}
            <p className="text-xs text-gray-600 mt-6">
              Generating card images and uploading to The Game Crafter...
            </p>
          </>
        )}

        {error && (
          <>
            <div className="flex items-center gap-3 mb-4">
              <Icon icon="mdi:alert-circle" className="text-red-400" width={28} />
              <h2 className="text-xl font-bold">Something Went Wrong</h2>
            </div>
            <p className="text-sm text-red-400 mb-6">{error}</p>
            <Link
              href="/decks"
              className="inline-block px-5 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm font-semibold transition-colors"
            >
              Back to Decks
            </Link>
          </>
        )}

        {cartUrl && (
          <>
            <div className="flex items-center gap-3 mb-4">
              <Icon icon="mdi:check-circle" className="text-green-400" width={28} />
              <h2 className="text-xl font-bold">Ready to Order!</h2>
            </div>
            <p className="text-sm text-gray-400 mb-6">
              Your deck has been created on The Game Crafter and added to your cart.
            </p>
            <div className="flex gap-3">
              <a
                href={cartUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 px-5 py-2.5 bg-purple-600 hover:bg-purple-700 rounded-lg text-sm font-semibold text-center transition-colors"
              >
                Go to Cart
              </a>
              <Link
                href="/decks"
                className="px-5 py-2.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm font-semibold transition-colors"
              >
                Back to Decks
              </Link>
            </div>
          </>
        )}

        {!progress && !error && !cartUrl && (
          <div className="text-center">
            <Icon icon="mdi:loading" className="animate-spin text-gray-500 mx-auto mb-4" width={32} />
            <p className="text-gray-400">Loading...</p>
          </div>
        )}
      </div>
    </div>
  );
}
