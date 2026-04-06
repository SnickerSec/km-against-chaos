import { describe, it, expect, beforeEach, vi } from "vitest";

// Reset module state between tests so mute persists don't bleed across
beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
});

describe("isMuted", () => {
  it("defaults to false when localStorage is empty", async () => {
    const { isMuted } = await import("../lib/sounds");
    expect(isMuted()).toBe(false);
  });

  it("restores muted=true from localStorage on import", async () => {
    localStorage.setItem("decked_sounds_muted", "true");
    const { isMuted } = await import("../lib/sounds");
    expect(isMuted()).toBe(true);
  });
});

describe("toggleMute", () => {
  it("flips muted state and returns new value", async () => {
    const { isMuted, toggleMute } = await import("../lib/sounds");
    expect(isMuted()).toBe(false);

    const afterFirst = toggleMute();
    expect(afterFirst).toBe(true);
    expect(isMuted()).toBe(true);

    const afterSecond = toggleMute();
    expect(afterSecond).toBe(false);
    expect(isMuted()).toBe(false);
  });

  it("persists state to localStorage", async () => {
    const { toggleMute } = await import("../lib/sounds");
    toggleMute();
    expect(localStorage.getItem("decked_sounds_muted")).toBe("true");
    toggleMute();
    expect(localStorage.getItem("decked_sounds_muted")).toBe("false");
  });
});
