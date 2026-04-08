/**
 * memoryBridge.ts
 *
 * Previously bridged to a Python/ChromaDB sidecar. That path is deferred —
 * ChromaDB requires persistent disk which Render free tier does not provide.
 *
 * What's here now:
 *   - buildContextSnapshot()  ← the real fix: pure-TS, Postgres-sourced,
 *                               formats LiveData into a system-prompt block.
 *                               Called by coach.ts before every chat call,
 *                               works for ALL providers (Groq, OpenRouter,
 *                               local) with no sidecar.
 *   - Stub exports for searchMempalace / storeMempalace / kg* so any existing
 *     import sites keep compiling. They are no-ops until ChromaDB is wired in.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MemoryHit {
  text: string;
  memory_type: string;
  similarity: number;
  filed_at: string;
}

export interface ContextSnapshotInput {
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

// ─── Core: pure-TS context snapshot ──────────────────────────────────────────

/**
 * Build a formatted nutrition context block from today's Postgres data.
 *
 * This is the function that gives local/Groq models the same informational
 * depth as cloud models that use tool-calling. It runs synchronously over
 * data already fetched by fetchLiveData() — no extra DB queries, no sidecar,
 * no ChromaDB.
 *
 * Injects:
 *   - Daily aggregate totals (kcal / P / C / F) vs targets + remaining
 *   - Per-meal breakdown rows (meal name, time, macros)
 *   - Water logged vs target
 *   - Latest weigh-in
 *
 * Returns a plain-text block ready to append to any system prompt.
 * Never throws — returns "" on any error so callers degrade gracefully.
 */
export function buildContextSnapshot(snapshot: ContextSnapshotInput): string {
  try {
    const { today, totals, targets, meals, water_ml, weight } = snapshot;

    // ── Aggregate line ──────────────────────────────────────────────────────
    const intakeLine = `Today's intake (${today}): ${Math.round(totals.kcal)} kcal | P ${Math.round(totals.protein)}g / C ${Math.round(totals.carbs)}g / F ${Math.round(totals.fat)}g`;

    // ── Remaining vs targets ────────────────────────────────────────────────
    let remainingLine = "";
    if (targets) {
      const remKcal  = Math.max(0, targets.calories  - Math.round(totals.kcal));
      const remP     = Math.max(0, targets.proteinG  - Math.round(totals.protein));
      const remC     = Math.max(0, targets.carbsG    - Math.round(totals.carbs));
      const remF     = Math.max(0, targets.fatG      - Math.round(totals.fat));
      remainingLine  = `Remaining: ${remKcal} kcal | P ${remP}g / C ${remC}g / F ${remF}g`;
    }

    // ── Per-meal breakdown ──────────────────────────────────────────────────
    let mealLines = "";
    if (meals && meals.length > 0) {
      const rows = meals.map((m) => {
        const name  = m.meal_name  ?? "Meal";
        const time  = m.logged_at  ? new Date(m.logged_at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true }) : "";
        const kcal  = Math.round(m.total_calories ?? 0);
        const p     = Math.round(m.total_protein  ?? 0);
        const c     = Math.round(m.total_carbs    ?? 0);
        const f     = Math.round(m.total_fat      ?? 0);
        return `  • ${name}${time ? ` (${time})` : ""}: ${kcal} kcal | P ${p}g / C ${c}g / F ${f}g`;
      });
      mealLines = "Meals logged today:\n" + rows.join("\n");
    } else {
      mealLines = "Meals logged today: none";
    }

    // ── Water ───────────────────────────────────────────────────────────────
    const waterStr  = water_ml >= 1000
      ? `${(water_ml / 1000).toFixed(1)}L`
      : `${water_ml}ml`;
    const waterTarget = targets?.waterTargetMl
      ? ` / ${(targets.waterTargetMl / 1000).toFixed(1)}L target`
      : "";
    const waterLine = `Water today: ${waterStr}${waterTarget}`;

    // ── Weight ──────────────────────────────────────────────────────────────
    let weightLine = "";
    if (weight?.weight_kg) {
      const lbs = (weight.weight_kg * 2.20462).toFixed(1);
      weightLine = `Latest weight: ${lbs} lbs (${weight.weight_kg.toFixed(1)} kg)${weight.date ? ` — logged ${weight.date}` : ""}`;
    }

    const lines = [
      "--- NUTRITION CONTEXT SNAPSHOT ---",
      intakeLine,
      remainingLine,
      mealLines,
      waterLine,
      weightLine,
      "--- END SNAPSHOT ---",
    ].filter(Boolean).join("\n");

    return lines;
  } catch {
    return "";
  }
}

// ─── Legacy alias — coach.ts imports this name ────────────────────────────────

/**
 * Async wrapper kept for call-site compatibility with the old sidecar API.
 * Delegates immediately to the synchronous buildContextSnapshot — no I/O.
 */
export async function getMempalaceContextSnapshot(
  _userId: string,
  snapshot: ContextSnapshotInput
): Promise<string> {
  return buildContextSnapshot(snapshot);
}

// ─── Stubs (ChromaDB / vector memory — deferred) ─────────────────────────────
// These compile cleanly and return safe empty values.
// Re-implement when ChromaDB or a Postgres-native vector store is available.

export async function searchMempalace(
  _userId: string,
  _query: string,
  _nResults = 5
): Promise<MemoryHit[]> {
  return [];
}

export async function storeMempalace(
  _userId: string,
  _text: string,
  _memoryType = "general",
  _source = "coach_conversation"
): Promise<boolean> {
  return false;
}

export async function kgQueryMempalace(
  _userId: string,
  _entity: string
): Promise<Array<{ subject: string; predicate: string; object: string }>> {
  return [];
}

export async function kgStoreMempalace(
  _userId: string,
  _subject: string,
  _predicate: string,
  _obj: string
): Promise<boolean> {
  return false;
}
