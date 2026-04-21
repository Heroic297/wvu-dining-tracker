/**
 * Lightweight in-memory rate limiter.
 * No external dependencies — uses a sliding-window counter keyed on IP.
 *
 * Usage:
 *   app.post("/api/auth/login", rateLimiter({ windowMs: 15*60*1000, max: 10 }), handler)
 */
import type { Request, Response, NextFunction } from "express";

interface RateLimitOptions {
  /** Window size in milliseconds */
  windowMs: number;
  /** Max requests allowed per IP within the window */
  max: number;
  /** Message sent when limit is exceeded */
  message?: string;
}

interface Counter {
  count: number;
  resetAt: number;
}

export function rateLimiter(opts: RateLimitOptions) {
  const { windowMs, max, message = "Too many requests, please try again later." } = opts;
  const store = new Map<string, Counter>();

  // Prune stale entries every 10 minutes to prevent unbounded memory growth
  const pruneInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, counter] of Array.from(store.entries())) {
      if (counter.resetAt <= now) store.delete(key);
    }
  }, 10 * 60 * 1000);

  // Don't prevent the process from exiting
  if (pruneInterval.unref) pruneInterval.unref();

  return function (req: Request, res: Response, next: NextFunction) {
    const ip =
      (req.headers["x-forwarded-for"] as string)?.split(",")[0].trim() ||
      req.socket.remoteAddress ||
      "unknown";

    const now = Date.now();
    let counter = store.get(ip);

    if (!counter || counter.resetAt <= now) {
      counter = { count: 1, resetAt: now + windowMs };
      store.set(ip, counter);
      return next();
    }

    counter.count += 1;

    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader("X-RateLimit-Remaining", String(Math.max(0, max - counter.count)));
    res.setHeader("X-RateLimit-Reset", String(Math.ceil(counter.resetAt / 1000)));

    if (counter.count > max) {
      res.setHeader("Retry-After", String(Math.ceil((counter.resetAt - now) / 1000)));
      return res.status(429).json({ error: message });
    }

    return next();
  };
}

// ── Pre-configured limiters ────────────────────────────────────────────────────

/** Auth endpoints: 10 attempts per 15 minutes per IP */
export const authLimiter = rateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "Too many auth attempts. Please wait 15 minutes before trying again.",
});

/** Nutrition lookup: 60 requests per minute per IP */
export const nutritionLimiter = rateLimiter({
  windowMs: 60 * 1000,
  max: 60,
  message: "Nutrition lookup rate limit exceeded. Please slow down.",
});

/** AI Coach chat: 30 messages per minute per IP */
export const coachLimiter = rateLimiter({
  windowMs: 60 * 1000,
  max: 30,
  message: "Coach chat rate limit exceeded. Please wait a moment.",
});
