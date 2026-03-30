"use client";

import { create } from "zustand";

export interface PartyMember {
  userId: string;
  name: string;
  picture?: string;
}

export interface PartyState {
  id: string;
  leaderId: string;
  members: PartyMember[];
}

export interface PartyInvite {
  partyId: string;
  fromName: string;
  fromUserId: string;
  timestamp: number;
}

interface PartyStore {
  party: PartyState | null;
  invites: PartyInvite[];

  setParty: (party: PartyState | null) => void;
  addInvite: (invite: PartyInvite) => void;
  removeInvite: (partyId: string) => void;
}

export const usePartyStore = create<PartyStore>((set) => ({
  party: null,
  invites: [],

  setParty: (party) => set({ party }),
  addInvite: (invite) =>
    set((s) => ({ invites: [invite, ...s.invites.filter((i) => i.partyId !== invite.partyId)] })),
  removeInvite: (partyId) =>
    set((s) => ({ invites: s.invites.filter((i) => i.partyId !== partyId) })),
}));
