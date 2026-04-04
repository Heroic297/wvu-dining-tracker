/**
 * Node.js bridge to the Python Garmin sidecar (garmin_sidecar.py).
 * Uses garminconnect 0.3.0 which bypasses Cloudflare and supports MFA-enabled accounts.
 */
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SIDECAR_PATH = path.join(__dirname, "garmin_sidecar.py");

// Tokens directory — use /tmp on Render (ephemeral but fine, tokens auto-refresh)
const TOKENS_DIR = process.env.GARMIN_TOKENS_DIR ?? "/tmp/garmin-tokens";

export function getTokensPath(userId: string): string {
  return path.join(TOKENS_DIR, `${userId}.json`);
}

/**
 * Run the Python sidecar with a command and return parsed JSON output.
 */
function runSidecar(
  command: "login" | "sync",
  tokensPath: string,
  env: Record<string, string> = {},
  args: string[] = []
): Promise<any> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      "python3",
      [SIDECAR_PATH, command, tokensPath, ...args],
      {
        env: { ...process.env, ...env },
        timeout: 30000,
      }
    );

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });

    proc.on("close", (code) => {
      if (stderr) console.warn(`[garmin-py] stderr: ${stderr.substring(0, 500)}`);
      try {
        const result = JSON.parse(stdout.trim());
        resolve(result);
      } catch {
        reject(new Error(`Sidecar output parse error (exit ${code}): ${stdout.substring(0, 200)}`));
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to spawn Python sidecar: ${err.message}. Ensure python3 and garminconnect are installed.`));
    });
  });
}

/**
 * Login to Garmin via Python sidecar. Saves tokens to file.
 */
export async function pythonGarminLogin(
  userId: string,
  email: string,
  password: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const tokensPath = getTokensPath(userId);
    const result = await runSidecar("login", tokensPath, {
      GARMIN_EMAIL: email,
      GARMIN_PASSWORD: password,
    });
    console.log(`[garmin-py] Login result for ${userId}:`, result);
    return result;
  } catch (err: any) {
    console.error(`[garmin-py] Login spawn error for ${userId}:`, err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Sync Garmin data via Python sidecar. Returns normalized summary data.
 */
export async function pythonGarminSync(
  userId: string,
  targetDate?: Date
): Promise<{
  ok: true;
  categories: string[];
  summary: Record<string, any>;
  rawPayload: Record<string, any>;
  date: string;
} | { ok: false; error: string }> {
  try {
    const tokensPath = getTokensPath(userId);
    const dateArg = targetDate
      ? targetDate.toISOString().split("T")[0]
      : undefined;
    const args = dateArg ? [dateArg] : [];
    const result = await runSidecar("sync", tokensPath, {}, args);
    console.log(`[garmin-py] Sync result for ${userId}: ok=${result.ok}, categories=${result.categories?.join(",")}`);
    return result;
  } catch (err: any) {
    console.error(`[garmin-py] Sync spawn error for ${userId}:`, err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Check if a Python-based token file exists for this user.
 */
export function pythonTokenExists(userId: string): boolean {
  try {
    const fs = require("fs");
    return fs.existsSync(getTokensPath(userId));
  } catch {
    return false;
  }
}
