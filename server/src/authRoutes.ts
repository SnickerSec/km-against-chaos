import { Router } from "express";
import pool from "./db.js";
import { verifyGoogleToken, signJwt, requireAuth, isAdmin, type AuthUser } from "./auth.js";
import { randomUUID } from "crypto";


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

// Exchange Google ID token for a JWT
router.post("/google", async (req, res) => {
  const { credential } = (req as any).body;
  if (!credential) {
    res.status(400).json({ error: "Missing credential" });
    return;
  }

  try {
    const googleUser = await verifyGoogleToken(credential);

    // Upsert user
    const { rows } = await pool.query(
      `INSERT INTO users (id, google_id, email, name, picture)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (google_id) DO UPDATE SET email = $3, name = $4, picture = $5
       RETURNING *`,
      [randomUUID(), googleUser.googleId, googleUser.email, googleUser.name, googleUser.picture]
    );

    const user: AuthUser = {
      id: rows[0].id,
      email: rows[0].email,
      name: rows[0].name,
      picture: rows[0].picture,
      role: rows[0].role || null,
    };

    const adminStatus = isAdmin(user.email, user.role ?? undefined);
    const token = signJwt(user);
    res.json({ token, user: { ...user, role: user.role ?? null }, isAdmin: adminStatus, role: user.role ?? null });
  } catch (e: any) {
    console.error("Google auth error:", e.message);
    res.status(401).json({ error: "Google authentication failed" });
  }
});

// Get current user info
router.get("/me", requireAuth, (req, res) => {
  const user = (req as any).user as AuthUser;
  res.json({ user, isAdmin: isAdmin(user.email, user.role), role: user.role ?? null });
});

export default router;
