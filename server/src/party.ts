// In-memory party management — ephemeral groups that persist until disbanded or all members leave.

import { randomBytes } from "crypto";

export interface PartyMember {
  userId: string;
  socketId: string;
  name: string;
  picture?: string;
}

export interface Party {
  id: string;
  leaderId: string;
  members: Map<string, PartyMember>; // userId -> member
  createdAt: Date;
}

export interface PartyState {
  id: string;
  leaderId: string;
  members: { userId: string; name: string; picture?: string }[];
}

const parties = new Map<string, Party>();
const userParty = new Map<string, string>(); // userId -> partyId

function partyToState(party: Party): PartyState {
  return {
    id: party.id,
    leaderId: party.leaderId,
    members: Array.from(party.members.values()).map(m => ({
      userId: m.userId,
      name: m.name,
      picture: m.picture,
    })),
  };
}

export function createParty(userId: string, socketId: string, name: string, picture?: string): PartyState | { error: string } {
  if (userParty.has(userId)) return { error: "You are already in a party" };

  const id = randomBytes(4).toString("hex");
  const member: PartyMember = { userId, socketId, name, picture };
  const party: Party = {
    id,
    leaderId: userId,
    members: new Map([[userId, member]]),
    createdAt: new Date(),
  };

  parties.set(id, party);
  userParty.set(userId, id);
  return partyToState(party);
}

export function joinParty(partyId: string, userId: string, socketId: string, name: string, picture?: string): PartyState | { error: string } {
  if (userParty.has(userId)) return { error: "You are already in a party" };

  const party = parties.get(partyId);
  if (!party) return { error: "Party not found" };
  if (party.members.size >= 10) return { error: "Party is full" };

  party.members.set(userId, { userId, socketId, name, picture });
  userParty.set(userId, partyId);
  return partyToState(party);
}

export function leaveParty(userId: string): { partyId: string; party: PartyState | null; disbanded: boolean } | { error: string } {
  const partyId = userParty.get(userId);
  if (!partyId) return { error: "You are not in a party" };

  const party = parties.get(partyId);
  if (!party) {
    userParty.delete(userId);
    return { error: "Party not found" };
  }

  party.members.delete(userId);
  userParty.delete(userId);

  if (party.members.size === 0) {
    parties.delete(partyId);
    return { partyId, party: null, disbanded: true };
  }

  // Transfer leadership if leader left
  if (party.leaderId === userId) {
    const firstMember = party.members.values().next().value;
    if (firstMember) party.leaderId = firstMember.userId;
  }

  return { partyId, party: partyToState(party), disbanded: false };
}

export function getPartyForUser(userId: string): PartyState | null {
  const partyId = userParty.get(userId);
  if (!partyId) return null;
  const party = parties.get(partyId);
  if (!party) return null;
  return partyToState(party);
}

export function getPartyMembers(partyId: string): PartyMember[] {
  const party = parties.get(partyId);
  if (!party) return [];
  return Array.from(party.members.values());
}

export function getPartySocketRoom(partyId: string): string {
  return `party:${partyId}`;
}

export function remapPartySocket(userId: string, newSocketId: string): void {
  const partyId = userParty.get(userId);
  if (!partyId) return;
  const party = parties.get(partyId);
  if (!party) return;
  const member = party.members.get(userId);
  if (member) member.socketId = newSocketId;
}

export function isInParty(userId: string): boolean {
  return userParty.has(userId);
}
