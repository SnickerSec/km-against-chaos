"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useFriendsStore } from "@/lib/friendsStore";

export default function InviteToast() {
  const { invites, removeInvite } = useFriendsStore();

  // Auto-dismiss after 30 seconds
  useEffect(() => {
    if (invites.length === 0) return;
    const timers = invites.map((inv) =>
      setTimeout(() => removeInvite(inv.id), 30000)
    );
    return () => timers.forEach(clearTimeout);
  }, [invites, removeInvite]);

  if (invites.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-[100] space-y-2 max-w-sm">
      {invites.map((inv) => (
        <div
          key={inv.id}
          className="bg-gray-800 border border-gray-700 rounded-lg shadow-xl p-4 animate-in slide-in-from-right"
        >
          <p className="text-sm font-medium text-white mb-1">
            {inv.fromName} invited you to play
          </p>
          <p className="text-xs text-gray-400 mb-3">{inv.deckName}</p>
          <div className="flex gap-2">
            <Link
              href={`/?code=${inv.lobbyCode}&autojoin=1`}
              onClick={() => removeInvite(inv.id)}
              className="flex-1 text-center py-1.5 bg-purple-600 hover:bg-purple-700 rounded text-xs font-medium transition-colors"
            >
              Join Game
            </Link>
            <button
              onClick={() => removeInvite(inv.id)}
              className="flex-1 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-xs font-medium text-gray-300 transition-colors"
            >
              Decline
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
