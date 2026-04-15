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
  workouts: z.array(z.object({
    activity_type: z.string(),
    duration_min: z.number(),
    calories: z.number(),
    distance_km: z.number().optional(),
    avg_heart_rate: z.number().optional(),
    date: z.string().optional(),
  })).optional(),
  vo2_max: z.number().positive().optional(),
  respiratory_rate: z.number().positive().optional(),
});

// ─── Normalize incoming payload ──────────────────────────────────────────────

/**
 * Health Auto Export fires one POST per metric, each shaped as:
 *   { data: { metrics: [{ name: "step_count", units: "count", data: [{ date: "YYYY-MM-DD HH:mm:ss", qty: 1234 }] }] } }
 *
 * Known metric names (snake_case, from the app's export):
 *   step_count, active_energy_burned, apple_exercise_time,
 *   sleep_analysis (qty in hours), resting_heart_rate, heart_rate_variability_sdnn,
 *   heart_rate, body_mass (kg), body_fat_percentage, vo2_max, respiratory_rate,
 *   apple_sleeping_wrist_temperature, deep_sleep (hrs), rem_sleep (hrs)
 *
 * Also handles the flat iOS Shortcut format: { date, steps, calories_burned, ... }
 */
function normalizeHealthPayload(body: any): any {
  // ── Flat iOS Shortcut format — pass through as-is ─────────────────────────
  if (body?.date && typeof body.date === "string") return body;

  // ── Health Auto Export format ─────────────────────────────────────────────
  const metrics: any[] = body?.data?.metrics ?? [];
  const workouts: any[] = body?.data?.workouts ?? [];

  // Extract date from first data point ("YYYY-MM-DD HH:mm:ss" → "YYYY-MM-DD")
  const firstDate =
    metrics[0]?.data?.[0]?.date?.split(" ")?.[0] ??
    new Date().toISOString().split("T")[0];

  // Look up a metric by exact name or any of several aliases, return first data point value
  const get = (...names: string[]): number | null => {
    for (const name of names) {
      const m = metrics.find((m: any) => m.name === name);
      const val = m?.data?.[0]?.qty ?? m?.data?.[0]?.value;
      if (val != null) return Number(val);
    }
    return null;
  };

  // Look up a metric and also return its units string
  const getWithUnits = (...names: string[]): { val: number; units: string } | null => {
    for (const name of names) {
      const m = metrics.find((m: any) => m.name === name);
      const val = m?.data?.[0]?.qty ?? m?.data?.[0]?.value;
      if (val != null) return { val: Number(val), units: (m.units ?? "").toLowerCase() };
    }
    return null;
  };

  const steps        = get("step_count", "steps");
  const activeKcal   = get("active_energy", "active_energy_burned", "activeEnergyBurned");
  const exerciseMin  = get("apple_exercise_time", "appleExerciseTime", "exercise_time");
  const sleepHrs     = get("sleep_analysis", "sleepAnalysis", "sleep");
  const deepHrs      = get("deep_sleep", "deep_sleep_duration");
  const remHrs       = get("rem_sleep", "rem_sleep_duration");
  const rhr          = get("resting_heart_rate", "restingHeartRate");
  const hrv          = get("heart_rate_variability_sdnn", "heartRateVariabilitySDNN", "hrv");
  const weightRaw    = getWithUnits("weight_body_mass", "body_mass", "bodyMass", "weight");
  // HAE exports weight in the user's Apple Health unit (lbs for US locale) — always store as kg
  const weight       = weightRaw
    ? (weightRaw.units === "lb" || weightRaw.units === "lbs" ? weightRaw.val * 0.453592 : weightRaw.val)
    : null;
  const bodyFat      = get("body_fat_percentage", "bodyFatPercentage");
  const vo2          = get("vo2_max", "vo2Max");
  const respRate     = get("respiratory_rate", "respiratoryRate");

  return {
    date: firstDate,
    ...(steps        != null ? { steps: Math.round(steps) }                         : {}),
    ...(activeKcal   != null ? { calories_burned: Math.round(activeKcal) }          : {}),
    ...(exerciseMin  != null ? { active_minutes: Math.round(exerciseMin) }          : {}),
    // sleep_analysis qty is in hours → convert to minutes
    ...(sleepHrs     != null ? { sleep_duration_min: Math.round(sleepHrs * 60) }    : {}),
    ...(deepHrs      != null ? { deep_sleep_min: Math.round(deepHrs * 60) }         : {}),
    ...(remHrs       != null ? { rem_sleep_min: Math.round(remHrs * 60) }           : {}),
    ...(rhr          != null ? { resting_heart_rate: Math.round(rhr) }              : {}),
    ...(hrv          != null ? { hrv_ms: hrv }                                      : {}),
    ...(weight       != null ? { weight_kg: weight }                                : {}),
    ...(bodyFat      != null ? { body_fat_pct: bodyFat }                            : {}),
    ...(vo2          != null ? { vo2_max: vo2 }                                     : {}),
    ...(respRate     != null ? { respiratory_rate: respRate }                       : {}),
    ...(workouts.length > 0 ? {
      workouts: workouts.map((w: any) => ({
        activity_type: w.workoutActivityType ?? w.name ?? "Unknown",
        duration_min:  w.duration ?? 0,
        calories:      w.totalEnergyBurned ?? 0,
        distance_km:   w.totalDistance ?? undefined,
        avg_heart_rate: w.averageHeartRate ?? undefined,
        date:          w.startDate?.split(" ")?.[0] ?? firstDate,
      }))
    } : {}),
  };
}

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

        res.json({
          webhookUrl,
          recommendedApp: {
            name: "Health Auto Export",
            appStoreUrl: "https://apps.apple.com/app/health-auto-export-json-csv/id1115567069",
            description: "Free app that auto-syncs Apple Health data to your webhook. No coding needed.",
          },
          setupGuide: [
            "Install 'Health Auto Export' from the App Store (it's free).",
            "Open the app and go to Automations → REST API.",
            "Paste your Webhook URL (copied below) as the endpoint.",
            "Set export format to JSON, period to 'Today', and aggregation to 'Day'.",
            "Select all health metrics: Steps, Sleep Analysis, Heart Rate, HRV, Resting Heart Rate, Active Calories, Weight, Workouts, Body Fat %.",
            "Enable automatic sync — the app will push your data daily.",
          ],
          manualShortcutGuide: [
            "Alternatively, use the iOS Shortcuts app:",
            "1. Create a new Shortcut with 'Find Health Samples' actions for each metric.",
            "2. Add 'Get Contents of URL' pointing to your Webhook URL (POST, JSON body).",
            "3. Set an Automation to run it daily at 11 PM.",
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
        const normalized = normalizeHealthPayload(req.body);
        // Log metric names for observability (compact, not verbose)
        if (req.body?.data?.metrics) {
          const names = req.body.data.metrics.map((m: any) => m.name);
          console.log("[apple-health] metrics received:", names.join(", "), "| normalized keys:", Object.keys(normalized).join(", "));
        }
        const parsed = pushBodySchema.safeParse(normalized);
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
              resting_heart_rate, avg_overnight_hrv, weight_kg, body_fat_pct,
              workouts, vo2_max, respiratory_rate, synced_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, now())
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
             workouts           = COALESCE(EXCLUDED.workouts,           apple_health_daily.workouts),
             vo2_max            = COALESCE(EXCLUDED.vo2_max,            apple_health_daily.vo2_max),
             respiratory_rate   = COALESCE(EXCLUDED.respiratory_rate,   apple_health_daily.respiratory_rate),
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
            data.workouts ? JSON.stringify(data.workouts) : null,
            data.vo2_max ?? null,
            data.respiratory_rate ?? null,
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

        // Check if user has a token configured (webhook URL was generated)
        const { rows: userRows } = await pool.query(
          `SELECT apple_health_token FROM users WHERE id = $1`,
          [userId]
        );
        const setupComplete = !!userRows[0]?.apple_health_token;

        // Get last sync info + latest data
        const { rows: dataRows } = await pool.query(
          `SELECT * FROM apple_health_daily WHERE user_id = $1 ORDER BY synced_at DESC LIMIT 1`,
          [userId]
        );

        // "connected" = data has been received at least once
        const connected = !!dataRows[0]?.synced_at;
        const lastSyncDate: string | null = dataRows[0]?.date ?? null;
        const lastSyncAt: string | null = dataRows[0]?.synced_at ?? null;

        res.json({ connected, setupComplete, lastSyncDate, lastSyncAt, latestData: dataRows[0] ?? null });
      } catch (err: any) {
        console.error("[apple-health] status error:", err.message);
        res.status(500).json({ error: "Failed to fetch status" });
      }
    }
  );
}
