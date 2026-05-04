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

/**
 * The URL's ?code=XXXX is "intent" — the user is on a page that says they
 * want to be in lobby XXXX. The server uses this to decide whether to
 * auto-rejoin them on reconnect: a stale session whose URL no longer
 * matches gets dropped (handleLeave) instead of force-restoring them
 * back into the lobby on every page load. Wifi blips still rejoin
 * cleanly because useRoomCodeInUrl keeps ?code=<lobby> in the URL the
 * whole time the user is in a lobby.
 */
function getIntentLobby(): string | null {
  if (typeof window === "undefined") return null;
  return new URL(window.location.href).searchParams.get("code")?.toUpperCase() || null;
}

let socket: Socket | null = null;
let authReady: Promise<void> | null = null;
let resolveAuth: (() => void) | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(SERVER_URL, {
      autoConnect: true,
      // Function form so the URL's ?code= is read fresh on every reconnect
      // attempt, not frozen at first connect — otherwise a wifi-blip
      // recovery would carry stale intent from when the page first loaded.
      auth: (cb) => cb({ sessionId: getSessionId(), intentLobby: getIntentLobby() }),
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

    // Show the "Reconnecting…" banner quickly so the user knows their
    // clicks are going nowhere, but still tolerate very fast reconnects
    // (wifi stutter, backgrounded tab) so the banner doesn't flash on
    // every blip. Arm the banner after a short grace from BOTH signals:
    //   - server_restart (server warns of a deploy just before drop)
    //   - disconnect     (actual socket loss, covers wifi / server kill)
    // The reconnect/connect handler clears the pending timer.
    const RECONNECT_GRACE_MS = 500;
    let restartBannerTimer: ReturnType<typeof setTimeout> | null = null;
    const armRestartBanner = () => {
      if (restartBannerTimer) return; // timer already pending — don't stack
      restartBannerTimer = setTimeout(() => {
        useGameStore.setState({ serverRestarting: true });
        restartBannerTimer = null;
      }, RECONNECT_GRACE_MS);
    };
    const clearRestartBanner = () => {
      if (restartBannerTimer) {
        clearTimeout(restartBannerTimer);
        restartBannerTimer = null;
      }
      useGameStore.setState({ serverRestarting: false });
    };

    socket.on("server_restart" as any, armRestartBanner);
    socket.on("disconnect", armRestartBanner);
    socket.on("reconnect" as any, clearRestartBanner);
    socket.on("connect", clearRestartBanner);

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
