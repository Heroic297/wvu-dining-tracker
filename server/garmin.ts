/**
 * Garmin Connect unofficial integration via the garmin-connect library.
 *
 * This module handles:
 * - Login with Garmin credentials (email/password)
 * - Token export/reuse so user doesn't re-enter creds every visit
 * - DI token import for direct Garmin Connect API access (dev-only, gated)
 * - Fetching daily summary data (steps, sleep, HR, stress, body battery, HRV, weight, activities)
 * - Normalizing into garmin_daily_summary rows
 *
 * Tokens are encrypted at rest using the same AES-256-GCM scheme as API keys.
 */
import { GarminConnect } from "garmin-connect";
import { encryptString, decryptString } from "./crypto.js";
import { pool } from "./db.js";
import { storage } from "./storage.js";
import type { InsertGarminDailySummary } from "../shared/schema.js";

// ─── DI Token Constants ─────────────────────────────────────────────────────

const GARMIN_CONNECT_BASE = "https://connect.garmin.com";
const GARMIN_API_BASE = "https://connectapi.garmin.com";
const DI_GATED_EMAIL = "owengidusko@gmail.com";

// ─── Session management ──────────────────────────────────────────────────────

/**
 * Login to Garmin Connect using email/password, then save the session tokens
 * encrypted in the database so they can be reused.
 */
export async function garminLogin(
  userId: string,
  email: string,
  password: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  // Try Python sidecar first (garminconnect 0.3.0 — Cloudflare bypass, MFA-compatible)
  try {
    const { pythonGarminLogin } = await import("./garminPython.js");
    const pyResult = await pythonGarminLogin(userId, email, password);
    if (pyResult.ok) {
      // Mark as connected in DB with token_type = 'python-garth'
      await pool.query(
        `INSERT INTO garmin_sessions (user_id, encrypted_tokens, status, token_type, updated_at)
         VALUES ($1, '', 'connected', 'python-garth', now())
         ON CONFLICT (user_id) DO UPDATE SET
           status = 'connected',
           token_type = 'python-garth',
           last_error = NULL,
           updated_at = now()`,
        [userId]
      );
      return { ok: true };
    }
    // Python failed — fall through to legacy npm library as last resort
    console.warn(`[garmin] Python sidecar login failed for ${userId}: ${pyResult.error} — trying legacy library`);
  } catch (err: any) {
    console.warn(`[garmin] Python sidecar unavailable for ${userId}: ${err.message} — trying legacy library`);
  }

  // Legacy fallback: garmin-connect npm library
  try {
    const gc = new GarminConnect({ username: email, password });
    await gc.login(email, password);
    const tokens = gc.exportToken();
    const encrypted = encryptString(JSON.stringify(tokens));
    await pool.query(
      `INSERT INTO garmin_sessions (user_id, encrypted_tokens, status, updated_at)
       VALUES ($1, $2, 'connected', now())
       ON CONFLICT (user_id) DO UPDATE SET
         encrypted_tokens = $2,
         status = 'connected',
         last_error = NULL,
         updated_at = now()`,
      [userId, encrypted]
    );
    return { ok: true };
  } catch (err: any) {
    const msg = err.message || "Login failed";
    console.error(`[garmin] Login failed for user ${userId}:`, msg);
    await pool.query(
      `INSERT INTO garmin_sessions (user_id, encrypted_tokens, status, last_error, updated_at)
       VALUES ($1, '', 'error', $2, now())
       ON CONFLICT (user_id) DO UPDATE SET
         status = 'error',
         last_error = $2,
         updated_at = now()`,
      [userId, msg]
    ).catch(() => {});
    return { ok: false, error: msg };
  }
}

/**
 * Get a GarminConnect client with restored session tokens.
 * Returns null if no saved session or tokens are invalid/expired.
 */
export async function getGarminClient(userId: string): Promise<GarminConnect | null> {
  const res = await pool.query(
    "SELECT encrypted_tokens, status FROM garmin_sessions WHERE user_id = $1",
    [userId]
  );
  const row = res.rows[0];
  if (!row || !row.encrypted_tokens || row.status === "error") return null;

  try {
    const tokensJson = decryptString(row.encrypted_tokens);
    const tokens = JSON.parse(tokensJson);
    const gc = new GarminConnect();
    gc.loadToken(tokens.oauth1, tokens.oauth2);
    return gc;
  } catch (err: any) {
    console.error(`[garmin] Failed to restore session for ${userId}:`, err.message);
    // Mark as error so we don't keep trying
    await pool.query(
      "UPDATE garmin_sessions SET status = 'error', last_error = $1, updated_at = now() WHERE user_id = $2",
      ["Session expired or corrupted — please reconnect", userId]
    ).catch(() => {});
    return null;
  }
}

/**
 * Update stored tokens after a successful API call (session may have been refreshed).
 */
async function updateStoredTokens(userId: string, gc: GarminConnect): Promise<void> {
  try {
    const tokens = gc.exportToken();
    const encrypted = encryptString(JSON.stringify(tokens));
    await pool.query(
      "UPDATE garmin_sessions SET encrypted_tokens = $1, status = 'connected', last_error = NULL, updated_at = now() WHERE user_id = $2",
      [encrypted, userId]
    );
  } catch (err: any) {
    console.error(`[garmin] Failed to update stored tokens for ${userId}:`, err.message);
  }
}

// ─── DI Token Import ────────────────────────────────────────────────────────

/** Check whether a user email is allowed to use DI token import */
export function isDiTokenAllowed(email: string): boolean {
  return email.toLowerCase() === DI_GATED_EMAIL;
}

/**
 * Import a Garmin DI token for direct API access.
 * Stores the token encrypted with token_type = 'di-token'.
 */
