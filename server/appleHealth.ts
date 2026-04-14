/**
 * Apple Health integration via iOS Shortcuts webhook.
 *
 * Instead of OAuth, the user gets a personal webhook URL containing a
 * long random token.  An iOS Shortcut (or any HTTP client) POSTs daily
 * health metrics to that URL — no App Store app required.
 *
 * Routes:
 *   GET  /api/apple-health/setup        — generate / return webhook URL
 *   POST /api/apple-health/push/:token  — receive health data (token = auth)
 *   GET  /api/apple-health/status       — connection & last-sync info
 */
import type { Express, Request, Response } from "express";
import { pool } from "./db.js";
import { requireAuth, type AuthRequest } from "./auth.js";
import { z } from "zod";
import crypto from "crypto";

// ─── Zod schema for the incoming health payload ────────────────────────────

const pushBodySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  steps: z.number().int().nonnegative().optional(),
  calories_burned: z.number().int().nonnegative().optional(),
  active_minutes: z.number().int().nonnegative().optional(),
  sleep_duration_min: z.number().nonnegative().optional(),
  deep_sleep_min: z.number().nonnegative().optional(),
  rem_sleep_min: z.number().nonnegative().optional(),
  resting_heart_rate: z.number().int().nonnegative().optional(),
  hrv_ms: z.number().nonnegative().optional(),
  weight_kg: z.number().positive().optional(),
  body_fat_pct: z.number().positive().optional(),
});

// ─── Route registration ────────────────────────────────────────────────────

