"use client";

import { io, Socket } from "socket.io-client";

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL || (typeof window !== "undefined" && window.location.hostname !== "localhost" ? window.location.origin : "http://localhost:3001");

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(SERVER_URL, {
      autoConnect: true,
    });
  }
  return socket;
}