export async function importDiToken(
  userId: string,
  diToken: string,
  diRefreshToken: string,
  diClientId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const tokenBlob = { di_token: diToken, di_refresh_token: diRefreshToken, di_client_id: diClientId };
    const encrypted = encryptString(JSON.stringify(tokenBlob));

    await pool.query(
      `INSERT INTO garmin_sessions (user_id, encrypted_tokens, status, token_type, updated_at)
       VALUES ($1, $2, 'connected', 'di-token', now())
       ON CONFLICT (user_id) DO UPDATE SET
         encrypted_tokens = $2,
         status = 'connected',
         token_type = 'di-token',
         last_error = NULL,
         updated_at = now()`,
      [userId, encrypted]
    );

    console.log(`[garmin] DI token imported for user ${userId}`);
    return { ok: true };
  } catch (err: any) {
    const msg = err.message || "DI token import failed";
    console.error(`[garmin] DI token import failed for user ${userId}:`, msg);
    return { ok: false, error: msg };
  }
}

// ─── DI Token Direct HTTP Helpers ───────────────────────────────────────────

interface DiTokens {
  di_token: string;
  di_refresh_token: string;
  di_client_id: string;
}

/**
 * Fetch JSON from a Garmin Connect endpoint using the DI bearer token.
 * Tries connectapi.garmin.com first (matches garmin-connect library), then
 * falls back to connect.garmin.com/modern/proxy/ and connect.garmin.com.
 * Returns null on failure (non-2xx or network error).
 */
async function diApiFetch(path: string, diToken: string): Promise<any | null> {
  // Try multiple base URLs — the DI token may work with different API gateways
  const bases = [
    GARMIN_API_BASE,                            // connectapi.garmin.com (library uses this)
    `${GARMIN_CONNECT_BASE}/modern/proxy`,      // connect.garmin.com/modern/proxy/ (web session)
    GARMIN_CONNECT_BASE,                        // connect.garmin.com (original)
  ];

  for (const base of bases) {
    try {
      const url = `${base}${path}`;
      console.log(`[garmin-di] Trying: ${url}`);
      const res = await fetch(url, {
        headers: {
          "Authorization": `Bearer ${diToken}`,
          "DI-Backend": diToken,
          "Accept": "application/json",
        },
      });

      const bodyText = await res.text();
      console.log(`[garmin-di] ${url} → ${res.status} | body: ${bodyText.substring(0, 500)}`);

      if (!res.ok) continue; // Try next base URL

      try {
        return JSON.parse(bodyText);
      } catch {
        console.warn(`[garmin-di] ${url} returned non-JSON response`);
        continue;
      }
    } catch (err: any) {
      console.warn(`[garmin-di] ${base}${path} fetch error:`, err.message);
      continue;
    }
  }

  console.warn(`[garmin-di] All base URLs failed for path: ${path}`);
  return null;
}

/**
 * Sync Garmin data using DI token (direct HTTP to Garmin Connect).
 * Same normalization as the garmin-connect library path, writing to garmin_daily_summary.
 */
