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
// Parse a HAE date string ("YYYY-MM-DD HH:mm:ss ±HHMM", ISO 8601, or bare date) to "YYYY-MM-DD".
function parseHaeDate(raw: string | undefined): string | null {
  if (!raw) return null;
  // "2026-04-15 00:00:00 -0400" → split on space, take first token
  // "2026-04-15T00:00:00Z"     → split on T, take first token
  const d = raw.includes("T") ? raw.split("T")[0] : raw.split(" ")[0];
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

/**
 * Normalize a HAE (or flat iOS Shortcut) payload into one normalized object per
 * calendar date found in the payload.
 *
 * HAE can send multi-day payloads (e.g. exportPeriod="Default" = yesterday + today).
 * Each metric's data[] array has one entry per day; the sort order is NOT guaranteed
 * (observed ascending in practice). We group by date first, then extract each metric's
 * value for that specific date, so every calendar day gets its own correct row.
 *
 * Returns an array of normalized objects. The caller upserts each one independently.
 */
function normalizeHealthPayload(body: any): any[] {
  // ── Flat iOS Shortcut format — wrap in array and return as-is ───────────────
  if (body?.date && typeof body.date === "string") return [body];

  // ── Health Auto Export format ─────────────────────────────────────────────
  const metrics: any[] = body?.data?.metrics ?? [];
  const workouts: any[] = body?.data?.workouts ?? [];

  // Collect all unique calendar dates across all metrics.
  const dateSet = new Set<string>();
  for (const m of metrics) {
    for (const entry of (m.data ?? [])) {
      const d = parseHaeDate(entry?.date);
      if (d) dateSet.add(d);
    }
  }
  // Fall back to today if no dates were found (shouldn't happen).
  if (dateSet.size === 0) dateSet.add(new Date().toISOString().split("T")[0]);

  // For a given metric (by name aliases) and a specific calendar date, return the value.
  const getForDate = (date: string, ...names: string[]): number | null => {
    for (const name of names) {
      const m = metrics.find((m: any) => m.name === name);
      if (!m) continue;
      const entry = (m.data ?? []).find((e: any) => parseHaeDate(e?.date) === date);
      const val = entry?.qty ?? entry?.value;
      if (val != null) return Number(val);
    }
    return null;
  };

  const getForDateWithUnits = (date: string, ...names: string[]): { val: number; units: string } | null => {
    for (const name of names) {
      const m = metrics.find((m: any) => m.name === name);
      if (!m) continue;
      const entry = (m.data ?? []).find((e: any) => parseHaeDate(e?.date) === date);
      const val = entry?.qty ?? entry?.value;
      if (val != null) return { val: Number(val), units: (m.units ?? "").toLowerCase() };
    }
    return null;
  };

  const results: any[] = [];

  for (const date of Array.from(dateSet)) {
    const steps       = getForDate(date, "step_count", "steps", "stepCount");
    // Active energy = move-ring / workout calories (active_energy in HAE JSON).
    // Basal energy  = resting metabolic rate calories (basal_energy_burned in HAE JSON).
    // Keep them separate so calories_burned = active + basal = total TDEE, matching
    // the "Total Calories" figure shown in Apple Health's Summary tab.
    // DO NOT alias basal into the active slot — they are semantically distinct.
    // HAE sends "active_energy_burned" (not "active_energy") in its JSON export.
    const activeKcal  = getForDate(date, "active_energy_burned", "activeEnergyBurned", "active_energy", "activeEnergy");
    const basalKcal   = getForDate(date, "basal_energy_burned", "basalEnergy", "basalEnergyBurned", "resting_energy_burned", "restingEnergyBurned");
    // Total calories = active + basal (both may be null independently)
    const totalKcal   = (activeKcal ?? 0) + (basalKcal ?? 0);
    // Only store if at least one component is non-null
    const caloriesForRow = (activeKcal != null || basalKcal != null) ? totalKcal : null;
    const exerciseMin = getForDate(date, "apple_exercise_time", "appleExerciseTime", "active_minutes", "exercise_time", "exercise_time_minutes");
    const rhr         = getForDate(date, "resting_heart_rate", "restingHeartRate");
    const hrv         = getForDate(date, "heart_rate_variability_sdnn", "heartRateVariabilitySDNN", "hrv_sdnn", "hrv", "heartRateVariability");
    const weightRaw   = getForDateWithUnits(date, "weight_body_mass", "body_mass", "bodyMass", "weight");
    // HAE exports weight in the user's Apple Health unit (lbs for US locale) — always store as kg
    const weight      = weightRaw
      ? (weightRaw.units === "lb" || weightRaw.units === "lbs" ? weightRaw.val * 0.453592 : weightRaw.val)
      : null;
    const bodyFat     = getForDate(date, "body_fat_percentage", "bodyFatPercentage");
    const vo2         = getForDate(date, "vo2_max", "vo2Max", "VO2Max");
    const respRate    = getForDate(date, "respiratory_rate", "respiratoryRate");

    // ── Sleep extraction ─────────────────────────────────────────────────────
    // HAE sends sleep_analysis in two possible formats:
    //   Aggregated: one entry per night with { qty, totalSleep, asleep, deep, rem, ... } in hours
    //   Category:   one entry per sleep-stage interval with { date, endDate, value: "AsleepCore"|... }
    const sleepMetric = metrics.find((m: any) =>
      ["sleep_analysis", "sleepAnalysis", "sleep"].includes(m.name)
    );
    let sleepMin: number | null = null;
    let deepMin: number | null = null;
    let remMin:  number | null = null;

    if (sleepMetric) {
      const allEntries: any[] = sleepMetric.data ?? [];
      // Detect format: category entries have a string "value" field (sleep stage name)
      const isCategoryFormat = allEntries.some((e: any) => typeof e?.value === "string");

      if (isCategoryFormat) {
        // Sum up sleep-stage intervals whose start date matches this calendar date.
        // A normal sleep session starts before midnight (date=yesterday) and ends after midnight.
        // Include intervals starting on THIS date OR on the day before (covers full overnight session).
        const prevDate = new Date(date + "T12:00:00Z");
        prevDate.setUTCDate(prevDate.getUTCDate() - 1);
        const prevDateStr = prevDate.toISOString().slice(0, 10);

        const SLEEP_STAGES = new Set([
          "AsleepUnspecified", "AsleepCore", "AsleepDeep", "AsleepREM",
          "HKCategoryValueSleepAnalysisAsleep",
          "HKCategoryValueSleepAnalysisAsleepUnspecified",
          "HKCategoryValueSleepAnalysisAsleepCore",
          "HKCategoryValueSleepAnalysisAsleepDeep",
          "HKCategoryValueSleepAnalysisAsleepREM",
        ]);
        const DEEP_STAGES = new Set(["AsleepDeep", "HKCategoryValueSleepAnalysisAsleepDeep"]);
        const REM_STAGES  = new Set(["AsleepREM",  "HKCategoryValueSleepAnalysisAsleepREM"]);

        let totalMs = 0, deepMs = 0, remMs = 0;
        for (const e of allEntries) {
          const startStr: string = e?.date ?? e?.startDate;
          const endStr:   string = e?.endDate;
          if (!startStr || !endStr) continue;
          const startDate = parseHaeDate(startStr);
          // Only count intervals that start on this date or the night before (overnight sessions)
          if (startDate !== date && startDate !== prevDateStr) continue;
          const stage: string = e?.value ?? "";
          if (!SLEEP_STAGES.has(stage)) continue;
          const startMs = new Date(startStr.includes("T") ? startStr : startStr.replace(" ", "T")).getTime();
          const endMs   = new Date(endStr.includes("T")   ? endStr   : endStr.replace(" ", "T")).getTime();
          if (isNaN(startMs) || isNaN(endMs) || endMs <= startMs) continue;
          const dur = endMs - startMs;
          totalMs += dur;
          if (DEEP_STAGES.has(stage)) deepMs += dur;
          if (REM_STAGES.has(stage))  remMs  += dur;
        }
        if (totalMs > 0) {
          sleepMin = Math.round(totalMs / 60000);
          if (deepMs > 0) deepMin = Math.round(deepMs / 60000);
          if (remMs  > 0) remMin  = Math.round(remMs  / 60000);
        }
      } else {
        // Aggregated format: find the single summary entry for this date
        const sleepEntry = allEntries.find((e: any) => parseHaeDate(e?.date) === date);
        if (sleepEntry) {
          const toMin = (v: number) => v < 24 ? Math.round(v * 60) : Math.round(v);
          const rawSleep = sleepEntry.totalSleep ?? sleepEntry.asleep ?? sleepEntry.qty;
          if (rawSleep != null && !isNaN(Number(rawSleep))) sleepMin = toMin(Number(rawSleep));
          if (sleepEntry.deep != null && !isNaN(Number(sleepEntry.deep))) deepMin = toMin(Number(sleepEntry.deep));
          if (sleepEntry.rem  != null && !isNaN(Number(sleepEntry.rem)))  remMin  = toMin(Number(sleepEntry.rem));
        }
      }
    }
    // Also try standalone deep_sleep / rem_sleep metrics (hours)
    if (deepMin == null) {
      const v = getForDate(date, "deep_sleep", "deep_sleep_duration");
      if (v != null) deepMin = Math.round(v * 60);
    }
    if (remMin == null) {
      const v = getForDate(date, "rem_sleep", "rem_sleep_duration");
      if (v != null) remMin = Math.round(v * 60);
    }

    // Workouts attributed to this date
    const dayWorkouts = workouts.filter((w: any) =>
      parseHaeDate(w.startDate) === date
    ).map((w: any) => ({
      activity_type:  w.workoutActivityType ?? w.name ?? "Unknown",
      duration_min:   w.duration ?? 0,
      calories:       w.totalEnergyBurned ?? 0,
      distance_km:    w.totalDistance ?? undefined,
      avg_heart_rate: w.averageHeartRate ?? undefined,
      date,
    }));

    const row: any = { date };
    if (steps            != null) row.steps           = Math.round(steps);
    if (caloriesForRow   != null) row.calories_burned = Math.round(caloriesForRow);
    if (exerciseMin != null) row.active_minutes    = Math.round(exerciseMin);
    if (sleepMin    != null) row.sleep_duration_min = sleepMin;
    if (deepMin     != null) row.deep_sleep_min    = deepMin;
    if (remMin      != null) row.rem_sleep_min     = remMin;
    if (rhr         != null) row.resting_heart_rate = Math.round(rhr);
    if (hrv         != null) row.hrv_ms            = hrv;
    if (weight      != null) row.weight_kg         = weight;
    if (bodyFat     != null) row.body_fat_pct      = bodyFat;
    if (vo2         != null) row.vo2_max           = vo2;
    if (respRate    != null) row.respiratory_rate  = respRate;
    if (dayWorkouts.length > 0) row.workouts       = dayWorkouts;

    results.push(row);
  }

  return results;
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

        // Normalize payload into one object per calendar date.
        // Single-day (Today/Yesterday) payloads return a 1-element array;
        // multi-day (Default) payloads return one element per day.
        const normalizedRows = normalizeHealthPayload(req.body);

        // Log metric names for observability
        if (req.body?.data?.metrics) {
          const names = req.body.data.metrics.map((m: any) => m.name);
          console.log("[apple-health] metrics received:", names.join(", "), `| dates: ${normalizedRows.map((r: any) => r.date).join(", ")}`);
          const KNOWN_METRICS = ["step_count", "steps", "stepCount", "active_energy", "activeEnergy", "basal_energy_burned", "basalEnergy", "basalEnergyBurned", "apple_exercise_time", "appleExerciseTime", "exercise_time", "exercise_time_minutes", "sleep_analysis", "sleepAnalysis", "sleep", "resting_heart_rate", "restingHeartRate", "heart_rate_variability_sdnn", "heartRateVariabilitySDNN", "heart_rate_variability", "hrv_sdnn", "hrv", "heartRateVariability", "body_mass", "bodyMass", "weight", "weight_body_mass", "body_fat_percentage", "bodyFatPercentage", "vo2_max", "vo2Max", "VO2Max", "respiratory_rate", "respiratoryRate"];
          const unknown = names.filter((n: string) => !KNOWN_METRICS.includes(n));
          if (unknown.length > 0) {
            console.log(`[apple-health] UNRECOGNIZED metric names (add aliases): ${unknown.join(", ")}`);
          }
        }

        let upsertedDates: string[] = [];

        for (const normalized of normalizedRows) {
          // Skip rows with no metric data (only date field present)
          const metricKeys = Object.keys(normalized).filter(k => k !== "date");
          if (metricKeys.length === 0) {
            console.log(`[apple-health] skipping upsert for ${normalized.date} — no recognized metrics`);
            continue;
          }

          const parsed = pushBodySchema.safeParse(normalized);
          if (!parsed.success) {
            console.log(`[HAE] Zod parse failed for ${normalized.date}:`, JSON.stringify(parsed.error.issues));
            continue;
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

          const receivedFields = (Object.keys(data) as (keyof typeof data)[])
            .filter((k) => k !== "date" && data[k] != null);
          console.log(`[apple-health] upserted ${data.date} for user ${userId}: ${receivedFields.join(", ")}`);
          upsertedDates.push(data.date);
        }

        if (upsertedDates.length === 0) {
          console.log(`[apple-health] skipping upsert — no recognized metrics in any row`);
          return res.json({ ok: true, skipped: "no recognized metrics" });
        }

        console.log(`[apple-health] push received for user ${userId} dates=${upsertedDates.join(", ")}`);
        res.json({ ok: true, dates: upsertedDates });
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

        // Fetch recent rows ordered by calendar date (most recent first).
        // Using date DESC ensures yesterday's sleep row is always included regardless
        // of synced_at ordering (which could put historical backfill rows ahead of yesterday).
        const today = new Date().toISOString().split("T")[0];
        const { rows: dataRows } = await pool.query(
          `SELECT * FROM apple_health_daily
           WHERE user_id = $1
           ORDER BY date DESC, synced_at DESC
           LIMIT 14`,
          [userId]
        );

        // Today's row (may be partial — has intraday steps/calories but not yet overnight sleep/HRV)
        const todayRow = dataRows.find((r: any) => r.date?.toISOString?.()?.startsWith(today) || String(r.date).startsWith(today)) ?? null;
        // Most recently synced row overall
        const recentRow = dataRows[0] ?? null;

        // Sleep in HAE is attributed to the date the sleep SESSION STARTED (not the wake date).
        // This means last night's sleep lands on yesterday's row, not today's.
        // Find the most recent row that actually has sleep data, regardless of date.
        const sleepRow = dataRows.find((r: any) => r.sleep_duration_min != null) ?? null;
        // Similarly, HRV and RHR may be on yesterday's row if today's hasn't been computed yet.
        const hrvRow   = dataRows.find((r: any) => r.avg_overnight_hrv != null) ?? null;
        const rhrRow   = dataRows.find((r: any) => r.resting_heart_rate != null) ?? null;

        // Build merged view: start with the most recent row for all base fields,
        // then overlay today's intraday values (steps, calories, weight),
        // and fill sleep/HRV/RHR from the most recent row that has them.
        const base = recentRow ?? {};
        const merged = {
          ...base,
          // Today's intraday metrics (override if non-null)
          ...(todayRow?.total_steps     != null ? { total_steps:     todayRow.total_steps     } : {}),
          ...(todayRow?.calories_burned != null ? { calories_burned: todayRow.calories_burned } : {}),
          ...(todayRow?.active_minutes  != null ? { active_minutes:  todayRow.active_minutes  } : {}),
          ...(todayRow?.weight_kg       != null ? { weight_kg:       todayRow.weight_kg       } : {}),
          ...(todayRow?.body_fat_pct    != null ? { body_fat_pct:    todayRow.body_fat_pct    } : {}),
          // Overnight metrics: use most recent row that actually has the data,
          // whether that's today's row or yesterday's (sleep is always yesterday's date in HAE).
          ...(sleepRow != null ? {
            sleep_duration_min: sleepRow.sleep_duration_min,
            deep_sleep_min:     sleepRow.deep_sleep_min,
            rem_sleep_min:      sleepRow.rem_sleep_min,
          } : {}),
          ...(hrvRow?.avg_overnight_hrv  != null ? { avg_overnight_hrv:  hrvRow.avg_overnight_hrv  } : {}),
          ...(rhrRow?.resting_heart_rate != null ? { resting_heart_rate: rhrRow.resting_heart_rate } : {}),
          // Static / infrequently-updated metrics — take from most recent non-null row
          ...(todayRow?.vo2_max           != null ? { vo2_max:          todayRow.vo2_max          } :
              recentRow?.vo2_max          != null ? { vo2_max:          recentRow.vo2_max          } : {}),
          ...(todayRow?.respiratory_rate  != null ? { respiratory_rate: todayRow.respiratory_rate  } :
              recentRow?.respiratory_rate != null ? { respiratory_rate: recentRow.respiratory_rate } : {}),
          synced_at: recentRow?.synced_at ?? null,
        };

        // "connected" = data has been received at least once
        const connected = !!recentRow?.synced_at;
        const lastSyncDate: string | null = recentRow?.date ?? null;
        const lastSyncAt: string | null = recentRow?.synced_at ?? null;

        // Expose the date the sleep data comes from so the frontend can label it
        // correctly ("Last night" vs "2 nights ago").
        // Postgres date columns come back as JS Date objects — convert to YYYY-MM-DD string.
        const toDateStr = (d: any): string | null => {
          if (!d) return null;
          if (d instanceof Date) return d.toISOString().slice(0, 10);
          const s = String(d);
          return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
        };
        const sleepDate: string | null = sleepRow ? toDateStr(sleepRow.date) : null;

        res.json({ connected, setupComplete, lastSyncDate, lastSyncAt, sleepDate, latestData: merged });
      } catch (err: any) {
        console.error("[apple-health] status error:", err.message);
        res.status(500).json({ error: "Failed to fetch status" });
      }
    }
  );
}
