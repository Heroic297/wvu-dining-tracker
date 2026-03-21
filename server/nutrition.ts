/**
 * Nutrition lookup service — v2
 *
 * Pipeline per query:
 *   1. Text preprocessing — normalise, detect intent, extract quantities
 *   2. Cache check (skip when forceAi)
 *   3. Route:
 *      a. Multi-component meals → AI with per-component breakdown prompt
 *      b. Restaurant / branded items → AI with chain-specific prompt
 *      c. Weighted single-ingredient → AI with precise gram-weight prompt
 *      d. Simple single ingredient → USDA → AI fallback
 *   4. Cache result
 *
 * AI model: llama-3.3-70b-versatile via Groq
 * Temperature: 0.05 — near-deterministic for reproducible macros
 */
import Groq from "groq-sdk";
import axios from "axios";
import { storage } from "./storage.js";
import type { InsertNutritionCache } from "../shared/schema.js";

const USDA_API_KEY = process.env.USDA_API_KEY || "DEMO_KEY";
const USDA_BASE = "https://api.nal.usda.gov/fdc/v1";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NutritionComponent {
  item: string;
  /** Explicit quantity string parsed from query, e.g. "200g", "1 cup", "2 pieces" */
  quantityStr?: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  servingSize: string;
  confidence: "high" | "medium" | "low";
}

export interface NutritionResult {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  servingSize: string;
  source: "usda" | "ai_estimated" | "manual_exact";
  confidence?: string;
  foodName: string;
  /**
   * Per-component breakdown — populated when the query contained multiple
   * distinct food items (e.g. "salmon rice broccoli" or "Big Mac + large fries").
   * Each component carries its own servingSize and confidence so the UI can
   * render individual portion selectors.
   */
  breakdown?: NutritionComponent[];
}

// ─── Known restaurant chains (used for routing + prompt priming) ──────────────

