"use client";

import { create } from "zustand";

export interface Presence {
  status: "online" | "in_game" | "offline";
  lobbyCode?: string;
  deckName?: string;
}

export interface Friend {
  id: string;
  name: string;
  picture: string;
  last_seen: string | null;
  friendship_id: string;
  status: string;
  direction: string;
  created_at: string;
  nickname: string | null;
  presence: Presence;
}

export interface GameInvite {
  id: string;
  fromUserId: string;
  fromName: string;
  lobbyCode: string;
  deckName: string;
  gameType: string;
  timestamp: number;
}

export interface DirectMessage {
  id: string;
  sender_id: string;
  senderName?: string;
  receiver_id: string;
  content: string;
  created_at: string;
  read_at: string | null;
}

export interface Notification {
  id: string;
  type: string;
  data: any;
  read: boolean;
  created_at: string;
}

interface FriendsState {
  friends: Friend[];
  invites: GameInvite[];
  notifications: Notification[];
  unreadCounts: Record<string, number>;
  dmOpen: string | null; // friendId if DM panel is open

  setFriends: (friends: Friend[]) => void;
  updatePresence: (userId: string, presence: Partial<Presence>) => void;
  setUserOnline: (userId: string) => void;
  setUserOffline: (userId: string) => void;

  addInvite: (invite: GameInvite) => void;
  removeInvite: (id: string) => void;

  setNotifications: (notifications: Notification[]) => void;
  addNotification: (n: Notification) => void;
  markNotificationRead: (id: string) => void;

  setUnreadCounts: (counts: Record<string, number>) => void;
  incrementUnread: (userId: string) => void;
  clearUnread: (userId: string) => void;

  setDmOpen: (friendId: string | null) => void;
}

export const useFriendsStore = create<FriendsState>((set) => ({
  friends: [],
  invites: [],
  notifications: [],
  unreadCounts: {},
  dmOpen: null,

  setFriends: (friends) => set({ friends }),

  updatePresence: (userId, presence) =>
    set((s) => ({
      friends: s.friends.map((f) =>
        f.id === userId ? { ...f, presence: { ...f.presence, ...presence } } : f
      ),
    })),

  setUserOnline: (userId) =>
    set((s) => ({
      friends: s.friends.map((f) =>
        f.id === userId ? { ...f, presence: { ...f.presence, status: "online" } } : f
      ),
    })),

  setUserOffline: (userId) =>
    set((s) => ({
      friends: s.friends.map((f) =>
        f.id === userId
          ? { ...f, presence: { status: "offline" }, last_seen: new Date().toISOString() }
          : f
      ),
    })),

  addInvite: (invite) =>
    set((s) => ({ invites: [invite, ...s.invites.filter((i) => i.lobbyCode !== invite.lobbyCode)] })),

  removeInvite: (id) =>
    set((s) => ({ invites: s.invites.filter((i) => i.id !== id) })),

  setNotifications: (notifications) => set({ notifications }),
  addNotification: (n) => set((s) => ({ notifications: [n, ...s.notifications] })),
  markNotificationRead: (id) =>
    set((s) => ({
      notifications: s.notifications.map((n) => (n.id === id ? { ...n, read: true } : n)),
    })),

  setUnreadCounts: (counts) => set({ unreadCounts: counts }),
  incrementUnread: (userId) =>
    set((s) => ({
      unreadCounts: { ...s.unreadCounts, [userId]: (s.unreadCounts[userId] || 0) + 1 },
    })),
  clearUnread: (userId) =>
    set((s) => {
      const counts = { ...s.unreadCounts };
      delete counts[userId];
      return { unreadCounts: counts };
    }),

  setDmOpen: (friendId) => set({ dmOpen: friendId }),
}));
