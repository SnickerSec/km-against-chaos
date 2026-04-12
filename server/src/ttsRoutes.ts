import { Router } from "express";
import { createHash } from "crypto";
import { mkdirSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { createLogger } from "./logger.js";

const log = createLogger("tts");
const router = Router();

const UPLOAD_DIR = process.env.UPLOAD_DIR || join(process.cwd(), "uploads");
const TTS_DIR = join(UPLOAD_DIR, "tts");
const DEFAULT_VOICE = "21m00Tcm4TlvDq8ikWAM"; // Rachel
const MAX_TEXT = 500;

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
  const voice = (typeof body.voice === "string" && body.voice) || DEFAULT_VOICE;
  if (!rawText) { res.status(400).json({ error: "text required" }); return; }
  const text = rawText.slice(0, MAX_TEXT);

  const hash = createHash("sha1").update(`${voice}:${text}`).digest("hex").slice(0, 24);
  const filename = `${hash}.mp3`;
  const filepath = join(TTS_DIR, filename);
  const url = `/uploads/tts/${filename}`;

  if (existsSync(filepath)) { res.json({ url, cached: true }); return; }

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
    mkdirSync(TTS_DIR, { recursive: true });
    writeFileSync(filepath, buf);
    res.json({ url, cached: false });
  } catch (e: any) {
    log.error("tts generation failed", { error: e.message });
    res.status(500).json({ error: "TTS failed" });
  }
});

export default router;
