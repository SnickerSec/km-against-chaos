import { Router } from "express";
import pool from "./db.js";
import { requireAuth, requireAdmin } from "./auth.js";

const router = Router();

router.use((req, res, next) => {
  if (req.headers["content-type"]?.includes("application/json")) {
    let body = "";
    req.on("data", (chunk: Buffer) => (body += chunk));
    req.on("end", () => {
      try {
        (req as any).body = JSON.parse(body);
      } catch {
        (req as any).body = {};
      }
      next();
    });
  } else {
    (req as any).body = {};
    next();
  }
});

router.use(requireAuth, requireAdmin);

// Get all settings
router.get("/settings", async (_req, res) => {
  try {
    const { rows } = await pool.query("SELECT key, value FROM settings");
    const settings: Record<string, any> = {};
    for (const row of rows) {
      settings[row.key] = row.value;
    }
    res.json(settings);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Update a setting
router.put("/settings/:key", async (req, res) => {
  const { key } = req.params;
  const { value } = (req as any).body;

  if (value === undefined) {
    res.status(400).json({ error: "Value is required" });
    return;
  }

  try {
    await pool.query(
      `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
      [key, JSON.stringify(value)]
    );
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
