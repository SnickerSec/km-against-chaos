const BASE = "https://www.myinstants.com/media/sounds";

export type SoundKey =
  | "win" | "lose" | "meta" | "stolen" | "reset"
  | "victory" | "defeat" | "uno" | "draw4" | "skip";

export const SOUND_META: Record<SoundKey, { label: string; description: string }> = {
  win:     { label: "Win a Round",     description: "Plays when you win a round" },
  lose:    { label: "Lose a Round",    description: "Plays when someone else wins a round" },
  victory: { label: "Win the Game",    description: "Plays when you win the whole game" },
  defeat:  { label: "Lose the Game",   description: "Plays when you lose the whole game" },
  meta:    { label: "Meta Card",       description: "Plays when a meta card triggers" },
  stolen:  { label: "Points Stolen",   description: "Plays when your points are stolen by a meta card" },
  reset:   { label: "Hand Reset",      description: "Plays when your hand gets reset by a meta card" },
  uno:     { label: "UNO Called",      description: "Plays when someone calls UNO!" },
  draw4:   { label: "Wild Draw Four",  description: "Plays when a wild draw four is played" },
  skip:    { label: "Skip Card",       description: "Plays when a skip card is played" },
};

// Which sound slots are meaningful for which game types. Keyed by the DeckForm's
// local gameType values (hyphenated) so the form can filter the list.
export const SOUNDS_BY_GAME_TYPE: Record<string, SoundKey[]> = {
  "cards-against-humanity": ["win", "lose", "victory", "defeat", "meta", "stolen", "reset"],
  "joking-hazard":          ["win", "lose", "victory", "defeat", "meta", "stolen", "reset"],
  "apples-to-apples":       ["win", "lose", "victory", "defeat", "meta", "stolen", "reset"],
  "superfight":             ["win", "lose", "victory", "defeat", "meta", "stolen", "reset"],
  "uno":                    ["win", "lose", "victory", "defeat", "uno", "draw4", "skip"],
  "codenames":              ["win", "lose", "victory", "defeat"],
  "blackjack":              ["win", "lose", "victory", "defeat"],
};

const URLS: Record<SoundKey, string> = {
  win:     `${BASE}/dj-airhorn-sound-effect-kingbeatz_1.mp3`,
  lose:    `${BASE}/sad-trombone-sound-effect-wah-wah-wah-fail-sound-fail-horns.mp3`,
  meta:    `${BASE}/dun-dun-dun-sound-effect-brass_8nFBccR.mp3`,
  stolen:  `${BASE}/the-price-is-right-losing-horn.mp3`,
  reset:   `${BASE}/nooo.swf.mp3`,
  victory: `${BASE}/final-fantasy-vii-victory-fanfare-1.mp3`,
  defeat:  `${BASE}/dark-souls-you-died-sound-effect_hm5sYFG.mp3`,
  uno:     `${BASE}/uno-reverse-biaatch.mp3`,
  draw4:   `${BASE}/evillaugh.swf.mp3`,
  skip:    `${BASE}/wrong-answer-buzzer.mp3`,
};

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
    if (muted && currentAudio) currentAudio.pause();
  }
  return muted;
}

// Preload by creating Audio objects (browser caches them)
export function preloadSounds() {
  if (typeof window === "undefined") return;
  Object.values(URLS).forEach((url) => { new Audio(url); });
}

export async function playUrl(url: string) {
  if (muted || typeof window === "undefined") return;
  try {
    if (currentAudio) { currentAudio.pause(); currentAudio.currentTime = 0; }
    currentAudio = new Audio(url);
    currentAudio.volume = 0.7;
    await currentAudio.play();
  } catch {}
}

export async function playSound(key: SoundKey) {
  if (muted || typeof window === "undefined") return;
  try {
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.currentTime = 0;
    }
    currentAudio = new Audio(URLS[key]);
    currentAudio.volume = 0.7;
    await currentAudio.play();
  } catch {}
}
