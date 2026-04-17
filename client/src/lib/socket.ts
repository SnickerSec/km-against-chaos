"use client";

import { io, Socket } from "socket.io-client";
import { useGameStore } from "./store";

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL || (typeof window !== "undefined" && window.location.hostname !== "localhost" ? window.location.origin : "http://localhost:3001");

function getSessionId(): string {
  if (typeof window === "undefined") return "";
  let sessionId = localStorage.getItem("km-session-id");
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    localStorage.setItem("km-session-id", sessionId);
  }
  return sessionId;
}

let socket: Socket | null = null;
let authReady: Promise<void> | null = null;
let resolveAuth: (() => void) | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(SERVER_URL, {
      autoConnect: true,
      auth: { sessionId: getSessionId() },
      // WebSocket-only. Socket.IO's polling fallback requires sticky
      // sessions (sid from the handshake POST has to route back to the
      // same replica), which Railway doesn't provide. Going straight to
      // WebSocket means each connection is a single TCP stream to one
      // replica, sticky by construction. The Redis adapter handles
      // cross-replica broadcasting; we don't need polling.
      transports: ["websocket"],
      // Retry fast on the first attempt so typical Railway redeploys
      // (~500ms gap once the new container is healthy) reconnect before
      // the restart banner timer fires.
      reconnectionDelay: 250,
      reconnectionDelayMax: 5000,
    });

    // Identify authenticated user on connect/reconnect
    socket.on("connect", () => {
      identifySocket(socket!);
    });

    // Don't flash the restart banner for fast reconnects: server_restart
    // only arms a timer, and the reconnect handler cancels it. If the
    // reconnect lands within 2s the user sees nothing at all.
    let restartBannerTimer: ReturnType<typeof setTimeout> | null = null;
    socket.on("server_restart" as any, () => {
      if (restartBannerTimer) clearTimeout(restartBannerTimer);
      restartBannerTimer = setTimeout(() => {
        useGameStore.setState({ serverRestarting: true });
        restartBannerTimer = null;
      }, 2000);
    });

    socket.on("reconnect" as any, () => {
      if (restartBannerTimer) {
        clearTimeout(restartBannerTimer);
        restartBannerTimer = null;
      }
      useGameStore.setState({ serverRestarting: false });
    });

    // Session reconnection — must be registered at socket creation time
    // (before any useEffect runs) to avoid missing the event on page refresh
    socket.on("session:reconnected" as any, (data: any) => {
      const store = useGameStore.getState();
      store.setLobby(data.lobby);
      if (data.gameView) {
        store.setGameView(data.gameView);
      }
      if (data.chatHistory?.length) {
        useGameStore.setState({ chatMessages: data.chatHistory });
      }
      // Don't set screen to "game" if we have no game view — fall back to lobby
      const screen = (data.screen === "game" && !data.gameView) ? "lobby" : data.screen;
      store.setScreen(screen);
    });
  }
  return socket;
}

export function identifySocket(s: Socket): void {
  const token = typeof window !== "undefined" ? localStorage.getItem("km-auth-token") : null;
  if (token && s.connected) {
    authReady = new Promise<void>((resolve) => { resolveAuth = resolve; });
    s.emit("auth:identify" as any, token, () => {
      resolveAuth?.();
    });
  } else {
    // No token — resolve immediately so callers don't hang
    authReady = Promise.resolve();
  }
}

/** Wait until the socket has been identified with the server (or resolve immediately if no auth). */
export function waitForAuth(): Promise<void> {
  return authReady || Promise.resolve();
}