async function syncGarminDataDI(
  userId: string,
  tokens: DiTokens,
  targetDate?: Date
): Promise<{ ok: true; categories: string[] } | { ok: false; error: string }> {
  const date = targetDate ?? new Date();
  const dateStr = fmtDate(date);
  const categories: string[] = [];

  const summary: Partial<InsertGarminDailySummary> = {
    userId,
    date: dateStr,
  };
  const rawPayload: Record<string, any> = {};

  const diToken = tokens.di_token;

  // ── Steps (DI token compatible endpoints) ─────────────────────────────────
  try {
    let stepped = false;

    // 1. Try wellness-service dailySummary (works with DI token)
    const wellness = await diApiFetch(
      `/wellness-service/wellness/dailySummary/${dateStr}`,
      diToken
    );
    if (wellness?.totalSteps && wellness.totalSteps > 0) {
      summary.totalSteps = wellness.totalSteps;
      if (wellness.activeSeconds) summary.activeMinutes = Math.round(wellness.activeSeconds / 60);
      if (wellness.totalKilocalories) summary.caloriesBurned = Math.round(wellness.totalKilocalories);
      categories.push("steps");
      rawPayload.dailySummary = wellness;
      stepped = true;
    }

    // 2. Fallback: userSummary via connectapi base (different from connect.garmin.com)
    if (!stepped) {
      const data = await diApiFetch(
        `/usersummary-service/usersummary/daily/${dateStr}`,
        diToken
      );
      if (data?.totalSteps && data.totalSteps > 0) {
        summary.totalSteps = data.totalSteps;
        if (data.activeSeconds) summary.activeMinutes = Math.round(data.activeSeconds / 60);
        categories.push("steps");
        rawPayload.dailySummary = data;
        stepped = true;
      }
    }

    // 3. Fallback: stats endpoint
    if (!stepped) {
      const stepsData = await diApiFetch(
        `/usersummary-service/stats/steps/daily/${dateStr}/${dateStr}`,
        diToken
      );
      if (Array.isArray(stepsData) && stepsData[0]?.totalSteps > 0) {
        summary.totalSteps = stepsData[0].totalSteps;
        if (stepsData[0].activeSeconds) summary.activeMinutes = Math.round(stepsData[0].activeSeconds / 60);
        categories.push("steps");
        rawPayload.dailySummary = stepsData[0];
      }
    }
  } catch (err: any) {
    console.warn(`[garmin-di] Steps fetch failed for ${userId}:`, err.message);
  }

  // ── Sleep ─────────────────────────────────────────────────────────────────
  try {
    // Sleep data can appear under today OR yesterday depending on sync timing
    // Try today first, then yesterday if fields are null
    const datesToTry = [dateStr, fmtDate(new Date(date.getTime() - 86400000))];
    let sleepFetched = false;

    for (const sleepDate of datesToTry) {
      if (sleepFetched) break;

      let data = await diApiFetch(
        `/sleep-service/sleep/dailySleepData?date=${sleepDate}`,
        diToken
      );
      if (!data?.dailySleepDTO) {
        data = await diApiFetch(
          `/wellness-service/wellness/dailySleepData/${sleepDate}`,
          diToken
        );
      }
      if (data?.dailySleepDTO) {
        const s = data.dailySleepDTO;
        // Only use this date's data if it actually has sleep time
        if (!s.sleepTimeSeconds && sleepDate !== datesToTry[datesToTry.length - 1]) continue;
        summary.sleepDurationMin = s.sleepTimeSeconds ? Math.round(s.sleepTimeSeconds / 60) : null;
        summary.deepSleepMin = s.deepSleepSeconds ? Math.round(s.deepSleepSeconds / 60) : null;
        summary.lightSleepMin = s.lightSleepSeconds ? Math.round(s.lightSleepSeconds / 60) : null;
        summary.remSleepMin = s.remSleepSeconds ? Math.round(s.remSleepSeconds / 60) : null;
        summary.awakeSleepMin = s.awakeSleepSeconds ? Math.round(s.awakeSleepSeconds / 60) : null;
        summary.sleepScore = s.sleepScores?.overall?.value ?? null;
        summary.avgStress = s.avgSleepStress ? Math.round(s.avgSleepStress) : null;
        if (summary.sleepDurationMin) {
          categories.push("sleep");
          sleepFetched = true;
        }
        rawPayload.sleep = s;
        if (Array.isArray(data.sleepLevels) && data.sleepLevels.length > 0) {
          rawPayload.sleepLevels = data.sleepLevels;
        }
        if (s.sleepStartTimestampGMT) rawPayload.sleepStartGMT = s.sleepStartTimestampGMT;
        if (s.sleepEndTimestampGMT) rawPayload.sleepEndGMT = s.sleepEndTimestampGMT;
        if (s.sleepStartTimestampLocal) rawPayload.sleepStartLocal = s.sleepStartTimestampLocal;
        if (s.sleepEndTimestampLocal) rawPayload.sleepEndLocal = s.sleepEndTimestampLocal;
      }
      // HRV from sleep
      if (data?.avgOvernightHrv) {
        summary.avgOvernightHrv = data.avgOvernightHrv;
        summary.hrvStatus = data.hrvStatus ?? null;
        categories.push("hrv");
      }
      // Body battery from sleep
      if (data?.sleepBodyBattery?.length) {
        const bbs = data.sleepBodyBattery.map((b: any) => b.value).filter((v: number) => v > 0);
        if (bbs.length > 0) {
          summary.bodyBatteryHigh = Math.max(...bbs);
          summary.bodyBatteryLow = Math.min(...bbs);
          categories.push("body_battery");
        }
      }
      if (data?.restingHeartRate) {
        summary.restingHeartRate = data.restingHeartRate;
      }
    }
  } catch (err: any) {
    console.warn(`[garmin-di] Sleep fetch failed for ${userId}:`, err.message);
  }

  // ── Heart Rate ─────────────────────────────────────────────────────────────
  try {
    const datesToTry = [dateStr, fmtDate(new Date(date.getTime() - 86400000))];
    for (const hrDate of datesToTry) {
      let data = await diApiFetch(
        `/wellness-service/wellness/dailyHeartRate?date=${hrDate}`,
        diToken
      );
      if (!data) {
        data = await diApiFetch(
          `/wellness-service/wellness/dailyHeartRate/${hrDate}`,
          diToken
        );
      }
      if (data) {
        if (data.restingHeartRate) summary.restingHeartRate = data.restingHeartRate;
        if (data.maxHeartRate) summary.maxHeartRate = data.maxHeartRate;
        if (data.restingHeartRate || data.maxHeartRate) {
          categories.push("heart_rate");
          rawPayload.heartRate = { resting: data.restingHeartRate, max: data.maxHeartRate };
          break;
        }
      }
    }
  } catch (err: any) {
    console.warn(`[garmin-di] Heart rate fetch failed for ${userId}:`, err.message);
  }

  // ── Weight / Body Composition ─────────────────────────────────────────────
  // Library uses /weight-service/weight/dayview/{date}
  try {
    let data = await diApiFetch(
      `/weight-service/weight/dayview/${dateStr}`,
      diToken
    );
    // Fallback: try the dateRange endpoint
    if (!data?.dateWeightList?.length) {
      data = await diApiFetch(
        `/weight-service/weight/dateRange?startDate=${dateStr}&endDate=${dateStr}`,
        diToken
      );
    }
    if (data?.dateWeightList?.length) {
      const w = data.dateWeightList[0];
      const weightKg = w.weight ? Math.round((w.weight / 1000) * 10) / 10 : null;
      if (weightKg && weightKg > 20 && weightKg < 300) {
        summary.weightKg = weightKg;
        if (w.bodyFat) summary.bodyFatPct = Math.round(w.bodyFat * 10) / 10;
        categories.push("weight");
        rawPayload.weight = w;
        await upsertGarminWeight(userId, dateStr, weightKg);
      }
    }
  } catch (err: any) {
    console.warn(`[garmin-di] Weight fetch failed for ${userId}:`, err.message);
  }

  // ── Recent Activities ─────────────────────────────────────────────────────
  try {
    const data = await diApiFetch(
      `/activitylist-service/activities/search/activities?limit=5&start=0`,
      diToken
    );
    if (Array.isArray(data) && data.length > 0) {
      const recent = data.map((a: any) => ({
        name: a.activityName || a.activityType?.typeKey || "Activity",
        type: a.activityType?.typeKey || "unknown",
        durationMin: a.duration ? Math.round(a.duration / 60) : 0,
        calories: a.calories || 0,
      }));
      summary.recentActivities = recent;
      const todayActivities = data.filter(
        (a: any) => a.startTimeLocal?.startsWith(dateStr)
      );
      if (todayActivities.length > 0) {
        const totalCal = todayActivities.reduce(
          (sum: number, a: any) => sum + (a.calories || 0), 0
        );
        if (totalCal > 0) summary.caloriesBurned = totalCal;
      }
      categories.push("activities");
      rawPayload.activities = recent;
    }
  } catch (err: any) {
    console.warn(`[garmin-di] Activities fetch failed for ${userId}:`, err.message);
  }

  // ── Save normalized summary (same upsert as garmin-connect path) ──────────
  summary.rawPayload = rawPayload;

  if (categories.length > 0) {
    await pool.query(
      `INSERT INTO garmin_daily_summary (
        user_id, date, total_steps, calories_burned, active_minutes,
        sleep_duration_min, deep_sleep_min, light_sleep_min, rem_sleep_min, awake_sleep_min, sleep_score,
        resting_heart_rate, max_heart_rate,
        avg_stress, body_battery_high, body_battery_low,
        avg_overnight_hrv, hrv_status,
        weight_kg, body_fat_pct,
        recent_activities, raw_payload, synced_at
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10, $11,
        $12, $13,
        $14, $15, $16,
        $17, $18,
        $19, $20,
        $21, $22, now()
      )
      ON CONFLICT (user_id, date) DO UPDATE SET
        total_steps = COALESCE($3, garmin_daily_summary.total_steps),
        calories_burned = COALESCE($4, garmin_daily_summary.calories_burned),
        active_minutes = COALESCE($5, garmin_daily_summary.active_minutes),
        sleep_duration_min = COALESCE($6, garmin_daily_summary.sleep_duration_min),
        deep_sleep_min = COALESCE($7, garmin_daily_summary.deep_sleep_min),
        light_sleep_min = COALESCE($8, garmin_daily_summary.light_sleep_min),
        rem_sleep_min = COALESCE($9, garmin_daily_summary.rem_sleep_min),
        awake_sleep_min = COALESCE($10, garmin_daily_summary.awake_sleep_min),
        sleep_score = COALESCE($11, garmin_daily_summary.sleep_score),
        resting_heart_rate = COALESCE($12, garmin_daily_summary.resting_heart_rate),
        max_heart_rate = COALESCE($13, garmin_daily_summary.max_heart_rate),
        avg_stress = COALESCE($14, garmin_daily_summary.avg_stress),
        body_battery_high = COALESCE($15, garmin_daily_summary.body_battery_high),
        body_battery_low = COALESCE($16, garmin_daily_summary.body_battery_low),
        avg_overnight_hrv = COALESCE($17, garmin_daily_summary.avg_overnight_hrv),
        hrv_status = COALESCE($18, garmin_daily_summary.hrv_status),
        weight_kg = COALESCE($19, garmin_daily_summary.weight_kg),
        body_fat_pct = COALESCE($20, garmin_daily_summary.body_fat_pct),
        recent_activities = COALESCE($21, garmin_daily_summary.recent_activities),
        raw_payload = COALESCE($22, garmin_daily_summary.raw_payload),
        synced_at = now()`,
      [
        summary.userId, summary.date,
        summary.totalSteps ?? null, summary.caloriesBurned ?? null, summary.activeMinutes ?? null,
        summary.sleepDurationMin ?? null, summary.deepSleepMin ?? null, summary.lightSleepMin ?? null,
        summary.remSleepMin ?? null, summary.awakeSleepMin ?? null, summary.sleepScore ?? null,
        summary.restingHeartRate ?? null, summary.maxHeartRate ?? null,
        summary.avgStress ?? null, summary.bodyBatteryHigh ?? null, summary.bodyBatteryLow ?? null,
        summary.avgOvernightHrv ?? null, summary.hrvStatus ?? null,
        summary.weightKg ?? null, summary.bodyFatPct ?? null,
        summary.recentActivities ? JSON.stringify(summary.recentActivities) : null,
        rawPayload ? JSON.stringify(rawPayload) : null,
      ]
    );

    await pool.query(
      "UPDATE garmin_sessions SET last_sync_at = now(), status = 'connected', last_error = NULL WHERE user_id = $1",
      [userId]
    );
  }

  console.log(`[garmin-di] Synced ${categories.length} categories for user ${userId} on ${dateStr}: ${categories.join(", ")}`);
  return { ok: true, categories };
}

