"use client";

import { useEffect, useRef, useState } from "react";
import { useAuthStore, getGoogleClientId } from "@/lib/auth";

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

export default function GoogleSignIn() {
  const { user, loading, login, logout, restore } = useAuthStore();
  const buttonRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const initialized = useRef(false);

  useEffect(() => {
    restore();
  }, [restore]);

  useEffect(() => {
    if (loading || user || initialized.current) return;

    const clientId = getGoogleClientId();
    if (!clientId) return;

    const renderButton = () => {
      if (!window.google || !buttonRef.current || initialized.current) return;
      initialized.current = true;

      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: async (response: { credential: string }) => {
          try {
            setError(null);
            await login(response.credential);
          } catch {
            setError("Sign-in failed. Try again.");
          }
        },
      });

      window.google.accounts.id.renderButton(buttonRef.current, {
        theme: "filled_black",
        size: "medium",
        shape: "pill",
      });
    };

    if (window.google) {
      renderButton();
    } else {
      const check = setInterval(() => {
        if (window.google) {
          clearInterval(check);
          renderButton();
        }
      }, 100);
      return () => clearInterval(check);
    }
  }, [loading, user, login]);

  // Reset initialized when user logs out so button can re-render
  useEffect(() => {
    if (!user && !loading) {
      initialized.current = false;
    }
  }, [user, loading]);

  if (loading) {
    return <div className="h-10 w-32 bg-gray-800 rounded-full animate-pulse" />;
  }

  if (user) {
    return (
      <div className="flex items-center gap-3">
        {user.picture && (
          <img
            src={user.picture}
            alt=""
            className="w-8 h-8 rounded-full"
            referrerPolicy="no-referrer"
          />
        )}
        <span className="text-sm text-gray-300">{user.name}</span>
        <button
          onClick={logout}
          className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
        >
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div>
      <div ref={buttonRef} />
      {error && <p className="text-red-400 text-xs mt-1">{error}</p>}
    </div>
  );
}
