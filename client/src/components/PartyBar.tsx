"use client";

import { useState } from "react";
import { usePartyStore } from "@/lib/partyStore";
import { useAuthStore } from "@/lib/auth";
import { getSocket } from "@/lib/socket";

export default function PartyBar() {
  const user = useAuthStore((s) => s.user);
  const { party, setParty, invites, removeInvite } = usePartyStore();
  const [showDeckPicker, setShowDeckPicker] = useState(false);

  if (!user) return null;

  const socket = getSocket();
  const isLeader = party?.leaderId === user.id;

  const handleLeave = () => {
    socket.emit("party:leave" as any, () => {
      setParty(null);
    });
  };

  const handleAcceptInvite = (partyId: string) => {
    socket.emit("party:join" as any, partyId, (res: any) => {
      if (res.success) {
        setParty(res.party);
      }
    });
    removeInvite(partyId);
  };

  // Party invite toasts
  if (!party && invites.length > 0) {
    return (
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 space-y-2">
        {invites.map((inv) => (
          <div key={inv.partyId} className="bg-gray-800 border border-gray-700 rounded-lg shadow-xl px-4 py-3 flex items-center gap-3">
            <p className="text-sm text-white">{inv.fromName} invited you to a party</p>
            <button
              onClick={() => handleAcceptInvite(inv.partyId)}
              className="px-3 py-1 bg-purple-600 hover:bg-purple-700 rounded text-xs font-medium transition-colors"
            >
              Join
            </button>
            <button
              onClick={() => removeInvite(inv.partyId)}
              className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs font-medium text-gray-300 transition-colors"
            >
              Decline
            </button>
          </div>
        ))}
      </div>
    );
  }

  if (!party) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-gray-900 border-t border-gray-700 px-4 py-2">
      <div className="max-w-2xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xs text-purple-400 font-semibold uppercase">Party</span>
          <div className="flex -space-x-2">
            {party.members.map((m) => (
              <div key={m.userId} className="relative" title={m.name}>
                {m.picture ? (
                  <img src={m.picture} alt="" className="w-7 h-7 rounded-full border-2 border-gray-900" referrerPolicy="no-referrer" />
                ) : (
                  <div className="w-7 h-7 rounded-full border-2 border-gray-900 bg-gray-700 flex items-center justify-center text-xs font-bold text-gray-400">
                    {m.name[0]}
                  </div>
                )}
                {m.userId === party.leaderId && (
                  <span className="absolute -top-1 -right-1 text-[8px] bg-purple-600 rounded-full w-3 h-3 flex items-center justify-center">L</span>
                )}
              </div>
            ))}
          </div>
          <span className="text-xs text-gray-500">{party.members.length} member{party.members.length !== 1 ? "s" : ""}</span>
        </div>
        <div className="flex items-center gap-2">
          {isLeader && (
            <button
              onClick={() => {
                // Navigate to home to pick a deck — the party:start-game is triggered from HomeScreen
                window.location.href = "/?party=true";
              }}
              className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 rounded text-xs font-medium transition-colors"
            >
              Start Game
            </button>
          )}
          <button
            onClick={handleLeave}
            className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-xs font-medium text-red-400 transition-colors"
          >
            Leave Party
          </button>
        </div>
      </div>
    </div>
  );
}
