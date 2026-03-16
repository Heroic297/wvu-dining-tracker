/**
 * Garmin & Fitbit OAuth2 integration.
 *
 * Garmin Health API v2 (OAuth2):
 *   - Register at https://developer.garmin.com/gc-developer-program/overview/
 *   - Set redirect URI to: https://your-app.railway.app/api/wearables/garmin/callback
 *   - Scopes needed: ACTIVITY_EXPORT, BODY_COMPOSITION
 *   - Pulls: daily calorie burn, steps, active minutes, and body weight
 *
 * Fitbit Web API (OAuth2):
 *   - Register at https://dev.fitbit.com/apps/new
 *   - Application type: Personal
 *   - Set redirect URI to: https://your-app.railway.app/api/wearables/fitbit/callback
 *   - Scopes: activity heartrate profile weight
 *
 * Token refresh: Garmin tokens expire in 1 hour; Fitbit tokens expire in 8 hours.
 * Both are refreshed automatically during sync.
 *
 * Weight auto-sync: When Garmin/Fitbit reports a morning weight, it is written
 * to weight_log AND user.weightKg so TDEE targets update immediately.
 */
import axios from "axios";
import { storage } from "./storage.js";
import type { InsertDailyActivity } from "../shared/schema.js";

// ── Fitbit ─────────────────────────────────────────────────────────────────────

const FITBIT_CLIENT_ID     = process.env.FITBIT_CLIENT_ID ?? "";
const FITBIT_CLIENT_SECRET = process.env.FITBIT_CLIENT_SECRET ?? "";
const FITBIT_REDIRECT_URI  = process.env.FITBIT_REDIRECT_URI
  ?? "http://localhost:5000/api/wearables/fitbit/callback";

export function getFitbitAuthUrl(state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: FITBIT_CLIENT_ID,
    redirect_uri: FITBIT_REDIRECT_URI,
    scope: "activity heartrate profile weight",
    state,
  });
  return `https://www.fitbit.com/oauth2/authorize?${params}`;
}

export async function exchangeFitbitCode(code: string) {
  const credentials = Buffer.from(`${FITBIT_CLIENT_ID}:${FITBIT_CLIENT_SECRET}`).toString("base64");
  const resp = await axios.post(
    "https://api.fitbit.com/oauth2/token",
    new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: FITBIT_REDIRECT_URI }),
    { headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/x-www-form-urlencoded" } }
  );
  return resp.data as { access_token: string; refresh_token: string; expires_in: number; scope: string; user_id: string };
}

async function refreshFitbitToken(refreshToken: string) {
  const credentials = Buffer.from(`${FITBIT_CLIENT_ID}:${FITBIT_CLIENT_SECRET}`).toString("base64");
  const resp = await axios.post(
    "https://api.fitbit.com/oauth2/token",
    new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
    { headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/x-www-form-urlencoded" } }
  );
  return resp.data as { access_token: string; refresh_token: string; expires_in: number };
}

async function getFitbitDailyActivity(accessToken: string, dateStr: string) {
  try {
    const resp = await axios.get(
      `https://api.fitbit.com/1/user/-/activities/date/${dateStr}.json`,
      { headers: { Authorization: `Bearer ${accessToken}` }, timeout: 10000 }
    );
    const s = resp.data?.summary;
    return {
      caloriesBurned: s?.caloriesOut ?? 0,
      steps: s?.steps ?? 0,
      activeMinutes: (s?.lightlyActiveMinutes ?? 0) + (s?.fairlyActiveMinutes ?? 0) + (s?.veryActiveMinutes ?? 0),
    };
  } catch { return null; }
}

async function getFitbitWeight(accessToken: string, dateStr: string): Promise<number | null> {
  try {
    const resp = await axios.get(
      `https://api.fitbit.com/1/user/-/body/log/weight/date/${dateStr}.json`,
      { headers: { Authorization: `Bearer ${accessToken}` }, timeout: 10000 }
    );
    const logs = resp.data?.weight ?? [];
    if (!logs.length) return null;
    // Return latest entry for the day (weight in kg — Fitbit uses user's unit setting;
    // the API always returns kg when using metric locale, or lbs in imperial.
    // We request metric via Accept-Language header.)
    return logs[0].weight ?? null; // in kg if metric header sent
  } catch { return null; }
}

// ── Garmin ────────────────────────────────────────────────────────────────────

const GARMIN_CLIENT_ID     = process.env.GARMIN_CLIENT_ID ?? "";
const GARMIN_CLIENT_SECRET = process.env.GARMIN_CLIENT_SECRET ?? "";
const GARMIN_REDIRECT_URI  = process.env.GARMIN_REDIRECT_URI
  ?? "http://localhost:5000/api/wearables/garmin/callback";

export function getGarminAuthUrl(state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: GARMIN_CLIENT_ID,
    redirect_uri: GARMIN_REDIRECT_URI,
    scope: "ACTIVITY_EXPORT BODY_COMPOSITION",
    state,
  });
  return `https://connect.garmin.com/oauthConfirm?${params}`;
}