// ─── Data fetching & normalization ───────────────────────────────────────────

/** Format a Date as YYYY-MM-DD */
function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Sync Garmin data for a specific user for the given date (defaults to today).
 * Fetches all available categories and normalizes them into garmin_daily_summary.
 * Also handles Garmin weight → weight_log with proper source tagging.
 */
export async function syncGarminData(
  userId: string,
  targetDate?: Date
): Promise<{ ok: true; categories: string[] } | { ok: false; error: string }> {
  // Check if this user has a DI token — if so, use the direct HTTP path
  const sessionRes = await pool.query(
    "SELECT token_type, encrypted_tokens FROM garmin_sessions WHERE user_id = $1",
    [userId]
  );
  const session = sessionRes.rows[0];
  if (session?.token_type === "di-token" && session.encrypted_tokens) {
    try {
      const tokens: DiTokens = JSON.parse(decryptString(session.encrypted_tokens));
      return await syncGarminDataDI(userId, tokens, targetDate);
    } catch (err: any) {
      console.error(`[garmin] DI token sync failed for ${userId}:`, err.message);
      await pool.query(
        "UPDATE garmin_sessions SET status = 'error', last_error = $1, updated_at = now() WHERE user_id = $2",
        ["DI token error — please re-import your token", userId]
      ).catch(() => {});
      return { ok: false, error: "DI token error — please re-import your token" };
    }
  }

  // python-garth path (garminconnect 0.3.0 via Python sidecar)
  if (session?.token_type === "python-garth") {
    try {
      const { pythonGarminSync } = await import("./garminPython.js");
      const pyResult = await pythonGarminSync(userId, targetDate);
      if (!pyResult.ok) {
        await pool.query(
          "UPDATE garmin_sessions SET status = 'error', last_error = $1, updated_at = now() WHERE user_id = $2",
          [pyResult.error, userId]
        ).catch(() => {});
        return { ok: false, error: pyResult.error };
      }

      // Normalize the Python result into garmin_daily_summary
      const s = pyResult.summary;
      const raw = pyResult.rawPayload;
      const dateStr = pyResult.date;
      const categories = pyResult.categories;

      if (categories.length > 0) {
        await pool.query(
          `INSERT INTO garmin_daily_summary (
            user_id, date, total_steps, calories_burned, active_minutes,
            sleep_duration_min, deep_sleep_min, light_sleep_min, rem_sleep_min, awake_sleep_min, sleep_score,
            resting_heart_rate, max_heart_rate,
            avg_stress, body_battery_high, body_battery_low,
            avg_overnight_hrv, hrv_status,
            weight_kg, body_fat_pct,
            recent_activities, raw_payload, synced_at
          ) VALUES (
            $1, $2, $3, $4, $5,
            $6, $7, $8, $9, $10, $11,
            $12, $13,
            $14, $15, $16,
            $17, $18,
            $19, $20,
            $21, $22, now()
          )
          ON CONFLICT (user_id, date) DO UPDATE SET
            total_steps = COALESCE($3, garmin_daily_summary.total_steps),
            calories_burned = COALESCE($4, garmin_daily_summary.calories_burned),
            active_minutes = COALESCE($5, garmin_daily_summary.active_minutes),
            sleep_duration_min = COALESCE($6, garmin_daily_summary.sleep_duration_min),
            deep_sleep_min = COALESCE($7, garmin_daily_summary.deep_sleep_min),
            light_sleep_min = COALESCE($8, garmin_daily_summary.light_sleep_min),
            rem_sleep_min = COALESCE($9, garmin_daily_summary.rem_sleep_min),
            awake_sleep_min = COALESCE($10, garmin_daily_summary.awake_sleep_min),
            sleep_score = COALESCE($11, garmin_daily_summary.sleep_score),
            resting_heart_rate = COALESCE($12, garmin_daily_summary.resting_heart_rate),
            max_heart_rate = COALESCE($13, garmin_daily_summary.max_heart_rate),
            avg_stress = COALESCE($14, garmin_daily_summary.avg_stress),
            body_battery_high = COALESCE($15, garmin_daily_summary.body_battery_high),
            body_battery_low = COALESCE($16, garmin_daily_summary.body_battery_low),
            avg_overnight_hrv = COALESCE($17, garmin_daily_summary.avg_overnight_hrv),
            hrv_status = COALESCE($18, garmin_daily_summary.hrv_status),
            weight_kg = COALESCE($19, garmin_daily_summary.weight_kg),
            body_fat_pct = COALESCE($20, garmin_daily_summary.body_fat_pct),
            recent_activities = COALESCE($21, garmin_daily_summary.recent_activities),
            raw_payload = COALESCE($22, garmin_daily_summary.raw_payload),
            synced_at = now()`,
          [
            userId, dateStr,
            s.totalSteps ?? null, s.caloriesBurned ?? null, s.activeMinutes ?? null,
            s.sleepDurationMin ?? null, s.deepSleepMin ?? null, s.lightSleepMin ?? null,
            s.remSleepMin ?? null, s.awakeSleepMin ?? null, s.sleepScore ?? null,
            s.restingHeartRate ?? null, s.maxHeartRate ?? null,
            s.avgStress ?? null, s.bodyBatteryHigh ?? null, s.bodyBatteryLow ?? null,
            s.avgOvernightHrv ?? null, s.hrvStatus ?? null,
            s.weightKg ?? null, s.bodyFatPct ?? null,
            s.recentActivities ? JSON.stringify(s.recentActivities) : null,
            raw ? JSON.stringify(raw) : null,
          ]
        );

        await pool.query(
          "UPDATE garmin_sessions SET last_sync_at = now(), status = 'connected', last_error = NULL WHERE user_id = $1",
          [userId]
        );

        if (s.weightKg) {
          await upsertGarminWeight(userId, dateStr, s.weightKg);
        }
      }

      console.log(`[garmin-py] Synced ${categories.length} categories for user ${userId} on ${dateStr}: ${categories.join(", ")}`);
      return { ok: true, categories };
    } catch (err: any) {
      console.error(`[garmin-py] Sync error for ${userId}:`, err.message);
      await pool.query(
        "UPDATE garmin_sessions SET status = 'error', last_error = $1, updated_at = now() WHERE user_id = $2",
        [err.message, userId]
      ).catch(() => {});
      return { ok: false, error: err.message };
    }
  }

  const gc = await getGarminClient(userId);
  if (!gc) {
    return { ok: false, error: "No valid Garmin session — please reconnect" };
  }

  const date = targetDate ?? new Date();
  const dateStr = fmtDate(date);
  const categories: string[] = [];

  const summary: Partial<InsertGarminDailySummary> = {
    userId,
    date: dateStr,
  };
  const rawPayload: Record<string, any> = {};

  // ── Steps ──────────────────────────────────────────────────────────────────
  try {
    const steps = await gc.getSteps(date);
    if (steps && steps > 0) {
      summary.totalSteps = steps;
      categories.push("steps");
      rawPayload.steps = steps;
    }
  } catch (err: any) {
    console.warn(`[garmin] Steps fetch failed for ${userId}:`, err.message);
  }

  // ── Sleep ──────────────────────────────────────────────────────────────────
  // Try today's sleep, fall back to yesterday if sleepTimeSeconds is null
  const datesToTry = [date, new Date(date.getTime() - 86400000)];
  let sleepFetched = false;
  for (const sleepDate of datesToTry) {
    if (sleepFetched) break;
    try {
      const sleep = await gc.getSleepData(sleepDate);
      if (sleep?.dailySleepDTO?.sleepTimeSeconds) {
        const s = sleep.dailySleepDTO;
        summary.sleepDurationMin = s.sleepTimeSeconds ? Math.round(s.sleepTimeSeconds / 60) : null;
        summary.deepSleepMin = s.deepSleepSeconds ? Math.round(s.deepSleepSeconds / 60) : null;
        summary.lightSleepMin = s.lightSleepSeconds ? Math.round(s.lightSleepSeconds / 60) : null;
        summary.remSleepMin = s.remSleepSeconds ? Math.round(s.remSleepSeconds / 60) : null;
        summary.awakeSleepMin = s.awakeSleepSeconds ? Math.round(s.awakeSleepSeconds / 60) : null;
        summary.sleepScore = s.sleepScores?.overall?.value ?? null;
        summary.avgStress = s.avgSleepStress ? Math.round(s.avgSleepStress) : null;
        categories.push("sleep");
        rawPayload.sleep = s;
        if (Array.isArray(sleep.sleepLevels) && sleep.sleepLevels.length > 0) {
          rawPayload.sleepLevels = sleep.sleepLevels;
        }
        if (s.sleepStartTimestampGMT) rawPayload.sleepStartGMT = s.sleepStartTimestampGMT;
        if (s.sleepEndTimestampGMT) rawPayload.sleepEndGMT = s.sleepEndTimestampGMT;
        if (s.sleepStartTimestampLocal) rawPayload.sleepStartLocal = s.sleepStartTimestampLocal;
        if (s.sleepEndTimestampLocal) rawPayload.sleepEndLocal = s.sleepEndTimestampLocal;
        sleepFetched = true;
      }
      // still extract HRV/body battery/HR even if sleepTime is null
      if (sleep?.avgOvernightHrv) {
        summary.avgOvernightHrv = sleep.avgOvernightHrv;
        summary.hrvStatus = sleep.hrvStatus ?? null;
        categories.push("hrv");
      }
      if (sleep?.sleepBodyBattery?.length) {
        const bbs = sleep.sleepBodyBattery.map((b: any) => b.value).filter((v: number) => v > 0);
        if (bbs.length > 0) {
          summary.bodyBatteryHigh = Math.max(...bbs);
          summary.bodyBatteryLow = Math.min(...bbs);
          categories.push("body_battery");
        }
      }
      if (sleep?.restingHeartRate) {
        summary.restingHeartRate = sleep.restingHeartRate;
      }
    } catch (err: any) {
      console.warn(`[garmin] Sleep fetch failed for ${userId} on ${fmtDate(sleepDate)}:`, err.message);
    }
  }

  // ── Heart Rate ─────────────────────────────────────────────────────────────
  try {
    const hr = await gc.getHeartRate(date);
    if (hr) {
      if (hr.restingHeartRate) summary.restingHeartRate = hr.restingHeartRate;
      if (hr.maxHeartRate) summary.maxHeartRate = hr.maxHeartRate;
      categories.push("heart_rate");
      rawPayload.heartRate = { resting: hr.restingHeartRate, max: hr.maxHeartRate };
    }
  } catch (err: any) {
    console.warn(`[garmin] Heart rate fetch failed for ${userId}:`, err.message);
  }

  // ── Weight / Body Composition ──────────────────────────────────────────────
  try {
    const weightData = await gc.getDailyWeightData(date);
    if (weightData?.dateWeightList?.length) {
      const w = weightData.dateWeightList[0];
      // Garmin reports weight in grams
      const weightKg = w.weight ? Math.round((w.weight / 1000) * 10) / 10 : null;
      if (weightKg && weightKg > 20 && weightKg < 300) {
        summary.weightKg = weightKg;
        if (w.bodyFat) summary.bodyFatPct = Math.round(w.bodyFat * 10) / 10;
        categories.push("weight");
        rawPayload.weight = w;

        // Write to weight_log with source=garmin (only if no newer manual entry)
        await upsertGarminWeight(userId, dateStr, weightKg);
      }
    }
  } catch (err: any) {
    console.warn(`[garmin] Weight fetch failed for ${userId}:`, err.message);
  }

  // ── Recent Activities ──────────────────────────────────────────────────────
  try {
    const activities = await gc.getActivities(0, 5);
    if (activities?.length) {
      const recent = activities.map((a: any) => ({
        name: a.activityName || a.activityType?.typeKey || "Activity",
        type: a.activityType?.typeKey || "unknown",
        durationMin: a.duration ? Math.round(a.duration / 60) : 0,
        calories: a.calories || 0,
      }));
      summary.recentActivities = recent;
      // Sum today's activity calories
      const todayActivities = activities.filter(
        (a: any) => a.startTimeLocal?.startsWith(dateStr)
      );
      if (todayActivities.length > 0) {
        const totalCal = todayActivities.reduce(
          (sum: number, a: any) => sum + (a.calories || 0), 0
        );
        if (totalCal > 0) summary.caloriesBurned = totalCal;
      }
      categories.push("activities");
      rawPayload.activities = recent;
    }
  } catch (err: any) {
    console.warn(`[garmin] Activities fetch failed for ${userId}:`, err.message);
  }

  // ── Save the normalized summary ────────────────────────────────────────────
  summary.rawPayload = rawPayload;

  if (categories.length > 0) {
    await pool.query(
      `INSERT INTO garmin_daily_summary (
        user_id, date, total_steps, calories_burned, active_minutes,
        sleep_duration_min, deep_sleep_min, light_sleep_min, rem_sleep_min, awake_sleep_min, sleep_score,
        resting_heart_rate, max_heart_rate,
        avg_stress, body_battery_high, body_battery_low,
        avg_overnight_hrv, hrv_status,
        weight_kg, body_fat_pct,
        recent_activities, raw_payload, synced_at
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10, $11,
        $12, $13,
        $14, $15, $16,
        $17, $18,
        $19, $20,
        $21, $22, now()
      )
      ON CONFLICT (user_id, date) DO UPDATE SET
        total_steps = COALESCE($3, garmin_daily_summary.total_steps),
        calories_burned = COALESCE($4, garmin_daily_summary.calories_burned),
        active_minutes = COALESCE($5, garmin_daily_summary.active_minutes),
        sleep_duration_min = COALESCE($6, garmin_daily_summary.sleep_duration_min),
        deep_sleep_min = COALESCE($7, garmin_daily_summary.deep_sleep_min),
        light_sleep_min = COALESCE($8, garmin_daily_summary.light_sleep_min),
        rem_sleep_min = COALESCE($9, garmin_daily_summary.rem_sleep_min),
        awake_sleep_min = COALESCE($10, garmin_daily_summary.awake_sleep_min),
        sleep_score = COALESCE($11, garmin_daily_summary.sleep_score),
        resting_heart_rate = COALESCE($12, garmin_daily_summary.resting_heart_rate),
        max_heart_rate = COALESCE($13, garmin_daily_summary.max_heart_rate),
        avg_stress = COALESCE($14, garmin_daily_summary.avg_stress),
        body_battery_high = COALESCE($15, garmin_daily_summary.body_battery_high),
        body_battery_low = COALESCE($16, garmin_daily_summary.body_battery_low),
        avg_overnight_hrv = COALESCE($17, garmin_daily_summary.avg_overnight_hrv),
        hrv_status = COALESCE($18, garmin_daily_summary.hrv_status),
        weight_kg = COALESCE($19, garmin_daily_summary.weight_kg),
        body_fat_pct = COALESCE($20, garmin_daily_summary.body_fat_pct),
        recent_activities = COALESCE($21, garmin_daily_summary.recent_activities),
        raw_payload = COALESCE($22, garmin_daily_summary.raw_payload),
        synced_at = now()`,
      [
        summary.userId, summary.date,
        summary.totalSteps ?? null, summary.caloriesBurned ?? null, summary.activeMinutes ?? null,
        summary.sleepDurationMin ?? null, summary.deepSleepMin ?? null, summary.lightSleepMin ?? null,
        summary.remSleepMin ?? null, summary.awakeSleepMin ?? null, summary.sleepScore ?? null,
        summary.restingHeartRate ?? null, summary.maxHeartRate ?? null,
        summary.avgStress ?? null, summary.bodyBatteryHigh ?? null, summary.bodyBatteryLow ?? null,
        summary.avgOvernightHrv ?? null, summary.hrvStatus ?? null,
        summary.weightKg ?? null, summary.bodyFatPct ?? null,
        summary.recentActivities ? JSON.stringify(summary.recentActivities) : null,
        rawPayload ? JSON.stringify(rawPayload) : null,
      ]
    );

    // Update last sync time
    await pool.query(
      "UPDATE garmin_sessions SET last_sync_at = now(), status = 'connected', last_error = NULL WHERE user_id = $1",
      [userId]
    );
  }

  // Re-export tokens in case the library refreshed them during API calls
  await updateStoredTokens(userId, gc);

  console.log(`[garmin] Synced ${categories.length} categories for user ${userId} on ${dateStr}: ${categories.join(", ")}`);
  return { ok: true, categories };
}

