import { Router } from "express";

const router = Router();
// Klipy API: https://docs.klipy.com/gifs-api
// URL format: https://api.klipy.com/api/v1/{app_key}/gifs/trending|search
const KLIPY_BASE = "https://api.klipy.com/api/v1";

function getKey() {
  return process.env.KLIPY_API_KEY || "";
}

// Normalize a Klipy result into a simple shape for the client
// Response: { result, data: { data: [...], current_page, has_next } }
// Each item: { id, slug, title, file: { hd: { gif: { url } }, md: ..., sm: ..., xs: ... } }
function normalize(results: any[]) {
  return results.map((r: any) => {
    const f = r.file || {};
    const url = f.hd?.gif?.url || f.md?.gif?.url || f.sm?.gif?.url || "";
    const previewUrl = f.sm?.gif?.url || f.xs?.gif?.url || f.md?.gif?.url || url;
    return {
      id: String(r.id || r.slug || ""),
      description: r.title || "",
      url,
      previewUrl,
    };
  }).filter((r: any) => r.url);
}

router.get("/ping", (_req, res) => {
  res.json({ ok: true, key: !!process.env.KLIPY_API_KEY });
});

router.get("/find", async (req, res) => {
  const { q = "", type = "gif", page = "" } = req.query as Record<string, string>;
  const key = getKey();
  if (!key) { res.status(503).json({ error: "Media API not configured" }); return; }

  const category = type === "sticker" ? "stickers" : "gifs";
  const action = q.trim() ? "search" : "trending";
  const params = new URLSearchParams({ per_page: "24" });
  if (q.trim()) params.set("q", q.trim());
  if (page) params.set("page", page);

  const url = `${KLIPY_BASE}/${key}/${category}/${action}?${params}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (response.status === 204) {
      res.json({ results: [], next: "" });
      return;
    }
    if (!response.ok) {
      res.status(response.status).json({ error: "Upstream error", status: response.status });
      return;
    }
    const body: any = await response.json();
    const page = body.data || {};
    const results = normalize(page.data || []);
    res.json({ results, next: page.has_next ? String((page.current_page || 1) + 1) : "" });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