export async function exchangeGarminCode(code: string) {
  const resp = await axios.post(
    "https://connectapi.garmin.com/oauth-service/oauth/exchange/user/2.0",
    new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: GARMIN_REDIRECT_URI }),
    {
      auth: { username: GARMIN_CLIENT_ID, password: GARMIN_CLIENT_SECRET },
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    }
  );
  return resp.data as { access_token: string; refresh_token: string; expires_in: number };
}

async function refreshGarminToken(refreshToken: string) {
  const resp = await axios.post(
    "https://connectapi.garmin.com/oauth-service/oauth/exchange/user/2.0",
    new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
    {
      auth: { username: GARMIN_CLIENT_ID, password: GARMIN_CLIENT_SECRET },
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    }
  );
  return resp.data as { access_token: string; refresh_token: string; expires_in: number };
}

async function getGarminDailyActivity(accessToken: string, dateStr: string) {
  try {
    const startSec = Math.floor(new Date(`${dateStr}T00:00:00Z`).getTime() / 1000);
    const endSec   = Math.floor(new Date(`${dateStr}T23:59:59Z`).getTime() / 1000);
    const resp = await axios.get(
      "https://apis.garmin.com/wellness-api/rest/dailies",
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { uploadStartTimeInSeconds: startSec, uploadEndTimeInSeconds: endSec },
        timeout: 10000,
      }
    );
    const summaries = resp.data?.dailies ?? [];
    if (!summaries.length) return null;
    const s = summaries[0];
    return {
      caloriesBurned: s.totalKilocalories ?? 0,
      steps: s.totalSteps ?? 0,
      activeMinutes: Math.round((s.activeTimeInSeconds ?? 0) / 60),
    };
  } catch { return null; }
}

/**
 * Fetch Garmin body composition (weight) for a given date.
 * Returns weight in kg, or null if no data.
 */
async function getGarminWeight(accessToken: string, dateStr: string): Promise<number | null> {
  try {
    const startSec = Math.floor(new Date(`${dateStr}T00:00:00Z`).getTime() / 1000);
    const endSec   = Math.floor(new Date(`${dateStr}T23:59:59Z`).getTime() / 1000);
    const resp = await axios.get(
      "https://apis.garmin.com/wellness-api/rest/bodyComps",
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { uploadStartTimeInSeconds: startSec, uploadEndTimeInSeconds: endSec },
        timeout: 10000,
      }
    );
    const entries = resp.data?.bodyComps ?? [];
    if (!entries.length) return null;
    // Garmin reports weight in grams — convert to kg
    const weightG = entries[0]?.weightInGrams;
    if (!weightG) return null;
    return Math.round((weightG / 1000) * 10) / 10; // kg, 1dp
  } catch { return null; }
}

// ── Token helpers ─────────────────────────────────────────────────────────────

/**
 * Get a valid access token for a user/source, refreshing if expired.
 * Returns null if the token cannot be refreshed.
 */
async function getValidAccessToken(
  userId: string,
  source: "fitbit" | "garmin"
): Promise<string | null> {
  const tokenRow = await storage.getWearableToken(userId, source);
  if (!tokenRow) return null;

  // Not expired — use as-is (with 5 min buffer)
  if (tokenRow.expiresAt && new Date(tokenRow.expiresAt).getTime() > Date.now() + 5 * 60 * 1000) {
    return tokenRow.accessToken;
  }

  // Expired — attempt refresh
  if (!tokenRow.refreshToken) return null;

  try {
    let tokens: { access_token: string; refresh_token: string; expires_in: number };
    if (source === "fitbit") {
      tokens = await refreshFitbitToken(tokenRow.refreshToken);
    } else {
      tokens = await refreshGarminToken(tokenRow.refreshToken);
    }

    await storage.upsertWearableToken({
      userId,
      source,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    });

    console.log(`[wearables] Refreshed ${source} token for user ${userId}`);
    return tokens.access_token;
  } catch (err: any) {
    console.error(`[wearables] Token refresh failed for ${userId} ${source}:`, err.message);
    return null;
  }
}