// ─── Weight precedence logic ─────────────────────────────────────────────────

/**
 * Upsert a Garmin weight entry into weight_log, but only if there's no
 * newer manual entry for the same or later date.
 *
 * Weight precedence rule:
 * - Garmin weight becomes effective weight only if no newer manual weight exists
 * - Manual weight always wins when it's newer
 */
async function upsertGarminWeight(userId: string, dateStr: string, weightKg: number): Promise<void> {
  // Check if a manual entry exists for this date or later
  const manualRes = await pool.query(
    `SELECT date, weight_kg, source FROM weight_log
     WHERE user_id = $1 AND date >= $2 AND source = 'manual'
     ORDER BY date DESC LIMIT 1`,
    [userId, dateStr]
  );

  const manualEntry = manualRes.rows[0];
  if (manualEntry && manualEntry.date >= dateStr) {
    // A manual entry on the same date or later takes precedence — don't overwrite
    console.log(`[garmin] Skipping weight upsert: manual entry on ${manualEntry.date} takes precedence`);
    return;
  }

  // Upsert the Garmin weight
  await pool.query(
    `INSERT INTO weight_log (user_id, date, weight_kg, source, logged_at, notes)
     VALUES ($1, $2, $3, 'garmin', now(), 'Synced from Garmin')
     ON CONFLICT (user_id, date) DO UPDATE SET
       weight_kg = CASE
         WHEN weight_log.source = 'manual' THEN weight_log.weight_kg
         ELSE $3
       END,
       source = CASE
         WHEN weight_log.source = 'manual' THEN 'manual'
         ELSE 'garmin'
       END,
       logged_at = CASE
         WHEN weight_log.source = 'manual' THEN weight_log.logged_at
         ELSE now()
       END`,
    [userId, dateStr, weightKg]
  );

  // Update user.weightKg with the effective weight (latest, considering precedence)
  const latestRes = await pool.query(
    `SELECT weight_kg FROM weight_log
     WHERE user_id = $1 ORDER BY date DESC, logged_at DESC LIMIT 1`,
    [userId]
  );
  if (latestRes.rows[0]) {
    await pool.query(
      "UPDATE users SET weight_kg = $1 WHERE id = $2",
      [latestRes.rows[0].weight_kg, userId]
    );
  }
}

