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
  // Also handle ISO 8601 "YYYY-MM-DDTHH:mm:ssZ" and bare "YYYY-MM-DD"
  const rawDate = metrics[0]?.data?.[0]?.date;
  let firstDate =
    rawDate?.split(" ")?.[0] ??
    rawDate?.split("T")?.[0] ??
    new Date().toISOString().split("T")[0];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(firstDate)) {
    firstDate = new Date().toISOString().split("T")[0];
  }

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

  const steps        = get("step_count", "steps", "stepCount");
  const activeKcal   = get("active_energy", "activeEnergy", "active_energy_burned", "basal_energy_burned", "basalEnergy", "basalEnergyBurned");
  const exerciseMin  = get("apple_exercise_time", "appleExerciseTime", "active_minutes", "exercise_time", "exercise_time_minutes");
  const rhr          = get("resting_heart_rate", "restingHeartRate");
  const hrv          = get("heart_rate_variability_sdnn", "heartRateVariabilitySDNN", "hrv_sdnn", "hrv", "heartRateVariability");
  const weightRaw    = getWithUnits("weight_body_mass", "body_mass", "bodyMass", "weight");
  // HAE exports weight in the user's Apple Health unit (lbs for US locale) — always store as kg
  const weight       = weightRaw
    ? (weightRaw.units === "lb" || weightRaw.units === "lbs" ? weightRaw.val * 0.453592 : weightRaw.val)
    : null;
  const bodyFat      = get("body_fat_percentage", "bodyFatPercentage");
  const vo2          = get("vo2_max", "vo2Max", "VO2Max");
  const respRate     = get("respiratory_rate", "respiratoryRate");

  // ── Sleep extraction ─────────────────────────────────────────────────────
  // Aggregated sleep_analysis uses { totalSleep, deep, rem } (NOT qty).
  // totalSleep may be in minutes (>=24) or hours (<24) depending on HAE config.
  const sleepMetric  = metrics.find((m: any) =>
    ["sleep_analysis", "sleepAnalysis", "sleep"].includes(m.name)
  );
  const sleepEntry   = sleepMetric?.data?.[0];
  let sleepMin: number | null = null;
  let deepMin: number | null = null;
  let remMin:  number | null = null;
  if (sleepEntry) {
    // Prefer aggregated fields; fall back to qty (unaggregated / iOS Shortcut)
    const rawSleep = sleepEntry.totalSleep ?? sleepEntry.asleep ?? sleepEntry.qty;
    if (rawSleep != null) {
      // If value < 24, HAE sent hours; otherwise it's already minutes
      sleepMin = rawSleep < 24 ? Math.round(rawSleep * 60) : Math.round(rawSleep);
    }
    if (sleepEntry.deep != null) {
      deepMin = sleepEntry.deep < 24 ? Math.round(sleepEntry.deep * 60) : Math.round(sleepEntry.deep);
    }
    if (sleepEntry.rem != null) {
      remMin = sleepEntry.rem < 24 ? Math.round(sleepEntry.rem * 60) : Math.round(sleepEntry.rem);
    }
  }
  // Also try standalone deep_sleep / rem_sleep metrics (hours)
  if (deepMin == null) {
    const v = get("deep_sleep", "deep_sleep_duration");
    if (v != null) deepMin = Math.round(v * 60);
  }
  if (remMin == null) {
    const v = get("rem_sleep", "rem_sleep_duration");
    if (v != null) remMin = Math.round(v * 60);
  }

  return {
    date: firstDate,
    ...(steps        != null ? { steps: Math.round(steps) }                         : {}),
    ...(activeKcal   != null ? { calories_burned: Math.round(activeKcal) }          : {}),
    ...(exerciseMin  != null ? { active_minutes: Math.round(exerciseMin) }          : {}),
    ...(sleepMin     != null ? { sleep_duration_min: sleepMin }                     : {}),
    ...(deepMin      != null ? { deep_sleep_min: deepMin }                          : {}),
    ...(remMin       != null ? { rem_sleep_min: remMin }                            : {}),
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
        const configDownloadUrl = `${baseUrl}/hae-config.json`;

        res.json({
          webhookUrl,
          configDownloadUrl,
          recommendedApp: {
            name: "Health Auto Export",
            appStoreUrl: "https://apps.apple.com/app/health-auto-export-json-csv/id1115567069",
            description: "Free app that auto-syncs Apple Health data to your webhook. No coding needed.",
          },
          setupGuide: [
            "Download the pre-built config file using the button below.",
            "In Health Auto Export, go to Automations → tap the ⊕ icon → Import → select the downloaded file.",
            "When prompted, paste your Webhook URL (copied in Step 2) into the URL field.",
            "Save — HAE will automatically push your health data on the configured schedule.",
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
        console.log('[HAE] Raw payload:', JSON.stringify(req.body).slice(0, 2000));

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
        // Log metric names for observability
        if (req.body?.data?.metrics) {
          const names = req.body.data.metrics.map((m: any) => m.name);
          console.log("[apple-health] metrics received:", names.join(", "), "| normalized keys:", Object.keys(normalized).join(", "));
          // Log any metric names not recognized
          const KNOWN_METRICS = ["step_count", "steps", "stepCount", "active_energy", "activeEnergy", "active_energy_burned", "basal_energy_burned", "basalEnergy", "basalEnergyBurned", "apple_exercise_time", "appleExerciseTime", "exercise_time", "exercise_time_minutes", "sleep_analysis", "sleepAnalysis", "sleep", "resting_heart_rate", "restingHeartRate", "heart_rate_variability_sdnn", "heartRateVariabilitySDNN", "hrv_sdnn", "hrv", "heartRateVariability", "body_mass", "bodyMass", "weight", "weight_body_mass", "body_fat_percentage", "bodyFatPercentage", "vo2_max", "vo2Max", "VO2Max", "respiratory_rate", "respiratoryRate"];
          const unknown = names.filter((n: string) => !KNOWN_METRICS.includes(n));
          if (unknown.length > 0) {
            console.log(`[apple-health] UNRECOGNIZED metric names (add aliases): ${unknown.join(", ")}`);
          }
        }

        // Skip upsert if no metric data was extracted (only date field present)
        // This prevents writing a null row when HAE sends an unrecognized metric name
        const metricKeys = Object.keys(normalized).filter(k => k !== "date");
        if (metricKeys.length === 0) {
          console.log(`[apple-health] skipping upsert — no recognized metrics in payload (raw metric names: ${req.body?.data?.metrics?.map((m: any) => m.name).join(", ") ?? "unknown"})`);
          return res.json({ ok: true, skipped: "no recognized metrics" });
        }

        const parsed = pushBodySchema.safeParse(normalized);
        if (!parsed.success) {
          console.log('[HAE] Zod parse failed:', JSON.stringify(parsed.error.issues));
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

        // Fetch today's row + the most-recently-synced row in one query
        const today = new Date().toISOString().split("T")[0];
        const { rows: dataRows } = await pool.query(
          `SELECT * FROM apple_health_daily
           WHERE user_id = $1
           ORDER BY synced_at DESC
           LIMIT 5`,
          [userId]
        );

        // Today's row (may be partial — has sleep/RHR from overnight push)
        const todayRow = dataRows.find((r: any) => r.date?.toISOString?.()?.startsWith(today) || String(r.date).startsWith(today)) ?? null;
        // Most recently synced row (has steps/weight from yesterday push)
        const recentRow = dataRows[0] ?? null;

        // Merge: prefer today's row for each field, fall back to recentRow for nulls
        const merged = (todayRow && recentRow && todayRow !== recentRow)
          ? {
              ...recentRow,
              // Override with today's non-null values
              ...(todayRow.resting_heart_rate != null ? { resting_heart_rate: todayRow.resting_heart_rate } : {}),
              ...(todayRow.sleep_duration_min  != null ? { sleep_duration_min:  todayRow.sleep_duration_min  } : {}),
              ...(todayRow.deep_sleep_min      != null ? { deep_sleep_min:      todayRow.deep_sleep_min      } : {}),
              ...(todayRow.rem_sleep_min       != null ? { rem_sleep_min:       todayRow.rem_sleep_min       } : {}),
              ...(todayRow.avg_overnight_hrv   != null ? { avg_overnight_hrv:   todayRow.avg_overnight_hrv   } : {}),
              ...(todayRow.total_steps         != null ? { total_steps:         todayRow.total_steps         } : {}),
              ...(todayRow.calories_burned     != null ? { calories_burned:     todayRow.calories_burned     } : {}),
              ...(todayRow.active_minutes      != null ? { active_minutes:      todayRow.active_minutes      } : {}),
              ...(todayRow.weight_kg           != null ? { weight_kg:           todayRow.weight_kg           } : {}),
              ...(todayRow.body_fat_pct        != null ? { body_fat_pct:        todayRow.body_fat_pct        } : {}),
              ...(todayRow.vo2_max             != null ? { vo2_max:             todayRow.vo2_max             } : {}),
              ...(todayRow.respiratory_rate    != null ? { respiratory_rate:    todayRow.respiratory_rate    } : {}),
              synced_at: recentRow.synced_at, // most recent sync timestamp
            }
          : (todayRow ?? recentRow);

        // "connected" = data has been received at least once
        const connected = !!recentRow?.synced_at;
        const lastSyncDate: string | null = recentRow?.date ?? null;
        const lastSyncAt: string | null = recentRow?.synced_at ?? null;

        res.json({ connected, setupComplete, lastSyncDate, lastSyncAt, latestData: merged });
      } catch (err: any) {
        console.error("[apple-health] status error:", err.message);
        res.status(500).json({ error: "Failed to fetch status" });
      }
    }
  );
}