// ── Per-user sync ─────────────────────────────────────────────────────────────

/**
 * Sync a specific user's wearable for the last N days.
 * - Pulls calorie burn + steps → stored in daily_activity
 * - Pulls body weight → stored in weight_log AND updates user.weightKg
 *   so TDEE targets reflect the latest weigh-in automatically.
 *
 * TDEE fallback is NOT affected: if burnMode is "tdee" or no wearable data
 * exists for a date, computeDailyTargets() uses the TDEE formula as before.
 */
export async function syncUserWearable(userId: string, source: "fitbit" | "garmin") {
  const accessToken = await getValidAccessToken(userId, source);
  if (!accessToken) {
    console.warn(`[wearables] No valid token for ${userId} ${source} — skipping`);
    return;
  }

  const today = new Date();
  const dates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    return d.toISOString().slice(0, 10);
  });

  let weightSynced = false;

  for (const dateStr of dates) {
    try {
      // ── Activity (calorie burn, steps) ─────────────────────────────────────
      let activity: { caloriesBurned: number; steps: number; activeMinutes: number } | null = null;

      if (source === "fitbit") {
        activity = await getFitbitDailyActivity(accessToken, dateStr);
      } else {
        activity = await getGarminDailyActivity(accessToken, dateStr);
      }

      if (activity && activity.caloriesBurned > 0) {
        const entry: InsertDailyActivity = {
          userId,
          date: dateStr,
          source,
          caloriesBurned: activity.caloriesBurned,
          steps: activity.steps,
          activeMinutes: activity.activeMinutes,
          rawPayload: activity as any,
        };
        await storage.upsertDailyActivity(entry);
        console.log(`[wearables] ${source} activity synced for ${userId} on ${dateStr}: ${activity.caloriesBurned} kcal`);
      }

      // ── Weight ─────────────────────────────────────────────────────────────
      // Only sync weight for today and yesterday (fresh data only)
      if (!weightSynced && (dateStr === dates[0] || dateStr === dates[1])) {
        let weightKg: number | null = null;

        if (source === "fitbit") {
          weightKg = await getFitbitWeight(accessToken, dateStr);
        } else {
          weightKg = await getGarminWeight(accessToken, dateStr);
        }

        if (weightKg && weightKg > 20 && weightKg < 300) {
          // Write to weight_log
          await storage.upsertWeightLog({ userId, date: dateStr, weightKg });

          // Update user.weightKg so TDEE recalculates with latest weight
          await storage.updateUser(userId, { weightKg });

          weightSynced = true;
          console.log(`[wearables] ${source} weight synced for ${userId} on ${dateStr}: ${weightKg} kg`);
        }
      }
    } catch (err: any) {
      console.error(`[wearables] Sync error for ${userId} ${source} on ${dateStr}:`, err.message);
    }
  }
}

// ── Sync all users ────────────────────────────────────────────────────────────

/**
 * Sync all users who have a wearable token connected.
 * Called by the hourly scheduler.
 */
export async function syncAllWearables() {
  try {
    const allTokens = await storage.getAllWearableTokens();
    if (!allTokens.length) {
      console.log("[wearables] No connected wearables to sync");
      return;
    }

    console.log(`[wearables] Syncing ${allTokens.length} connected wearable(s)...`);

    // Deduplicate: one sync per userId+source pair
    const seen = new Set<string>();
    for (const token of allTokens) {
      const key = `${token.userId}:${token.source}`;
      if (seen.has(key)) continue;
      seen.add(key);

      await syncUserWearable(token.userId, token.source as "fitbit" | "garmin")
        .catch((err) => console.error(`[wearables] syncAllWearables error for ${key}:`, err.message));
    }

    console.log("[wearables] Sync complete");
  } catch (err: any) {
    console.error("[wearables] syncAllWearables failed:", err.message);
  }
}
