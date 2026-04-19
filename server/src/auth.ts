import { OAuth2Client } from "google-auth-library";
import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";
import { Sentry } from "./instrumentation.js";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";

if (!process.env.JWT_SECRET) {
  console.error("FATAL: JWT_SECRET environment variable is required");
  process.exit(1);
}
if (process.env.JWT_SECRET.length < 32) {
  console.error("FATAL: JWT_SECRET must be at least 32 characters");
  process.exit(1);
}
const JWT_SECRET = process.env.JWT_SECRET;

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);
if (ADMIN_EMAILS.length === 0) {
  console.warn("WARNING: ADMIN_EMAILS is not set — admin panel will be inaccessible");
}

const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  picture: string;
  role?: string;
  isAdmin?: boolean;
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
    { id: user.id, email: user.email, name: user.name, picture: user.picture, role: user.role ?? null },
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
    Sentry.setUser({ id: user.id, email: user.email, username: user.name });
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).user as AuthUser | undefined;
  if (!user || (!ADMIN_EMAILS.includes(user.email.toLowerCase()) && user.role !== "admin")) {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
}

export function requireModeratorOrAdmin(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).user as AuthUser | undefined;
  if (!user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const adminByEmail = ADMIN_EMAILS.includes(user.email.toLowerCase());
  const adminByRole = user.role === "admin";
  const moderator = user.role === "moderator";
  if (!adminByEmail && !adminByRole && !moderator) {
    res.status(403).json({ error: "Moderator or admin access required" });
    return;
  }
  next();
}

export function isAdmin(email: string, role?: string): boolean {
  return ADMIN_EMAILS.includes(email.toLowerCase()) || role === "admin";
}
