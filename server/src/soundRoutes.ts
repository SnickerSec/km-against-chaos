import { Router } from "express";

const router = Router();

// Proxy to myinstants API to avoid CORS issues on the client
router.get("/search", async (req, res) => {
  const { q } = req.query;
  if (!q || typeof q !== "string") {
    res.status(400).json({ error: "q is required" });
    return;
  }
  try {
    const r = await fetch(
      `https://myinstants-api.vercel.app/search?q=${encodeURIComponent(q)}`
    );
    if (!r.ok) {
      res.status(404).json({ error: "No sound found" });
      return;
    }
    const data = (await r.json()) as any;
    const first = data?.data?.[0];
    if (!first?.mp3) {
      res.status(404).json({ error: "No sound found" });
      return;
    }
    res.json({ mp3: first.mp3, title: first.title });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
