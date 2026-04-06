import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  registerSession,
  unregisterSocket,
  getSocketId,
  getSessionId,
  startDisconnectTimer,
  cancelDisconnectTimer,
  cleanupSession,
} from "../sessions.js";

beforeEach(() => {
  // Clean up known sessions between tests
  for (const sid of ["sess1", "sess2", "sess3"]) {
    cleanupSession(sid);
  }
  vi.useRealTimers();
});

// ── registerSession ──────────────────────────────────────────────────────────

describe("registerSession", () => {
  it("registers a new session", () => {
    const result = registerSession("sess1", "sock1");
    expect(result.isReconnect).toBe(false);
    expect(result.oldSocketId).toBeNull();
    expect(getSocketId("sess1")).toBe("sock1");
    expect(getSessionId("sock1")).toBe("sess1");
  });

  it("detects reconnect when session already has a different socket", () => {
    registerSession("sess1", "sock1");
    const result = registerSession("sess1", "sock2");
    expect(result.isReconnect).toBe(true);
    expect(result.oldSocketId).toBe("sock1");
    // Old socket mapping cleaned up
    expect(getSessionId("sock1")).toBeUndefined();
    // New mapping active
    expect(getSocketId("sess1")).toBe("sock2");
    expect(getSessionId("sock2")).toBe("sess1");
  });

  it("same socket re-registering is not a reconnect", () => {
    registerSession("sess1", "sock1");
    const result = registerSession("sess1", "sock1");
    expect(result.isReconnect).toBe(false);
  });
});

// ── unregisterSocket ─────────────────────────────────────────────────────────

describe("unregisterSocket", () => {
  it("returns session ID for known socket", () => {
    registerSession("sess1", "sock1");
    expect(unregisterSocket("sock1")).toBe("sess1");
  });

  it("returns undefined for unknown socket", () => {
    expect(unregisterSocket("unknown")).toBeUndefined();
  });
});

// ── Disconnect timers ────────────────────────────────────────────────────────

describe("startDisconnectTimer / cancelDisconnectTimer", () => {
  it("fires callback after delay", () => {
    vi.useFakeTimers();
    const cb = vi.fn();
    startDisconnectTimer("sess1", cb, 1000);
    expect(cb).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(cb).toHaveBeenCalledOnce();
  });

  it("cancelling prevents callback", () => {
    vi.useFakeTimers();
    const cb = vi.fn();
    startDisconnectTimer("sess1", cb, 1000);
    const cancelled = cancelDisconnectTimer("sess1");
    expect(cancelled).toBe(true);
    vi.advanceTimersByTime(2000);
    expect(cb).not.toHaveBeenCalled();
  });

  it("cancel returns false when no timer exists", () => {
    expect(cancelDisconnectTimer("sess1")).toBe(false);
  });

  it("starting a new timer replaces the old one", () => {
    vi.useFakeTimers();
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    startDisconnectTimer("sess1", cb1, 1000);
    startDisconnectTimer("sess1", cb2, 1000);
    vi.advanceTimersByTime(1000);
    expect(cb1).not.toHaveBeenCalled();
    expect(cb2).toHaveBeenCalledOnce();
  });
});

// ── cleanupSession ───────────────────────────────────────────────────────────

describe("cleanupSession", () => {
  it("removes all mappings and cancels timer", () => {
    vi.useFakeTimers();
    registerSession("sess1", "sock1");
    const cb = vi.fn();
    startDisconnectTimer("sess1", cb, 5000);

    cleanupSession("sess1");

    expect(getSocketId("sess1")).toBeUndefined();
    expect(getSessionId("sock1")).toBeUndefined();
    vi.advanceTimersByTime(10000);
    expect(cb).not.toHaveBeenCalled();
  });
});
