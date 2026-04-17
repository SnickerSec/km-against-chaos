import { Router } from "express";
import { createHash } from "crypto";
import { createLogger } from "./logger.js";
import { putObject, hasObject, urlFor } from "./storage.js";

const log = createLogger("tts");
const router = Router();

const DEFAULT_VOICE = "21m00Tcm4TlvDq8ikWAM"; // Rachel
const MAX_TEXT = 500;

// Curated ElevenLabs pre-made voice catalog
const VOICES: { id: string; name: string; description: string }[] = [
  { id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel", description: "Calm, narrator" },
  { id: "AZnzlk1XvdvUeBnXmlld", name: "Domi", description: "Strong, confident" },
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Bella", description: "Soft, friendly" },
  { id: "ErXwobaYiN019PkySvjV", name: "Antoni", description: "Warm, casual" },
  { id: "MF3mGyEYCl7XYWbV9V6O", name: "Elli", description: "Emotional, youthful" },
  { id: "TxGEqnHWrfWFTfGW9XjX", name: "Josh", description: "Deep, serious" },
  { id: "VR6AewLTigWG4xSOukaG", name: "Arnold", description: "Crisp, assertive" },
  { id: "pNInz6obpgDQGcFmaJgB", name: "Adam", description: "Deep, narrator" },
  { id: "yoZ06aMxZJJ28mfd3POQ", name: "Sam", description: "Dynamic, storyteller" },
  { id: "onwK4e9ZLuTAKqWW03F9", name: "Daniel", description: "British, authoritative" },
];
const VALID_VOICE_IDS = new Set(VOICES.map((v) => v.id));

router.get("/voices", (_req, res) => {
  res.json({ voices: VOICES, defaultVoice: DEFAULT_VOICE });
});

router.use((req, res, next) => {
  if (req.headers["content-type"]?.includes("application/json")) {
    let body = "";
    req.on("data", (c: Buffer) => { body += c; });
    req.on("end", () => {
      try { (req as any).body = JSON.parse(body); } catch { (req as any).body = {}; }
      next();
    });
  } else { (req as any).body = {}; next(); }
});

router.post("/speak", async (req, res) => {
  if (!process.env.ELEVENLABS_API_KEY) {
    res.status(503).json({ error: "TTS not configured" }); return;
  }
  const body = (req as any).body || {};
  const rawText = typeof body.text === "string" ? body.text.trim() : "";
  const requestedVoice = typeof body.voice === "string" ? body.voice : "";
  const voice = VALID_VOICE_IDS.has(requestedVoice) ? requestedVoice : DEFAULT_VOICE;
  if (!rawText) { res.status(400).json({ error: "text required" }); return; }
  const text = rawText.slice(0, MAX_TEXT);

  const hash = createHash("sha1").update(`${voice}:${text}`).digest("hex").slice(0, 24);
  const filename = `${hash}.mp3`;
  const key = `tts/${filename}`;

  // Cache hit — the key is content-addressable (hash of voice+text) so the
  // object for a given voice/text never changes. Return the URL directly.
  if (await hasObject(key)) {
    res.json({ url: urlFor(key), cached: true }); return;
  }

  try {
    const apiRes = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_64`,
      {
        method: "POST",
        headers: {
          "xi-api-key": process.env.ELEVENLABS_API_KEY,
          "Content-Type": "application/json",
          "Accept": "audio/mpeg",
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_flash_v2_5",
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
      },
    );
    if (!apiRes.ok) {
      const err = await apiRes.text();
      log.error("elevenlabs failed", { status: apiRes.status, err: err.slice(0, 200) });
      res.status(502).json({ error: "TTS upstream failed" }); return;
    }
    const buf = Buffer.from(await apiRes.arrayBuffer());
    const url = await putObject(key, buf, "audio/mpeg");
    res.json({ url, cached: false });
  } catch (e: any) {
    log.error("tts generation failed", { error: e.message });
    res.status(500).json({ error: "TTS failed" });
  }
});

export default router;
