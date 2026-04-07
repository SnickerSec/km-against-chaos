import { describe, it, expect, beforeEach } from "vitest";
import {
  addChatMessage,
  getChatHistory,
  clearChatHistory,
  getVoiceUsers,
  isAllowedMediaUrl,
} from "../socketHelpers.js";

// ── Chat History ─────────────────────────────────────────────────────────────

describe("chat history", () => {
  const CODE = "test-lobby";

  beforeEach(() => {
    clearChatHistory(CODE);
  });

  it("starts empty", () => {
    expect(getChatHistory(CODE)).toEqual([]);
  });

  it("stores a message", () => {
    addChatMessage(CODE, { id: "m1", playerName: "Alice", text: "hello", timestamp: 1 });
    const history = getChatHistory(CODE);
    expect(history).toHaveLength(1);
    expect(history[0].text).toBe("hello");
  });

  it("preserves message order", () => {
    addChatMessage(CODE, { id: "m1", playerName: "Alice", text: "first", timestamp: 1 });
    addChatMessage(CODE, { id: "m2", playerName: "Bob", text: "second", timestamp: 2 });
    const history = getChatHistory(CODE);
    expect(history[0].text).toBe("first");
    expect(history[1].text).toBe("second");
  });

  it("stores gif URL", () => {
    addChatMessage(CODE, { id: "m1", playerName: "Alice", text: "", gifUrl: "https://example.com/cat.gif", timestamp: 1 });
    expect(getChatHistory(CODE)[0].gifUrl).toBe("https://example.com/cat.gif");
  });

  it("caps at 100 messages", () => {
    for (let i = 0; i < 105; i++) {
      addChatMessage(CODE, { id: `m${i}`, playerName: "Bot", text: `msg ${i}`, timestamp: i });
    }
    const history = getChatHistory(CODE);
    expect(history).toHaveLength(100);
    // Oldest messages should have been dropped
    expect(history[0].text).toBe("msg 5");
    expect(history[99].text).toBe("msg 104");
  });

  it("clearChatHistory removes all messages", () => {
    addChatMessage(CODE, { id: "m1", playerName: "Alice", text: "hello", timestamp: 1 });
    clearChatHistory(CODE);
    expect(getChatHistory(CODE)).toEqual([]);
  });

  it("lobbies have independent history", () => {
    addChatMessage("lobby-a", { id: "m1", playerName: "Alice", text: "a-msg", timestamp: 1 });
    addChatMessage("lobby-b", { id: "m2", playerName: "Bob", text: "b-msg", timestamp: 1 });
    expect(getChatHistory("lobby-a")).toHaveLength(1);
    expect(getChatHistory("lobby-b")).toHaveLength(1);
    expect(getChatHistory("lobby-a")[0].text).toBe("a-msg");
    clearChatHistory("lobby-a");
    clearChatHistory("lobby-b");
  });
});

// ── Voice Chat State ─────────────────────────────────────────────────────────

describe("voice users", () => {
  it("returns empty set for new lobby", () => {
    const users = getVoiceUsers("voice-test");
    expect(users.size).toBe(0);
  });

  it("returns same set instance on repeated calls", () => {
    const a = getVoiceUsers("voice-test-2");
    const b = getVoiceUsers("voice-test-2");
    expect(a).toBe(b);
  });

  it("can add users to the returned set", () => {
    const users = getVoiceUsers("voice-test-3");
    users.add("socket-1");
    users.add("socket-2");
    expect(getVoiceUsers("voice-test-3").size).toBe(2);
    // cleanup
    users.clear();
  });
});

// ── Allowed Media URLs ───────────────────────────────────────────────────────

describe("isAllowedMediaUrl", () => {
  it("allows giphy media URLs", () => {
    expect(isAllowedMediaUrl("https://media.giphy.com/media/abc/giphy.gif")).toBe(true);
    expect(isAllowedMediaUrl("https://media0.giphy.com/media/abc/giphy.gif")).toBe(true);
    expect(isAllowedMediaUrl("https://media4.giphy.com/media/abc/giphy.gif")).toBe(true);
  });

  it("allows tenor media URLs", () => {
    expect(isAllowedMediaUrl("https://media.tenor.com/abc.gif")).toBe(true);
    expect(isAllowedMediaUrl("https://c.tenor.com/abc.gif")).toBe(true);
  });

  it("allows klipy URLs", () => {
    expect(isAllowedMediaUrl("https://static.klipy.com/abc.gif")).toBe(true);
  });

  it("allows http variant", () => {
    expect(isAllowedMediaUrl("http://media.giphy.com/media/abc/giphy.gif")).toBe(true);
  });

  it("rejects unknown hosts", () => {
    expect(isAllowedMediaUrl("https://evil.com/malware.gif")).toBe(false);
    expect(isAllowedMediaUrl("https://giphy.com/media/abc/giphy.gif")).toBe(false); // missing media. subdomain
    expect(isAllowedMediaUrl("https://notgiphy.media.giphy.com/abc.gif")).toBe(false);
  });

  it("rejects non-http protocols", () => {
    expect(isAllowedMediaUrl("ftp://media.giphy.com/abc.gif")).toBe(false);
    expect(isAllowedMediaUrl("javascript:alert(1)")).toBe(false);
  });

  it("rejects invalid URLs", () => {
    expect(isAllowedMediaUrl("not a url")).toBe(false);
    expect(isAllowedMediaUrl("")).toBe(false);
  });
});
