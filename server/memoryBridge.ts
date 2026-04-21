/**
 * memoryBridge.ts — pure-TypeScript context snapshot.
 *
 * All ChromaDB / Python sidecar code has been removed.
 * Render free tier has no persistent disk, so the sidecar could never run.
 * This module formats a nutrition snapshot into a system-prompt block synchronously.
 *
 * Stubs for searchMempalace / storeMempalace / kgQueryMempalace / kgStoreMempalace
 * are kept so existing import sites continue to compile without changes.
 */

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

/** Format a time string like "08:02" from a logged_at value (ISO or time string). */
function fmtTime(logged_at?: string): string {
  if (!logged_at) return "";
  try {
    // If it looks like a full ISO timestamp, parse it
    const d = new Date(logged_at);
    if (!isNaN(d.getTime())) {
      return d.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
        timeZone: "America/New_York",
      });
    }
  } catch { /* fall through */ }
  return logged_at.slice(0, 5); // already HH:MM
}

/**
 * Build a formatted nutrition context snapshot string.
 * Synchronous and pure — no I/O, no side effects.
 */
export function buildContextSnapshot(snapshot: ContextSnapshotInput): string {
  const { today, totals, targets, meals, water_ml, weight } = snapshot;

  const lines: string[] = ["--- NUTRITION CONTEXT SNAPSHOT ---"];

  // Today's intake
  lines.push(
    `Today's intake (${today}): ${Math.round(totals.kcal)} kcal | P ${Math.round(totals.protein)}g / C ${Math.round(totals.carbs)}g / F ${Math.round(totals.fat)}g`
  );

  // Remaining against targets
  if (targets) {
    const remKcal = Math.max(0, targets.calories - Math.round(totals.kcal));
    const remP    = Math.max(0, targets.proteinG  - Math.round(totals.protein));
    const remC    = Math.max(0, targets.carbsG    - Math.round(totals.carbs));
    const remF    = Math.max(0, targets.fatG      - Math.round(totals.fat));
    lines.push(`Remaining: ${remKcal} kcal | P ${remP}g / C ${remC}g / F ${remF}g`);
  }

  // Per-meal breakdown
  if (meals && meals.length > 0) {
    lines.push("Meals logged today:");
    for (const m of meals) {
      const name  = m.meal_name ?? "Meal";
      const time  = fmtTime(m.logged_at);
      const label = time ? `${name} (${time})` : name;
      const kcal  = Math.round(m.total_calories ?? 0);
      const p     = Math.round(m.total_protein  ?? 0);
      const c     = Math.round(m.total_carbs    ?? 0);
      const f     = Math.round(m.total_fat      ?? 0);
      lines.push(`  \u2022 ${label}: ${kcal} kcal | P ${p}g / C ${c}g / F ${f}g`);
    }
  } else {
    lines.push("Meals logged today: none");
  }

  // Water
  const waterL = water_ml >= 1000
    ? `${(water_ml / 1000).toFixed(1)}L`
    : `${water_ml}ml`;
  const waterTarget = targets?.waterTargetMl
    ? ` / ${(targets.waterTargetMl / 1000).toFixed(1)}L target`
    : "";
  lines.push(`Water today: ${waterL}${waterTarget}`);

  // Weight
  if (weight && (weight.weight_kg || weight.weight_lbs)) {
    const kg  = weight.weight_kg  ?? (weight.weight_lbs ? weight.weight_lbs / 2.20462 : null);
    const lbs = weight.weight_lbs ?? (kg ? kg * 2.20462 : null);
    const dateSuffix = weight.date ? ` \u2014 logged ${weight.date}` : "";
    if (kg && lbs) {
      lines.push(`Latest weight: ${lbs.toFixed(1)} lbs (${kg.toFixed(1)} kg)${dateSuffix}`);
    }
  }

  lines.push("--- END SNAPSHOT ---");
  return lines.join("\n");
}

/**
 * Async wrapper kept for call-site compatibility.
 * _userId is ignored — snapshot is built from the provided data synchronously.
 */
export async function getMempalaceContextSnapshot(
  _userId: string,
  snapshot: ContextSnapshotInput
): Promise<string> {
  return buildContextSnapshot(snapshot);
}

// ─── Stub no-ops (kept so existing import sites compile) ─────────────────────

export async function searchMempalace(
  _userId: string,
  _query: string
): Promise<string[]> {
  return [];
}

export async function storeMempalace(
  _userId: string,
  _text: string
): Promise<boolean> {
  return false;
}

export async function kgQueryMempalace(
  _userId: string,
  _query: string
): Promise<string[]> {
  return [];
}

export async function kgStoreMempalace(
  _userId: string,
  _subject: string,
  _predicate: string,
  _object: string
): Promise<boolean> {
  return false;
}
