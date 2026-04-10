import { Router } from "express";
import { requireAuth } from "./auth.js";
import { getUserStats, getGameHistory, getLeaderboard } from "./statsStore.js";

const router = Router();

router.get("/api/stats/me", requireAuth, async (req: any, res) => {
  try {
    const stats = await getUserStats(req.user.id);
    res.json(stats);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/api/stats/history", requireAuth, async (req: any, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));
    const result = await getGameHistory(req.user.id, page, limit);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/api/stats/leaderboard", async (req, res) => {
  try {
    const gameType = req.query.gameType as string | undefined;
    const leaderboard = await getLeaderboard(gameType);
    res.json(leaderboard);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
