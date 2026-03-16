/**
 * Authentication middleware and helpers.
 * Uses JWT tokens (stored in Authorization header or session).
 * Also supports Supabase JWT validation.
 */
import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { storage } from "./storage.js";
import type { User } from "../shared/schema.js";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-in-production";
const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET || "";

export interface AuthRequest extends Request {
  user?: User;
}

/** Hash a password */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

/** Verify a password against its hash */
export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/** Sign a JWT token for a user */
export function signToken(userId: string): string {
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: "30d" });
}

/** Extract user from JWT. Tries Authorization header first, then session. */
export async function requireAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  try {
    let token: string | undefined;

    // Authorization: Bearer <token>
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      token = authHeader.slice(7);
    }

    // Fallback: session cookie token
    if (!token && (req.session as any)?.token) {
      token = (req.session as any).token;
    }

    if (!token) {
      return res.status(401).json({ error: "Unauthorized — no token provided" });
    }

    // Try our own JWT first
    let userId: string | undefined;
    try {
      const payload = jwt.verify(token, JWT_SECRET) as { sub: string };
      userId = payload.sub;
    } catch {
      // Try Supabase JWT if configured
      if (SUPABASE_JWT_SECRET) {
        try {
          const payload = jwt.verify(token, SUPABASE_JWT_SECRET) as {
            sub: string;
          };
          userId = payload.sub;
        } catch {
          /* fall through */
        }
      }
    }

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized — invalid token" });
    }

    const user = await storage.getUser(userId);
    if (!user) {
      return res.status(401).json({ error: "Unauthorized — user not found" });
    }

    req.user = user;
    next();
  } catch (err) {
    console.error("[auth] middleware error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}

/** Optional auth — attaches user if valid token present, but doesn't block */
export async function optionalAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) return next();

    const token = authHeader.slice(7);
    const payload = jwt.verify(token, JWT_SECRET) as { sub: string };
    const user = await storage.getUser(payload.sub);
    if (user) req.user = user;
  } catch {
    /* ignore */
  }
  next();
}