// ─── Status & Disconnect ────────────────────────────────────────────────────

/**
 * Get the current Garmin connection status for a user.
 */
export async function getGarminStatus(userId: string): Promise<{
  connected: boolean;
  status: string;
  lastSyncAt: string | null;
  lastError: string | null;
  tokenType: string;
}> {
  const res = await pool.query(
    "SELECT status, last_sync_at, last_error, token_type FROM garmin_sessions WHERE user_id = $1",
    [userId]
  );
  const row = res.rows[0];
  if (!row) {
    return { connected: false, status: "disconnected", lastSyncAt: null, lastError: null, tokenType: "none" };
  }
  return {
    connected: row.status === "connected",
    status: row.status,
    lastSyncAt: row.last_sync_at?.toISOString() ?? null,
    lastError: row.last_error,
    tokenType: row.token_type ?? "garmin-connect",
  };
}

/**
 * Get the latest Garmin daily summary for display.
 */
export async function getGarminSummary(
  userId: string,
  date?: string
): Promise<any | null> {
  const dateStr = date ?? fmtDate(new Date());
  const res = await pool.query(
    `SELECT * FROM garmin_daily_summary
     WHERE user_id = $1 AND date = $2
     LIMIT 1`,
    [userId, dateStr]
  );
  const row = res.rows[0];
  if (!row) return null;

  // Extract sleepLevels and sleep timestamps from raw_payload for the hypnogram
  let sleepLevels: Array<{ startGMT: string; endGMT: string; activityLevel: number }> | null = null;
  let sleepStartLocal: number | null = null;
  let sleepEndLocal: number | null = null;
  let sleepStartGMT: number | null = null;
  let sleepEndGMT: number | null = null;
  try {
    const raw = typeof row.raw_payload === "string" ? JSON.parse(row.raw_payload) : row.raw_payload;
    // sleepLevels is stored at raw_payload.sleepLevels (root-level, sibling of sleep/dailySleepDTO)
    if (raw?.sleepLevels && Array.isArray(raw.sleepLevels) && raw.sleepLevels.length > 0) {
      sleepLevels = raw.sleepLevels;
    }
    // Fallback: check inside sleep object (older payloads may have stored it there)
    if (!sleepLevels && raw?.sleep?.sleepLevels && Array.isArray(raw.sleep.sleepLevels)) {
      sleepLevels = raw.sleep.sleepLevels;
    }
    // Sleep start/end local timestamps (epoch ms)
    if (raw?.sleepStartLocal) sleepStartLocal = raw.sleepStartLocal;
    else if (raw?.sleep?.sleepStartTimestampLocal) sleepStartLocal = raw.sleep.sleepStartTimestampLocal;
    if (raw?.sleepEndLocal) sleepEndLocal = raw.sleepEndLocal;
    else if (raw?.sleep?.sleepEndTimestampLocal) sleepEndLocal = raw.sleep.sleepEndTimestampLocal;
    // Sleep start/end GMT timestamps (true UTC epoch ms)
    if (raw?.sleepStartGMT) sleepStartGMT = raw.sleepStartGMT;
    else if (raw?.sleep?.sleepStartTimestampGMT) sleepStartGMT = raw.sleep.sleepStartTimestampGMT;
    if (raw?.sleepEndGMT) sleepEndGMT = raw.sleepEndGMT;
    else if (raw?.sleep?.sleepEndTimestampGMT) sleepEndGMT = raw.sleep.sleepEndTimestampGMT;
  } catch {
    // raw_payload missing or malformed
  }

  return {
    date: row.date,
    totalSteps: row.total_steps,
    caloriesBurned: row.calories_burned,
    activeMinutes: row.active_minutes,
    sleepDurationMin: row.sleep_duration_min,
    deepSleepMin: row.deep_sleep_min,
    lightSleepMin: row.light_sleep_min,
    remSleepMin: row.rem_sleep_min,
    awakeSleepMin: row.awake_sleep_min,
    sleepScore: row.sleep_score,
    restingHeartRate: row.resting_heart_rate,
    maxHeartRate: row.max_heart_rate,
    avgStress: row.avg_stress,
    bodyBatteryHigh: row.body_battery_high,
    bodyBatteryLow: row.body_battery_low,
    avgOvernightHrv: row.avg_overnight_hrv,
    hrvStatus: row.hrv_status,
    weightKg: row.weight_kg,
    bodyFatPct: row.body_fat_pct,
    recentActivities: row.recent_activities,
    sleepLevels,
    sleepStartLocal,
    sleepEndLocal,
    sleepStartGMT,
    sleepEndGMT,
    syncedAt: row.synced_at?.toISOString() ?? null,
  };
}

