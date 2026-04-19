"use client";

import { useState, useEffect } from "react";
import { Icon } from "@iconify/react";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Check if already dismissed this session
    if (sessionStorage.getItem("pwa-dismissed")) {
      setDismissed(true);
      return;
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  if (!deferredPrompt || dismissed) return null;

  const handleInstall = async () => {
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      setDeferredPrompt(null);
    }
  };

  const handleDismiss = () => {
    setDismissed(true);
    sessionStorage.setItem("pwa-dismissed", "1");
  };

  return (
    <div className="fixed bottom-4 left-4 right-4 z-40 flex justify-center">
      <div className="bg-gray-900 border border-purple-600/50 rounded-xl px-4 py-3 flex items-center gap-3 shadow-xl max-w-sm w-full">
        <Icon icon="mdi:cellphone-arrow-down" className="text-purple-400 shrink-0" width={24} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">Install Decked</p>
          <p className="text-xs text-gray-400">Add to home screen for quick access</p>
        </div>
        <button
          onClick={handleInstall}
          className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 rounded-lg text-xs font-semibold transition-colors shrink-0"
        >
          Install
        </button>
        <button
          onClick={handleDismiss}
          aria-label="Dismiss install prompt"
          className="text-gray-400 hover:text-gray-300 shrink-0"
        >
          <Icon icon="mdi:close" width={16} />
        </button>
      </div>
    </div>
  );
}
