/**
 * memoryBridge.ts — Node.js bridge to the mempalace Python sidecar.
 *
 * Uses the same spawn() pattern as garminPython.ts.
 * All functions are non-throwing — errors return empty/null so a mempalace
 * failure never crashes the coach chat endpoint.
 */
import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

// Resolve __dirname safely for both ESM and CJS (esbuild)
let __mod_dir: string;
try {
  __mod_dir = path.dirname(fileURLToPath(import.meta.url));
} catch {
  __mod_dir = typeof __dirname !== "undefined" ? __dirname : process.cwd();
}

function resolveSidecarPath(): string | undefined {
  const candidates = [
    path.resolve(process.cwd(), "server", "mempalace_bridge.py"),
    path.join(__mod_dir, "mempalace_bridge.py"),
    path.resolve(__mod_dir, "..", "server", "mempalace_bridge.py"),
    path.resolve(process.cwd(), "dist", "server", "mempalace_bridge.py"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return undefined;
}

const SIDECAR_PATH = resolveSidecarPath();

function runSidecar(args: string[]): Promise<any> {
  return new Promise((resolve) => {
    if (!SIDECAR_PATH) {
      console.warn("[mempalace] sidecar not found — memory features unavailable");
      resolve({ ok: false, error: "sidecar not found" });
      return;
    }

    const proc = spawn("python3", [SIDECAR_PATH, ...args], {
      env: { ...process.env },
      timeout: 8000,  // 8s — fast enough for ChromaDB, long enough for cold start
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });

    proc.on("close", (code) => {
      if (stderr) console.warn(`[mempalace] stderr: ${stderr.substring(0, 300)}`);
      try {
        resolve(JSON.parse(stdout.trim()));
      } catch {
        console.warn(`[mempalace] output parse error (exit ${code}): ${stdout.substring(0, 200)}`);
        resolve({ ok: false, error: "parse error" });
      }
    });

    proc.on("error", (err) => {
      console.warn(`[mempalace] spawn error: ${err.message}`);
      resolve({ ok: false, error: err.message });
    });
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface MemoryHit {
  text: string;
  memory_type: string;
  similarity: number;
  filed_at: string;
}

/**
 * Semantic search over a user's coaching memories.
 * Returns an array of the top-N most relevant memory snippets.
 */
export async function searchMempalace(
  userId: string,
  query: string,
  nResults = 5
): Promise<MemoryHit[]> {
  try {
    const result = await runSidecar(["search", userId, query, String(nResults)]);
    if (result?.ok && Array.isArray(result.results)) {
      return result.results as MemoryHit[];
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Store a coaching memory for a user.
 * memory_type: "preference" | "milestone" | "decision" | "problem" | "general"
 */
export async function storeMempalace(
  userId: string,
  text: string,
  memoryType: string = "general",
  source: string = "coach_conversation"
): Promise<boolean> {
  try {
    const payload = JSON.stringify({ text, memory_type: memoryType, source });
    const result = await runSidecar(["store", userId, payload]);
    return result?.ok === true;
  } catch {
    return false;
  }
}

/**
 * Query the knowledge graph for all current facts about an entity.
 */
export async function kgQueryMempalace(
  userId: string,
  entity: string
): Promise<Array<{ subject: string; predicate: string; object: string }>> {
  try {
    const result = await runSidecar(["kg_query", userId, entity]);
    if (result?.ok && Array.isArray(result.triples)) {
      return result.triples;
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Store a knowledge graph triple (subject → predicate → object).
 * Used to record durable facts like "user → goal_is → weight_loss".
 */
export async function kgStoreMempalace(
  userId: string,
  subject: string,
  predicate: string,
  obj: string
): Promise<boolean> {
  try {
    const payload = JSON.stringify({ subject, predicate, object: obj });
    const result = await runSidecar(["kg_store", userId, payload]);
    return result?.ok === true;
  } catch {
    return false;
  }
}

/**
 * Build a formatted context block from today's macro data + meal-level rows
 * + the user's top coaching memories from mempalace.
 *
 * snapshot: {
 *   today, totals, targets, meals, water_ml, weight
 * }
 *
 * Returns a plain-text block ready to prepend to any system prompt.
 * On failure returns an empty string so the caller degrades gracefully.
 */
export async function getMempalaceContextSnapshot(
  userId: string,
  snapshot: {
    today: string;
    totals: { kcal: number; protein: number; carbs: number; fat: number };
    targets: {
      calories: number;
      proteinG: number;
      carbsG: number;
      fatG: number;
      waterTargetMl?: number;
      tdee?: number;
    } | null;
    meals: Array<{
      meal_name?: string;
      logged_at?: string;
      total_calories?: number;
      total_protein?: number;
      total_carbs?: number;
      total_fat?: number;
    }>;
    water_ml: number;
    weight: { weight_kg?: number; weight_lbs?: number; date?: string } | null;
  }
): Promise<string> {
  try {
    const payload = JSON.stringify(snapshot);
    const result = await runSidecar(["context_snapshot", userId, payload]);
    if (result?.ok && typeof result.block === "string") {
      return result.block;
    }
    return "";
  } catch {
    return "";
  }
}
