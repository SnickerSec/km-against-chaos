import { Router } from "express";

const router = Router();

const MYINSTANTS = "https://www.myinstants.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36";

// Scrape myinstants.com search and return first MP3 URL
router.get("/search", async (req, res) => {
  const { q } = req.query;
  if (!q || typeof q !== "string") {
    res.status(400).json({ error: "q is required" });
    return;
  }
  try {
    const r = await fetch(
      `${MYINSTANTS}/en/search/?name=${encodeURIComponent(q)}`,
      { headers: { "User-Agent": UA } }
    );
    if (!r.ok) {
      res.status(404).json({ error: "No sound found" });
      return;
    }
    const html = await r.text();
    // Extract first play('...') path from the page
    const match = html.match(/play\('([^']+\.mp3)'/);
    if (!match) {
      res.status(404).json({ error: "No sound found" });
      return;
    }
    const mp3 = `${MYINSTANTS}${match[1]}`;
    res.json({ mp3 });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
