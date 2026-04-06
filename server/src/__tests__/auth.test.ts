import { describe, it, expect, vi } from "vitest";

// auth.ts reads env at import time and calls process.exit(1) if JWT_SECRET
// is missing. vi.hoisted runs before any imports are resolved.
vi.hoisted(() => {
  process.env.JWT_SECRET = "test-secret-that-is-at-least-32-chars-long!!";
  process.env.ADMIN_EMAILS = "admin@example.com,boss@example.com";
  process.env.GOOGLE_CLIENT_ID = "fake-client-id";
});

import { signJwt, verifyJwt, isAdmin, requireAuth, requireAdmin, requireModeratorOrAdmin } from "../auth.js";
import type { AuthUser } from "../auth.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

const testUser: AuthUser = {
  id: "user-1",
  email: "player@example.com",
  name: "Test Player",
  picture: "https://example.com/pic.jpg",
};

const adminUser: AuthUser = {
  id: "admin-1",
  email: "admin@example.com",
  name: "Admin",
  picture: "",
};

/** Minimal Express-like req/res/next for middleware tests. */
function mockReqRes(authHeader?: string) {
  const req = { headers: { authorization: authHeader } } as any;
  const res = {
    statusCode: 0,
    body: null as any,
    status(code: number) { this.statusCode = code; return this; },
    json(data: any) { this.body = data; return this; },
  } as any;
  const next = vi.fn();
  return { req, res, next };
}

// ── signJwt / verifyJwt roundtrip ────────────────────────────────────────────

describe("signJwt / verifyJwt", () => {
  it("roundtrips user claims", () => {
    const token = signJwt(testUser);
    const decoded = verifyJwt(token);
    expect(decoded.id).toBe(testUser.id);
    expect(decoded.email).toBe(testUser.email);
    expect(decoded.name).toBe(testUser.name);
    expect(decoded.picture).toBe(testUser.picture);
  });

  it("token is a non-empty string", () => {
    const token = signJwt(testUser);
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(0);
  });

  it("verifyJwt throws on tampered token", () => {
    const token = signJwt(testUser);
    expect(() => verifyJwt(token + "x")).toThrow();
  });

  it("verifyJwt throws on garbage input", () => {
    expect(() => verifyJwt("not.a.jwt")).toThrow();
  });

  it("includes role when provided", () => {
    const token = signJwt({ ...testUser, role: "admin" });
    const decoded = verifyJwt(token);
    expect(decoded.role).toBe("admin");
  });

  it("role is null when not provided", () => {
    const token = signJwt(testUser);
    const decoded = verifyJwt(token);
    expect(decoded.role).toBeNull();
  });
});

// ── isAdmin ──────────────────────────────────────────────────────────────────

describe("isAdmin", () => {
  it("returns true for email in ADMIN_EMAILS", () => {
    expect(isAdmin("admin@example.com")).toBe(true);
    expect(isAdmin("boss@example.com")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isAdmin("ADMIN@EXAMPLE.COM")).toBe(true);
  });

  it("returns true for role=admin regardless of email", () => {
    expect(isAdmin("nobody@example.com", "admin")).toBe(true);
  });

  it("returns false for non-admin email and no role", () => {
    expect(isAdmin("player@example.com")).toBe(false);
  });

  it("returns false for moderator role (not admin)", () => {
    expect(isAdmin("player@example.com", "moderator")).toBe(false);
  });
});

// ── requireAuth middleware ────────────────────────────────────────────────────

describe("requireAuth", () => {
  it("passes valid token and attaches user to req", () => {
    const token = signJwt(testUser);
    const { req, res, next } = mockReqRes(`Bearer ${token}`);
    requireAuth(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(req.user.id).toBe(testUser.id);
  });

  it("rejects missing Authorization header", () => {
    const { req, res, next } = mockReqRes(undefined);
    requireAuth(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects non-Bearer scheme", () => {
    const { req, res, next } = mockReqRes("Basic abc123");
    requireAuth(req, res, next);
    expect(res.statusCode).toBe(401);
  });

  it("rejects invalid token", () => {
    const { req, res, next } = mockReqRes("Bearer bad.token.here");
    requireAuth(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toMatch(/invalid|expired/i);
  });
});

// ── requireAdmin middleware ──────────────────────────────────────────────────

describe("requireAdmin", () => {
  it("allows admin email through", () => {
    const { req, res, next } = mockReqRes();
    req.user = adminUser;
    requireAdmin(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("allows admin role through", () => {
    const { req, res, next } = mockReqRes();
    req.user = { ...testUser, role: "admin" };
    requireAdmin(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("rejects non-admin", () => {
    const { req, res, next } = mockReqRes();
    req.user = testUser;
    requireAdmin(req, res, next);
    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects when no user attached", () => {
    const { req, res, next } = mockReqRes();
    requireAdmin(req, res, next);
    expect(res.statusCode).toBe(403);
  });
});

// ── requireModeratorOrAdmin middleware ────────────────────────────────────────

describe("requireModeratorOrAdmin", () => {
  it("allows moderator through", () => {
    const { req, res, next } = mockReqRes();
    req.user = { ...testUser, role: "moderator" };
    requireModeratorOrAdmin(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("allows admin through", () => {
    const { req, res, next } = mockReqRes();
    req.user = adminUser;
    requireModeratorOrAdmin(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("rejects regular user", () => {
    const { req, res, next } = mockReqRes();
    req.user = testUser;
    requireModeratorOrAdmin(req, res, next);
    expect(res.statusCode).toBe(403);
  });

  it("rejects unauthenticated request", () => {
    const { req, res, next } = mockReqRes();
    requireModeratorOrAdmin(req, res, next);
    expect(res.statusCode).toBe(401);
  });
});
