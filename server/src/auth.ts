import { OAuth2Client } from "google-auth-library";
import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const JWT_SECRET =
  process.env.JWT_SECRET || "dev-secret-change-in-production";
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "cwilli.it@gmail.com")
  .split(",")
  .map((e) => e.trim().toLowerCase());

const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  picture: string;
}

export async function verifyGoogleToken(idToken: string) {
  const ticket = await googleClient.verifyIdToken({
    idToken,
    audience: GOOGLE_CLIENT_ID,
  });
  const payload = ticket.getPayload();
  if (!payload) throw new Error("Invalid Google token");
  return {
    googleId: payload.sub,
    email: payload.email!,
    name: payload.name || payload.email!,
    picture: payload.picture || "",
  };
}

export function signJwt(user: AuthUser): string {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name, picture: user.picture },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

export function verifyJwt(token: string): AuthUser {
  return jwt.verify(token, JWT_SECRET) as AuthUser;
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  try {
    const user = verifyJwt(header.slice(7));
    (req as any).user = user;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).user as AuthUser | undefined;
  if (!user || !ADMIN_EMAILS.includes(user.email.toLowerCase())) {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
}

export function isAdmin(email: string): boolean {
  return ADMIN_EMAILS.includes(email.toLowerCase());
}