export function registerAppleHealthRoutes(app: Express): void {
  // ── GET /api/apple-health/setup ──────────────────────────────────────────
  // Returns (or creates) the user's personal webhook URL + iOS Shortcut link.
  app.get(
    "/api/apple-health/setup",
    requireAuth,
    async (req: AuthRequest, res: Response) => {
      try {
        const userId = req.user!.id;

        // Check if user already has a token
        const { rows } = await pool.query(
          `SELECT apple_health_token FROM users WHERE id = $1`,
          [userId]
        );
        let token: string = rows[0]?.apple_health_token;

        // Generate a new token if none exists
        if (!token) {
          token = crypto.randomBytes(32).toString("hex");
          await pool.query(
            `UPDATE users SET apple_health_token = $1 WHERE id = $2`,
            [token, userId]
          );
        }

        const baseUrl =
          process.env.APP_URL ?? "https://wvu-dining-tracker.onrender.com";
        const webhookUrl = `${baseUrl}/api/apple-health/push/${token}`;

        // Deep link into iOS Shortcuts app to create a new shortcut
        const shortcutUrl = `https://www.icloud.com/shortcuts/`;

        res.json({
          webhookUrl,
          shortcutUrl,
          setupGuide: [
            "1. Open the iOS Shortcuts app on your iPhone.",
            "2. Create a new shortcut that reads Health data (steps, calories, sleep, etc.).",
            "3. Add a 'Get Contents of URL' action pointing to your webhook URL above (POST, JSON body).",
            "4. Run the shortcut manually or set it to run daily via Automation.",
          ],
        });
      } catch (err: any) {
        console.error("[apple-health] setup error:", err.message);
        res.status(500).json({ error: "Failed to generate webhook URL" });
      }
    }
  );

  // ── POST /api/apple-health/push/:token ───────────────────────────────────
  // Public endpoint — the token in the URL IS the authentication.
  app.post(
    "/api/apple-health/push/:token",
    async (req: Request, res: Response) => {
      try {
        const { token } = req.params;

        // Basic token validation
        if (!token || token.length < 32) {
          return res.status(401).json({ error: "Invalid token" });
        }

        // Look up the user by their webhook token
        const { rows: userRows } = await pool.query(
          `SELECT id FROM users WHERE apple_health_token = $1`,
          [token]
        );
        if (!userRows.length) {
          return res.status(401).json({ error: "Unknown token" });
        }
        const userId: string = userRows[0].id;

        // Parse and validate the request body
        const parsed = pushBodySchema.safeParse(req.body);
        if (!parsed.success) {
          return res
            .status(400)
            .json({ error: "Invalid payload", details: parsed.error.issues });
        }
        const data = parsed.data;

        // Upsert into apple_health_daily
        await pool.query(
          `INSERT INTO apple_health_daily
             (user_id, date, total_steps, calories_burned, active_minutes,
              sleep_duration_min, deep_sleep_min, rem_sleep_min,
              resting_heart_rate, avg_overnight_hrv, weight_kg, body_fat_pct, synced_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now())
           ON CONFLICT (user_id, date) DO UPDATE SET
             total_steps        = COALESCE(EXCLUDED.total_steps,        apple_health_daily.total_steps),
             calories_burned    = COALESCE(EXCLUDED.calories_burned,    apple_health_daily.calories_burned),
             active_minutes     = COALESCE(EXCLUDED.active_minutes,     apple_health_daily.active_minutes),
             sleep_duration_min = COALESCE(EXCLUDED.sleep_duration_min, apple_health_daily.sleep_duration_min),
             deep_sleep_min     = COALESCE(EXCLUDED.deep_sleep_min,     apple_health_daily.deep_sleep_min),
             rem_sleep_min      = COALESCE(EXCLUDED.rem_sleep_min,      apple_health_daily.rem_sleep_min),
             resting_heart_rate = COALESCE(EXCLUDED.resting_heart_rate, apple_health_daily.resting_heart_rate),
             avg_overnight_hrv  = COALESCE(EXCLUDED.avg_overnight_hrv,  apple_health_daily.avg_overnight_hrv),
             weight_kg          = COALESCE(EXCLUDED.weight_kg,          apple_health_daily.weight_kg),
             body_fat_pct       = COALESCE(EXCLUDED.body_fat_pct,       apple_health_daily.body_fat_pct),
             synced_at          = now()`,
          [
            userId,
            data.date,
            data.steps ?? null,
            data.calories_burned ?? null,
            data.active_minutes ?? null,
            data.sleep_duration_min ?? null,
            data.deep_sleep_min ?? null,
            data.rem_sleep_min ?? null,
            data.resting_heart_rate ?? null,
            data.hrv_ms ?? null,
            data.weight_kg ?? null,
            data.body_fat_pct ?? null,
          ]
        );

        // If weight was provided, also upsert into weight_log
        if (data.weight_kg) {
          await pool.query(
            `INSERT INTO weight_log (user_id, date, weight_kg, source, logged_at)
             VALUES ($1, $2, $3, 'apple_health', now())
             ON CONFLICT (user_id, date) DO UPDATE SET
               weight_kg = EXCLUDED.weight_kg,
               source    = 'apple_health',
               logged_at = now()`,
            [userId, data.date, data.weight_kg]
          );
        }

        console.log(
          `[apple-health] push received for user ${userId} date=${data.date}`
        );
        res.json({ ok: true });
      } catch (err: any) {
        console.error("[apple-health] push error:", err.message);
        res.status(500).json({ error: "Failed to store health data" });
      }
    }
  );

  // ── GET /api/apple-health/status ─────────────────────────────────────────
  // Returns connection status and last sync date.
  app.get(
    "/api/apple-health/status",
    requireAuth,
    async (req: AuthRequest, res: Response) => {
      try {
        const userId = req.user!.id;

        // Check if user has a token configured
        const { rows: userRows } = await pool.query(
          `SELECT apple_health_token FROM users WHERE id = $1`,
          [userId]
        );
        const connected = !!userRows[0]?.apple_health_token;

        // Get last sync info
        const { rows: syncRows } = await pool.query(
          `SELECT date, synced_at
           FROM apple_health_daily
           WHERE user_id = $1
           ORDER BY date DESC
           LIMIT 1`,
          [userId]
        );

        const lastSyncDate: string | null = syncRows[0]?.date ?? null;
        const lastSyncAt: string | null = syncRows[0]?.synced_at ?? null;

        res.json({ connected, lastSyncDate, lastSyncAt });
      } catch (err: any) {
        console.error("[apple-health] status error:", err.message);
        res.status(500).json({ error: "Failed to fetch status" });
      }
    }
  );
}
