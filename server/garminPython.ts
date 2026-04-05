/**
 * Node.js bridge to the Python Garmin sidecar (garmin_sidecar.py).
 * Uses garminconnect 0.3.0 which bypasses Cloudflare and supports MFA-enabled accounts.
 */
import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

// Derive __dirname safely — import.meta.url is undefined when esbuild bundles to CJS
let __mod_dir: string;
try {
  __mod_dir = path.dirname(fileURLToPath(import.meta.url));
} catch {
  // CJS fallback: __dirname is defined by Node, or use process.cwd()
  __mod_dir = typeof __dirname !== "undefined" ? __dirname : process.cwd();
}

// Resolve sidecar path with multiple candidates.
// In production (esbuild → dist/index.cjs) the .py file lives in server/ under the repo root.
// process.cwd() is checked FIRST because Render's CWD is always the repo root.
function resolveSidecarPath(): string | undefined {
  const candidates = [
    // 1. CWD-based — most reliable on Render where CWD = repo root
    path.resolve(process.cwd(), "server", "garmin_sidecar.py"),
    // 2. Sibling of this file (works in dev with tsx)
    path.join(__mod_dir, "garmin_sidecar.py"),
    // 3. In production, __mod_dir may be dist/ — look in ../server/
    path.resolve(__mod_dir, "..", "server", "garmin_sidecar.py"),
    // 4. Copied into dist/server/ by postbuild
    path.resolve(process.cwd(), "dist", "server", "garmin_sidecar.py"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      console.log(`[garmin-py] Sidecar resolved: ${candidate}`);
      return candidate;
    }
    console.log(`[garmin-py] Sidecar not at: ${candidate}`);
  }

  console.error(`[garmin-py] garmin_sidecar.py not found in any candidate path`);
  return undefined;
}

const SIDECAR_PATH = resolveSidecarPath();

// Tokens directory — use /tmp on Render (ephemeral; DB-backed persistence added below)
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
    if (!SIDECAR_PATH) {
      return reject(new Error("Python sidecar not found — garmin_sidecar.py missing from all candidate paths"));
    }
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
    return fs.existsSync(getTokensPath(userId));
  } catch {
    return false;
  }
}

/**
 * Read the raw token file contents for a user (after login or sync).
 * Returns null if the file doesn't exist.
 */
export function readTokenFile(userId: string): string | null {
  try {
    const p = getTokensPath(userId);
    if (!fs.existsSync(p)) return null;
    return fs.readFileSync(p, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Write token data to the token file for a user.
 * Used to restore DB-backed tokens before a sidecar sync call.
 */
export function writeTokenFile(userId: string, data: string): void {
  const p = getTokensPath(userId);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, data, "utf-8");
}

/**
 * Remove the token file for a user (cleanup after sync).
 */
export function removeTokenFile(userId: string): void {
  try {
    const p = getTokensPath(userId);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch {
    // ignore
  }
}
