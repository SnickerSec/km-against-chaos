import * as Sentry from "@sentry/node";
import { Router } from "express";
import { listPacks, getPackById } from "./deckStore.js";

const router = Router();
router.use((req, _res, next) => { (req as any).body = {}; next(); });

router.get("/", async (req, res) => {
  try {
    const type = req.query.type as string | undefined;
    res.json(await listPacks(type));
  } catch (e: any) { Sentry.captureException(e);
    res.status(500).json({ error: e.message });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const pack = await getPackById(req.params.id);
    if (!pack) { res.status(404).json({ error: "Pack not found" }); return; }
    res.json(pack);
  } catch (e: any) { Sentry.captureException(e);
    res.status(500).json({ error: e.message });
  }
});

export default router;
