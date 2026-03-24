// Session management: maps persistent session IDs to transient socket IDs
// so players can reconnect after a page refresh within a grace period.

const GRACE_PERIOD_MS = 120_000; // 2 minutes — mobile browsers kill sockets when backgrounded

// sessionId -> current socketId
const sessionToSocket = new Map<string, string>();
// socketId -> sessionId
const socketToSession = new Map<string, string>();
// sessionId -> pending cleanup timer
const disconnectTimers = new Map<string, NodeJS.Timeout>();

export function registerSession(
  sessionId: string,
  socketId: string
): { isReconnect: boolean; oldSocketId: string | null } {
  const oldSocketId = sessionToSocket.get(sessionId) ?? null;
  const isReconnect = oldSocketId !== null && oldSocketId !== socketId;

  // Clean up old socket mapping
  if (oldSocketId) {
    socketToSession.delete(oldSocketId);
  }

  sessionToSocket.set(sessionId, socketId);
  socketToSession.set(socketId, sessionId);

  return { isReconnect, oldSocketId };
}

export function unregisterSocket(socketId: string): string | undefined {
  return socketToSession.get(socketId);
}

export function getSocketId(sessionId: string): string | undefined {
  return sessionToSocket.get(sessionId);
}

export function getSessionId(socketId: string): string | undefined {
  return socketToSession.get(socketId);
}

export function startDisconnectTimer(
  sessionId: string,
  callback: () => void,
  delayMs: number = GRACE_PERIOD_MS
): void {
  // Clear any existing timer first
  cancelDisconnectTimer(sessionId);
  const timer = setTimeout(() => {
    disconnectTimers.delete(sessionId);
    callback();
  }, delayMs);
  disconnectTimers.set(sessionId, timer);
}

export function cancelDisconnectTimer(sessionId: string): boolean {
  const timer = disconnectTimers.get(sessionId);
  if (timer) {
    clearTimeout(timer);
    disconnectTimers.delete(sessionId);
    return true;
  }
  return false;
}

export function cleanupSession(sessionId: string): void {
  const socketId = sessionToSocket.get(sessionId);
  if (socketId) {
    socketToSession.delete(socketId);
  }
  sessionToSocket.delete(sessionId);
  cancelDisconnectTimer(sessionId);
}
