import { create } from "zustand";
import * as Sentry from "@sentry/nextjs";
import { getSocket, identifySocket } from "./socket";

const API_URL =
  process.env.NEXT_PUBLIC_SERVER_URL ||
  (typeof window !== "undefined" && window.location.hostname !== "localhost"
    ? ""
    : "http://localhost:3001");

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  picture: string;
  role?: string | null;
}

interface AuthState {
  user: AuthUser | null;
  token: string | null;
  isAdmin: boolean;
  isModerator: boolean;
  loading: boolean;
  login: (credential: string) => Promise<void>;
  logout: () => void;
  restore: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: null,
  isAdmin: false,
  isModerator: false,
  loading: true,

  login: async (credential: string) => {
    const res = await fetch(`${API_URL}/api/auth/google`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credential }),
    });
    if (!res.ok) throw new Error("Authentication failed");
    const { token, user, isAdmin, role } = await res.json();
    localStorage.setItem("km-auth-token", token);
    const userWithRole = { ...user, role: role ?? null };
    set({ token, user: userWithRole, isAdmin: !!isAdmin, isModerator: role === "moderator", loading: false });
    Sentry.setUser({ id: userWithRole.id, email: userWithRole.email, username: userWithRole.name });
    // Identify socket with new auth
    identifySocket(getSocket());
  },

  logout: () => {
    localStorage.removeItem("km-auth-token");
    set({ user: null, token: null, isAdmin: false, isModerator: false, loading: false });
    Sentry.setUser(null);
  },

  restore: async () => {
    const token = localStorage.getItem("km-auth-token");
    if (!token) {
      set({ loading: false });
      return;
    }
    try {
      const res = await fetch(`${API_URL}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error();
      const { user, isAdmin, role } = await res.json();
      const userWithRole = { ...user, role: role ?? null };
      set({ token, user: userWithRole, isAdmin: !!isAdmin, isModerator: role === "moderator", loading: false });
      Sentry.setUser({ id: userWithRole.id, email: userWithRole.email, username: userWithRole.name });
    } catch {
      localStorage.removeItem("km-auth-token");
      set({ loading: false });
    }
  },
}));

export function getAuthHeaders(): Record<string, string> {
  const token = useAuthStore.getState().token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function getGoogleClientId(): string {
  return GOOGLE_CLIENT_ID;
}
