"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Icon } from "@iconify/react";
import { useAuthStore, getGoogleClientId } from "@/lib/auth";
import NotificationBell from "./NotificationBell";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: any) => void;
          renderButton: (element: HTMLElement, config: any) => void;
        };
      };
    };
  }
}

function ProfileDropdown({ user, onLogout }: { user: { name: string; picture?: string }; onLogout: () => void }) {
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
        aria-label={`Account menu for ${user.name}`}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-1 rounded-full hover:ring-2 hover:ring-gray-600 transition-all"
      >
        {user.picture ? (
          <img
            src={user.picture}
            alt=""
            className="w-8 h-8 rounded-full"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center text-gray-300 text-sm font-bold">
            {user.name.charAt(0).toUpperCase()}
          </div>
        )}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-48 bg-gray-800 border border-gray-700 rounded-lg shadow-xl py-1 z-50">
          <div className="px-3 py-2 border-b border-gray-700">
            <p className="text-sm font-medium text-white truncate">{user.name}</p>
          </div>
          <Link
            href="/decks"
            onClick={() => setOpen(false)}
            className="block px-3 py-2 text-sm text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
          >
            Manage Decks
          </Link>
          <Link
            href="/friends"
            onClick={() => setOpen(false)}
            className="block px-3 py-2 text-sm text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
          >
            Friends
          </Link>
          <Link
            href="/stats"
            onClick={() => setOpen(false)}
            className="block px-3 py-2 text-sm text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
          >
            Stats
          </Link>
          <button
            onClick={() => { setOpen(false); onLogout(); }}
            className="w-full text-left px-3 py-2 text-sm text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

let gsiInitialized = false;
let gsiCallback: ((credential: string) => void) | null = null;
let gsiLoadPromise: Promise<void> | null = null;

function loadGsiScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.google) return Promise.resolve();
  if (gsiLoadPromise) return gsiLoadPromise;
  gsiLoadPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Google Sign-In script"));
    document.head.appendChild(script);
  });
  return gsiLoadPromise;
}

export default function GoogleSignIn() {
  const { user, loading, login, logout, restore } = useAuthStore();
  const googleSlotRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  useEffect(() => {
    restore();
  }, [restore]);

  // Full defer: GSI script is NOT loaded on mount. First render shows our own
  // button. When the user clicks it we fetch the Google script, initialize,
  // render Google's official sign-in button into a hidden slot, and
  // programmatically dispatch a click on it — which triggers the real flow.
  // Saves ~96 KB transfer / ~258 KB raw on every unauth page load.
  const handleSignInClick = async () => {
    const clientId = getGoogleClientId();
    if (!clientId) { setError("Sign-in not configured"); return; }
    if (signingIn) return;
    setSigningIn(true);
    setError(null);

    gsiCallback = async (credential: string) => {
      try {
        await login(credential);
      } catch {
        setError("Sign-in failed. Try again.");
        setSigningIn(false);
      }
    };

    try {
      await loadGsiScript();
      if (!window.google || !googleSlotRef.current) throw new Error("gsi unavailable");

      if (!gsiInitialized) {
        gsiInitialized = true;
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: (response: { credential: string }) => gsiCallback?.(response.credential),
        });
      }

      // Render Google's button into a hidden slot, then click it. The GSI
      // iframe takes a tick to mount — poll briefly for the clickable child.
      const slot = googleSlotRef.current;
      while (slot.firstChild) slot.removeChild(slot.firstChild);
      window.google.accounts.id.renderButton(slot, {
        theme: "filled_black",
        size: "large",
        shape: "rectangular",
      });

      const start = Date.now();
      const tryClick = () => {
        const target = googleSlotRef.current?.querySelector<HTMLElement>('[role="button"], button, iframe');
        if (target) {
          target.click();
          return;
        }
        if (Date.now() - start > 2000) {
          setError("Sign-in didn't open. Try again.");
          setSigningIn(false);
          return;
        }
        setTimeout(tryClick, 60);
      };
      setTimeout(tryClick, 120);
    } catch {
      setError("Couldn't load Google Sign-In. Try again.");
      setSigningIn(false);
    }
  };

  if (loading) {
    return <div className="h-10 w-32 bg-gray-800 rounded-full animate-pulse" />;
  }

  if (user) {
    return (
      <div className="flex items-center gap-2">
        <NotificationBell />
        <ProfileDropdown user={user} onLogout={logout} />
      </div>
    );
  }

  return (
    <div>
      <button
        onClick={handleSignInClick}
        disabled={signingIn}
        className="inline-flex items-center gap-2 px-4 py-2 bg-gray-900 hover:bg-gray-800 border border-gray-700 rounded-full text-sm font-medium text-white transition-colors disabled:opacity-70 disabled:cursor-progress"
      >
        <Icon icon="logos:google-icon" width={16} aria-hidden />
        {signingIn ? "Opening…" : "Sign in"}
      </button>
      {/* Hidden slot where Google's branded button gets rendered after load
          so we can programmatically click it. Absolutely positioned off-
          screen to avoid layout impact. */}
      <div ref={googleSlotRef} className="fixed -left-[9999px] top-0" aria-hidden />
      {error && <p className="text-red-400 text-xs mt-1">{error}</p>}
    </div>
  );
}