/**
 * Disconnect Garmin — remove stored session and optionally daily data.
 */
export async function disconnectGarmin(userId: string): Promise<void> {
  await pool.query("DELETE FROM garmin_sessions WHERE user_id = $1", [userId]);
  // Optionally keep garmin_daily_summary data for historical reference
  console.log(`[garmin] Disconnected Garmin for user ${userId}`);
}

/**
 * Get Garmin wearable context for the AI coach.
 * Returns null if no Garmin data detected — coach should NOT get wearable context.
 */
export async function getGarminCoachContext(userId: string): Promise<string | null> {
  const status = await getGarminStatus(userId);
  if (!status.connected) return null;

  const today = fmtDate(new Date());
  const yesterday = fmtDate(new Date(Date.now() - 86400000));
  let summary = await getGarminSummary(userId, today);
  if (!summary) {
    summary = await getGarminSummary(userId, yesterday);
  }
  if (!summary) return null;

  const lines: string[] = ["--- GARMIN WEARABLE DATA (today) ---"];

  if (summary.totalSteps) lines.push(`Steps: ${summary.totalSteps.toLocaleString()}`);
  if (summary.caloriesBurned) lines.push(`Active calories: ${summary.caloriesBurned} kcal`);

  if (summary.sleepDurationMin) {
    const hrs = Math.floor(summary.sleepDurationMin / 60);
    const mins = summary.sleepDurationMin % 60;
    let sleepLine = `Sleep: ${hrs}h${mins > 0 ? ` ${mins}m` : ""}`;
    if (summary.sleepScore) sleepLine += ` (score: ${summary.sleepScore}/100)`;
    if (summary.deepSleepMin) sleepLine += ` | Deep: ${summary.deepSleepMin}m`;
    if (summary.remSleepMin) sleepLine += ` | REM: ${summary.remSleepMin}m`;
    lines.push(sleepLine);
  }

  if (summary.restingHeartRate) {
    let hrLine = `Resting HR: ${summary.restingHeartRate} bpm`;
    if (summary.maxHeartRate) hrLine += ` | Max: ${summary.maxHeartRate} bpm`;
    lines.push(hrLine);
  }

  if (summary.avgStress) lines.push(`Avg stress: ${summary.avgStress}`);

  if (summary.bodyBatteryHigh != null) {
    lines.push(`Body battery: ${summary.bodyBatteryLow ?? "?"} – ${summary.bodyBatteryHigh}`);
  }

  if (summary.avgOvernightHrv) {
    let hrvLine = `HRV: ${summary.avgOvernightHrv.toFixed(0)} ms`;
    if (summary.hrvStatus) hrvLine += ` (${summary.hrvStatus})`;
    lines.push(hrvLine);
  }

  if (summary.weightKg) {
    let wLine = `Garmin weight: ${(summary.weightKg * 2.20462).toFixed(1)} lbs (${summary.weightKg.toFixed(1)} kg)`;
    if (summary.bodyFatPct) wLine += ` | Body fat: ${summary.bodyFatPct}%`;
    lines.push(wLine);
  }

  if (summary.recentActivities?.length) {
    const actLine = summary.recentActivities
      .slice(0, 3)
      .map((a: any) => `${a.name} (${a.durationMin}m, ${a.calories} kcal)`)
      .join(", ");
    lines.push(`Recent activities: ${actLine}`);
  }

  if (summary.syncedAt) {
    lines.push(`Last sync: ${new Date(summary.syncedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })} ET`);
  }

  lines.push("--- END GARMIN DATA ---");

  return lines.join("\n");
}
