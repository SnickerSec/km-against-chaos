import { Router } from "express";

const router = Router();
const KLIPY_BASE = "https://api.klipy.com/v1";

function getKey() {
  return process.env.KLIPY_API_KEY || "";
}

// Normalize a Klipy result into a simple shape for the client
function normalize(results: any[]) {
  return results.map((r: any) => ({
    id: r.id,
    description: r.content_description || "",
    url: r.media_formats?.gif?.url || r.media_formats?.mp4?.url || "",
    previewUrl: r.media_formats?.tinygif?.url || r.media_formats?.gif?.url || "",
  })).filter((r: any) => r.url);
}

router.get("/ping", (_req, res) => {
  res.json({ ok: true, key: !!process.env.KLIPY_API_KEY });
});

router.get("/find", async (req, res) => {
  const { q = "", type = "gif", page = "" } = req.query as Record<string, string>;
  const key = getKey();
  console.log(`[media] find q="${q}" type="${type}" hasKey=${!!key}`);
  // Stub for debugging: return empty results immediately
  res.json({ results: [], next: "", debug: "stub" });
  return;
  if (!key) { res.status(503).json({ error: "Media API not configured" }); return; }

  const endpoint = type === "sticker" ? "stickers" : "gifs";
  const action = q.trim() ? "search" : "featured";
  const params = new URLSearchParams({ key, per_page: "24" });
  if (q.trim()) params.set("q", q.trim());
  if (page) params.set("page", page);

  const url = `${KLIPY_BASE}/${endpoint}/${action}?${params}`;
  console.log(`[media] fetching ${url.replace(key, "***")}`);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    console.log(`[media] klipy status=${response.status}`);
    if (!response.ok) { res.status(response.status).json({ error: "Upstream error", status: response.status }); return; }
    const data: any = await response.json();
    const results = normalize(data.results || []);
    console.log(`[media] returning ${results.length} results`);
    res.json({ results, next: data.next || "" });
  } catch (e: any) {
    console.error(`[media] error: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

export default router;