const CHAIN_PATTERNS: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /chick.fil.a/i,      name: "Chick-fil-A" },
  { pattern: /mcdonald'?s?/i,     name: "McDonald's" },
  { pattern: /burger king/i,       name: "Burger King" },
  { pattern: /wendy'?s?/i,        name: "Wendy's" },
  { pattern: /subway/i,            name: "Subway" },
  { pattern: /chipotle/i,          name: "Chipotle Mexican Grill" },
  { pattern: /panera/i,            name: "Panera Bread" },
  { pattern: /taco bell/i,         name: "Taco Bell" },
  { pattern: /domino'?s?/i,       name: "Domino's" },
  { pattern: /pizza hut/i,         name: "Pizza Hut" },
  { pattern: /starbucks/i,         name: "Starbucks" },
  { pattern: /dunkin'?/i,          name: "Dunkin'" },
  { pattern: /popeyes/i,           name: "Popeyes" },
  { pattern: /\bkfc\b/i,           name: "KFC" },
  { pattern: /five guys/i,         name: "Five Guys" },
  { pattern: /shake shack/i,       name: "Shake Shack" },
  { pattern: /raising cane'?s?/i,  name: "Raising Cane's" },
  { pattern: /cook.?out/i,         name: "Cook Out" },
  { pattern: /jersey mike'?s?/i,   name: "Jersey Mike's" },
  { pattern: /jimmy john'?s?/i,    name: "Jimmy John's" },
  { pattern: /firehouse subs?/i,   name: "Firehouse Subs" },
  { pattern: /sheetz/i,            name: "Sheetz" },
  { pattern: /wawa/i,              name: "Wawa" },
  { pattern: /sonic/i,             name: "Sonic Drive-In" },
  { pattern: /dairy queen/i,       name: "Dairy Queen" },
  { pattern: /in.n.out/i,          name: "In-N-Out Burger" },
  { pattern: /whataburger/i,       name: "Whataburger" },
  { pattern: /arby'?s?/i,         name: "Arby's" },
  { pattern: /hardee'?s?/i,       name: "Hardee's" },
  { pattern: /bojangles/i,         name: "Bojangles" },
  { pattern: /panda express/i,     name: "Panda Express" },
  { pattern: /olive garden/i,      name: "Olive Garden" },
  { pattern: /applebee'?s?/i,     name: "Applebee's" },
  { pattern: /ihop/i,              name: "IHOP" },
  { pattern: /cracker barrel/i,    name: "Cracker Barrel" },
  { pattern: /red lobster/i,       name: "Red Lobster" },
  { pattern: /texas roadhouse/i,   name: "Texas Roadhouse" },
  { pattern: /outback/i,           name: "Outback Steakhouse" },
  { pattern: /buffalo wild wings/i,name: "Buffalo Wild Wings" },
  { pattern: /b-dubs|bdubs/i,      name: "Buffalo Wild Wings" },
  { pattern: /qdoba/i,             name: "Qdoba" },
  { pattern: /moe'?s?/i,          name: "Moe's Southwest Grill" },
  { pattern: /sweetgreen/i,        name: "Sweetgreen" },
  { pattern: /cosi\b/i,            name: "Cosi" },
  { pattern: /corner bakery/i,     name: "Corner Bakery" },
  { pattern: /einstein/i,          name: "Einstein Bros Bagels" },
];

// ─── Text preprocessing ───────────────────────────────────────────────────────

/**
 * Normalise a raw user query before routing or sending to AI.
 * Returns a structured ParsedQuery.
 */
interface ParsedQuery {
  /** Original input, trimmed */
  raw: string;
  /** Lowercased, whitespace-collapsed */
  normalised: string;
  /** Detected restaurant chain name, if any */
  chain: string | null;
  /** True when the query describes multiple distinct food items */
  isMultiComponent: boolean;
  /** True when the query contains explicit weight/volume/piece count */
  hasExplicitQuantity: boolean;
  /** True when routing directly to AI is appropriate (skip USDA) */
  useAI: boolean;
  /**
   * List of individual component strings split from a multi-component query.
   * e.g. "salmon rice broccoli" → ["salmon", "rice", "broccoli"]
   * e.g. "8oz chicken and 1 cup rice" → ["8oz chicken", "1 cup rice"]
   */
  components: string[];
  /** Cleaned query to send to AI — standardised quantities, brand names expanded */
  cleanedQuery: string;
}

/** Unit synonyms → canonical form for the AI */
const UNIT_NORMALISE: Array<[RegExp, string]> = [
  [/\b(oz|ounce|ounces)\b/gi, "oz"],
  [/\b(lb|lbs|pound|pounds)\b/gi, "lbs"],
  [/\b(g|gr|gram|grams)\b/gi, "g"],
  [/\b(kg|kilogram|kilograms)\b/gi, "kg"],
  [/\b(ml|milliliter|milliliters|millilitre|millilitres)\b/gi, "ml"],
  [/\b(tbsp|tablespoon|tablespoons)\b/gi, "tbsp"],
  [/\b(tsp|teaspoon|teaspoons)\b/gi, "tsp"],
  [/\b(cups?)\b/gi, "cup"],
  [/\b(slice|slices|piece|pieces|pc|pcs)\b/gi, "piece"],
  [/\bserving(s)?\b/gi, "serving"],
];

/** Vague size words → standardised equivalents */
const SIZE_NORMALISE: Array<[RegExp, string]> = [
  [/\b(sm|small)\b/gi, "small"],
  [/\b(med|medium|regular|reg)\b/gi, "medium"],
  [/\b(lg|large)\b/gi, "large"],
  [/\b(xl|extra.large|extra large)\b/gi, "extra large"],
  [/\b(double|dbl)\b/gi, "double"],
  [/\b(triple)\b/gi, "triple"],
];

/** Words that indicate multiple items are listed */
const MULTI_SEPARATORS = /\band\b|,|&|\bwith\b|\bplus\b|\+/i;

/**
 * Split a multi-component string into individual component strings.
 * Tries to keep quantity phrases together with their food.
 * e.g. "8oz chicken and 1 cup rice and broccoli"
 *   → ["8oz chicken", "1 cup rice", "broccoli"]
 */
function splitComponents(query: string): string[] {
  // Split on separators
  const parts = query
    .split(MULTI_SEPARATORS)
    .map((p) => p.trim())
    .filter((p) => p.length > 1);

  // Merge very short fragments back (e.g. "and a side of" splitting artifacts)
  const merged: string[] = [];
  for (const part of parts) {
    if (part.split(/\s+/).length <= 1 && merged.length > 0) {
      merged[merged.length - 1] += " " + part;
    } else {
      merged.push(part);
    }
  }
  return merged;
}

/** Detect if a query contains an explicit quantity / measurement */
function hasQuantity(query: string): boolean {
  return /\d+(\.\d+)?\s*(g|oz|ml|lb|lbs|kg|cup|tbsp|tsp|piece|slice|serving)\b/i.test(query) ||
    /\b(a|one|two|three|four|five|half|quarter)\s+(cup|scoop|piece|slice|serving)\b/i.test(query) ||
    /^\d+(\.\d+)?x\s/i.test(query);
}

export function preprocessQuery(raw: string): ParsedQuery {
  let cleaned = raw.trim();

  // Normalise units
  for (const [re, rep] of UNIT_NORMALISE) {
    cleaned = cleaned.replace(re, rep);
  }
  for (const [re, rep] of SIZE_NORMALISE) {
    cleaned = cleaned.replace(re, rep);
  }
  // Collapse multiple spaces
  cleaned = cleaned.replace(/\s+/g, " ").trim();

  const normalised = cleaned.toLowerCase();

  // Detect chain
  let chain: string | null = null;
  for (const { pattern, name } of CHAIN_PATTERNS) {
    if (pattern.test(normalised)) { chain = name; break; }
  }

  const isMultiComponent = MULTI_SEPARATORS.test(normalised) || (
    // Three or more food words with no separator often means a meal description
    normalised.split(/\s+/).length >= 3 &&
    !hasQuantity(normalised) &&
    !chain &&
    !/(sauce|dressing|seasoned|grilled|baked|fried|crispy|spicy|smoked)/i.test(normalised)
  );

  const components = isMultiComponent ? splitComponents(cleaned) : [cleaned];

  const useAI =
    !!chain ||
    isMultiComponent ||
    hasQuantity(normalised) ||
    /\b(spicy|grilled|fried|baked|crispy|smoked|bbq|buffalo|ranch|seasoned|marinated|rotisserie|air.fried)\b/i.test(normalised);

  return {
    raw: raw.trim(),
    normalised,
    chain,
    isMultiComponent,
    hasExplicitQuantity: hasQuantity(normalised),
    useAI,
    components,
    cleanedQuery: cleaned,
  };
}

// ─── AI system prompts ────────────────────────────────────────────────────────

/**
 * Build the system prompt based on query intent.
 * Specialised prompts are more accurate than a single generic one.
 */
function buildSystemPrompt(parsed: ParsedQuery): string {
  const baseIdentity = `You are a professional sports dietitian and precision nutrition analyst with encyclopedic knowledge of:
- Official published nutritional data for every major US restaurant chain (Chick-fil-A, McDonald's, Sheetz, Chipotle, etc.)
- USDA FoodData Central values for all whole foods and raw ingredients
- Precise macro estimation for weighted portions using verified nutritional density values
- Bodybuilding, powerlifting, and athletic nutrition standards

Your outputs are used for elite athletic nutrition tracking. Accuracy is critical — rounding errors or hallucinated values cause real harm to athletic performance and body composition goals.`;

  const jsonRule = `Return ONLY a single valid JSON object. No markdown, no code fences, no explanation. If uncertain about any value, use your best evidence-based estimate and set confidence to "low".`;

  const componentSchema = `{
  "item": "<food name with quantity>",
  "calories": <integer>,
  "proteinG": <number, 1 decimal>,
  "carbsG": <number, 1 decimal>,
  "fatG": <number, 1 decimal>,
  "servingSize": "<specific size, e.g. '6oz fillet', '1 cup cooked', '1 medium sandwich'>",
  "confidence": "<'high'|'medium'|'low'>"
}`;

  if (parsed.chain) {
    return `${baseIdentity}

TASK: Return exact nutritional data for a ${parsed.chain} menu item.
Use ${parsed.chain}'s OFFICIAL PUBLISHED nutrition facts — not estimates.
If the item has customisation options (add cheese, extra sauce, etc.), account for each stated modifier.

${jsonRule}

${parsed.isMultiComponent ? `Return the TOTAL plus a breakdown array of per-item objects:
{
  "calories": <total>,
  "proteinG": <total>,
  "carbsG": <total>,
  "fatG": <total>,
  "servingSize": "<description of full order>",
  "confidence": "<'high'|'medium'|'low'>",
  "breakdown": [${componentSchema}, ...]
}` : `Return a single item object:
{
  "calories": <integer>,
  "proteinG": <number, 1 decimal>,
  "carbsG": <number, 1 decimal>,
  "fatG": <number, 1 decimal>,
  "servingSize": "<official serving size from ${parsed.chain} nutrition data>",
  "confidence": "high",
  "breakdown": []
}`}`;
  }

  if (parsed.isMultiComponent) {
    return `${baseIdentity}

TASK: The user has described a meal with multiple distinct food components. Return the combined total AND a per-component breakdown.

Rules:
- Identify each component and its quantity from the description. If no quantity is stated, assume a standard single serving appropriate for an adult athlete.
- Use USDA values for whole foods (chicken breast, rice, broccoli, etc.).
- For each component, state the assumed serving size explicitly in "servingSize".
- Calories must equal sum of breakdown calories (within 1 kcal rounding).
- Macros must equal sums of breakdown macros (within 0.1g rounding).

${jsonRule}

Return:
{
  "calories": <sum of all components>,
  "proteinG": <sum>,
  "carbsG": <sum>,
  "fatG": <sum>,
  "servingSize": "<overall description, e.g. 'Full meal: salmon + rice + broccoli'>",
  "confidence": "<overall confidence>",
  "breakdown": [
    ${componentSchema},
    ...one entry per component...
  ]
}`;
  }

  if (parsed.hasExplicitQuantity) {
    return `${baseIdentity}

TASK: Calculate precise nutritional content for the exact weight/volume specified. Use USDA nutritional density values:
- Cooked chicken breast: 165 kcal, 31g protein, 0g carbs, 3.6g fat per 100g
- Cooked white rice: 130 kcal, 2.7g protein, 28g carbs, 0.3g fat per 100g
- Raw broccoli: 34 kcal, 2.8g protein, 6.6g carbs, 0.4g fat per 100g
- Cooked salmon (Atlantic, farmed): 208 kcal, 20g protein, 0g carbs, 13g fat per 100g
- Cooked lean ground beef (90/10): 215 kcal, 26g protein, 0g carbs, 12g fat per 100g
- Large egg: 78 kcal, 6g protein, 0.6g carbs, 5g fat
- Oats (dry): 389 kcal, 17g protein, 66g carbs, 7g fat per 100g
Scale precisely to the specified quantity. If cooking method affects density significantly (e.g. raw vs cooked weight), note it in servingSize.

${jsonRule}

Return:
{
  "calories": <integer>,
  "proteinG": <number, 1 decimal>,
  "carbsG": <number, 1 decimal>,
  "fatG": <number, 1 decimal>,
  "servingSize": "<exact quantity specified, e.g. '200g cooked chicken breast'>",
  "confidence": "high",
  "breakdown": []
}`;
  }

  // General single food item
  return `${baseIdentity}

TASK: Return nutritional content for one standard serving of the described food.
- Use USDA FoodData Central as primary reference for whole foods.
- For branded/packaged items, use label data if known.
- State the serving size explicitly (weight in grams preferred, plus household measure).
- If the food is ambiguous (e.g. "pasta" without portion), assume 1 cup cooked (140g) for solids, 1 cup (240ml) for liquids.

${jsonRule}

Return:
{
  "calories": <integer>,
  "proteinG": <number, 1 decimal>,
  "carbsG": <number, 1 decimal>,
  "fatG": <number, 1 decimal>,
  "servingSize": "<specific serving size with grams>",
  "confidence": "<'high'|'medium'|'low'>",
  "breakdown": []
}`;
}

// ─── USDA lookup ──────────────────────────────────────────────────────────────

function getUsdaNutrient(
  nutrients: Array<{ nutrientNumber?: string; value?: number }>,
  ...ids: string[]
): number {
  for (const id of ids) {
    const found = nutrients.find((n) => n.nutrientNumber === id);
    if (found?.value != null) return Math.round(found.value * 10) / 10;
  }
  return 0;
}

async function lookupUsda(foodName: string): Promise<NutritionResult | null> {
  try {
    const resp = await axios.get(`${USDA_BASE}/foods/search`, {
      params: {
        query: foodName,
        pageSize: 3,
        dataType: "Foundation,SR Legacy",
        api_key: USDA_API_KEY,
      },
      timeout: 8000,
    });

    const foods = resp.data?.foods ?? [];
    if (!foods.length) return null;

    const food = foods[0];
    const nutrients = food.foodNutrients ?? [];

    const calories = getUsdaNutrient(nutrients, "208");
    const proteinG = getUsdaNutrient(nutrients, "203");
    const carbsG   = getUsdaNutrient(nutrients, "205");
    const fatG     = getUsdaNutrient(nutrients, "204");

    if (!calories) return null;

    return {
      calories,
      proteinG,
      carbsG,
      fatG,
      servingSize: "100g (USDA standard)",
      source: "usda",
      confidence: "high",
      foodName: food.description ?? foodName,
    };
  } catch (err: any) {
    console.warn("[nutrition] USDA lookup failed:", err.message);
    return null;
  }
}

// ─── AI estimation ────────────────────────────────────────────────────────────

interface RawAIResponse {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  servingSize: string;
  confidence: string;
  breakdown?: Array<{
    item: string;
    calories: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    servingSize?: string;
    confidence?: string;
  }>;
}

async function estimateWithAI(
  parsed: ParsedQuery
): Promise<NutritionResult | null> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    console.warn("[nutrition] GROQ_API_KEY not set — skipping AI estimation");
    return null;
  }

  const groq = new Groq({ apiKey });
  const systemPrompt = buildSystemPrompt(parsed);
  const userPrompt = `Nutrition for: "${parsed.cleanedQuery}"`;

  try {
    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userPrompt },
      ],
      temperature: 0.05,
      max_tokens: 1200,
    });

    const raw = completion.choices[0]?.message?.content?.trim() ?? "";

    // Strip markdown fences if the model adds them despite instructions
    const cleaned = raw.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn("[nutrition] AI returned non-JSON:", raw.slice(0, 200));
      return null;
    }

    const p = JSON.parse(jsonMatch[0]) as RawAIResponse;

    // Normalise breakdown entries — add servingSize/confidence if missing
    const breakdown: NutritionComponent[] = (p.breakdown ?? []).map((b) => ({
      item: b.item,
      calories: Math.round(b.calories),
      proteinG: Math.round(b.proteinG * 10) / 10,
      carbsG:   Math.round(b.carbsG   * 10) / 10,
      fatG:     Math.round(b.fatG     * 10) / 10,
      servingSize: b.servingSize ?? "1 serving",
      confidence: (b.confidence as NutritionComponent["confidence"]) ?? "medium",
    }));

    return {
      calories: Math.round(p.calories),
      proteinG: Math.round(p.proteinG * 10) / 10,
      carbsG:   Math.round(p.carbsG   * 10) / 10,
      fatG:     Math.round(p.fatG     * 10) / 10,
      servingSize: p.servingSize ?? "1 serving",
      source: "ai_estimated",
      confidence: p.confidence ?? "medium",
      foodName: parsed.cleanedQuery,
      breakdown,
    };
  } catch (err: any) {
    console.error("[nutrition] Groq AI error:", err.message);
    return null;
  }
}

// ─── Main entry point ─────────────────────────────────────────────────────────

function normalizeKey(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * Main nutrition lookup. Runs the full preprocessing → routing → AI pipeline.
 */
export async function lookupNutrition(
  foodName: string,
  options: { forceAi?: boolean } = {}
): Promise<NutritionResult | null> {
  const parsed = preprocessQuery(foodName);
  const key = normalizeKey(parsed.cleanedQuery);

  // 1. Cache hit (bypass when forceAi so live result refreshes cache)
  if (!options.forceAi) {
    const cached = await storage.getNutritionCache(key);
    if (cached) {
      return {
        calories:    cached.calories    ?? 0,
        proteinG:   cached.proteinG    ?? 0,
        carbsG:     cached.carbsG      ?? 0,
        fatG:       cached.fatG        ?? 0,
        servingSize: cached.servingSize ?? "1 serving",
        source: (cached.source as NutritionResult["source"]) ?? "ai_estimated",
        confidence: cached.confidence  ?? undefined,
        foodName: cached.foodName,
      };
    }
  }

  // 2. Route to AI or USDA
  let result: NutritionResult | null = null;

  const shouldUseAI = options.forceAi || parsed.useAI;

  if (shouldUseAI) {
    result = await estimateWithAI(parsed);
  } else {
    // Simple single food — try USDA first, fall back to AI
    result = await lookupUsda(parsed.cleanedQuery);
    if (!result) {
      result = await estimateWithAI(parsed);
    }
  }

  // 3. Cache the aggregate result (not individual breakdown items)
  if (result) {
    const entry: InsertNutritionCache = {
      foodName: result.foodName,
      normalizedKey: key,
      calories:  result.calories,
      proteinG:  result.proteinG,
      carbsG:    result.carbsG,
      fatG:      result.fatG,
      servingSize: result.servingSize,
      source:    result.source,
      confidence: result.confidence,
    };
    await storage.upsertNutritionCache(entry).catch((err) =>
      console.warn("[nutrition] Cache write failed:", err.message)
    );
  }

  return result;
}
