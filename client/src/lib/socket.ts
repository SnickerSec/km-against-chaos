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

export function getSocket(): Socket {
  if (!socket) {
    socket = io(SERVER_URL, {
      autoConnect: true,
      auth: { sessionId: getSessionId() },
    });

    // Identify authenticated user on connect/reconnect
    socket.on("connect", () => {
      identifySocket(socket!);
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
      store.setScreen(data.screen);
    });
  }
  return socket;
}

export function identifySocket(s: Socket): void {
  const token = typeof window !== "undefined" ? localStorage.getItem("km-auth-token") : null;
  if (token && s.connected) {
    s.emit("auth:identify", token);
  }
}
