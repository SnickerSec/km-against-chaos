import { API_URL } from "./api";

export type SoundKey =
  | "win" | "lose" | "meta" | "stolen" | "reset"
  | "victory" | "defeat" | "uno" | "draw4" | "skip";

const QUERIES: Record<SoundKey, string> = {
  win:     "airhorn",
  lose:    "sad trombone",
  meta:    "dun dun dun",
  stolen:  "oh no",
  reset:   "noooo",
  victory: "winner winner chicken dinner",
  defeat:  "wah wah wah",
  uno:     "uno",
  draw4:   "evil laugh",
  skip:    "buzzer",
};

const cache = new Map<SoundKey, string>(); // key → mp3 url
let muted = false;
let currentAudio: HTMLAudioElement | null = null;

if (typeof window !== "undefined") {
  muted = localStorage.getItem("decked_sounds_muted") === "true";
}

export function isMuted() { return muted; }

export function toggleMute(): boolean {
  muted = !muted;
  if (typeof window !== "undefined") {
    localStorage.setItem("decked_sounds_muted", String(muted));
    if (muted && currentAudio) {
      currentAudio.pause();
    }
  }
  return muted;
}

async function fetchMp3(key: SoundKey): Promise<string | null> {
  if (cache.has(key)) return cache.get(key)!;
  try {
    const res = await fetch(
      `${API_URL}/api/sounds/search?q=${encodeURIComponent(QUERIES[key])}`
    );
    if (!res.ok) return null;
    const { mp3 } = await res.json();
    if (mp3) { cache.set(key, mp3); return mp3; }
  } catch {}
  return null;
}

export async function preloadSounds() {
  // Fire off all fetches in parallel; errors are silently ignored
  await Promise.allSettled(
    (Object.keys(QUERIES) as SoundKey[]).map(fetchMp3)
  );
}

export async function playSound(key: SoundKey) {
  if (muted || typeof window === "undefined") return;
  const url = await fetchMp3(key);
  if (!url) return;
  try {
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.currentTime = 0;
    }
    currentAudio = new Audio(url);
    currentAudio.volume = 0.7;
    await currentAudio.play();
  } catch {}
}
